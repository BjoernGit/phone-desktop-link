import { useCallback, useEffect, useRef, useState } from "react";

function getCaptureTarget(quality) {
  // Feste Zielformate (lange x kurze Kante). Die Orientierung folgt der
  // Quelle: Hochformat-Quelle -> z.B. 720x1280, Querformat-Quelle -> 1280x720
  switch (quality) {
    case "S":
      return { long: 640, short: 360, jpeg: 0.75 };
    case "M":
      return { long: 1280, short: 720, jpeg: 0.82 };
    case "L":
      return { long: 1920, short: 1080, jpeg: 0.88 };
    case "XL":
      return { long: 2560, short: 1440, jpeg: 0.9 };
    default:
      return { long: 1280, short: 720, jpeg: 0.82 };
  }
}

/**
 * Compute crop rectangle and output size for a capture.
 * The fixed quality format is applied in the requested orientation
 * (device orientation, not stream orientation): if the stream delivers a
 * landscape frame while the device is held upright, the portrait format is
 * center-cropped out of it - no camera restart needed. Never upscales.
 */
export function computeCaptureRect(srcW, srcH, target, portrait) {
  const targetW = portrait ? target.short : target.long;
  const targetH = portrait ? target.long : target.short;
  const targetAspect = targetW / targetH;
  const srcAspect = srcW / srcH;

  let sW = srcW;
  let sH = srcH;
  let sx = 0;
  let sy = 0;

  // Center-Crop, um das Ziel-Aspect zu treffen
  if (srcAspect > targetAspect) {
    sW = Math.round(srcH * targetAspect);
    sx = Math.round((srcW - sW) / 2);
  } else if (srcAspect < targetAspect) {
    sH = Math.round(srcW / targetAspect);
    sy = Math.round((srcH - sH) / 2);
  }

  // Nicht hochskalieren: maximal 1:1
  const scale = Math.min(1, targetW / sW, targetH / sH);
  const outW = Math.max(1, Math.round(sW * scale));
  const outH = Math.max(1, Math.round(sH * scale));

  return { sx, sy, sW, sH, outW, outH };
}

/**
 * Aktuelle Bildschirm-Orientierung in Grad (0/90/180/270).
 */
function getOrientationAngle() {
  if (typeof screen !== "undefined" && screen.orientation && typeof screen.orientation.angle === "number") {
    return screen.orientation.angle;
  }
  if (typeof window !== "undefined" && typeof window.orientation === "number") {
    return (window.orientation + 360) % 360;
  }
  return 0;
}

/**
 * Um wieviel Grad (0/90/270, gegen den Uhrzeigersinn) muss ein Frame gedreht
 * werden, damit sein Inhalt wieder aufrecht ist?
 *
 * Der Browser backt die Rotationskorrektur des Kamera-Streams beim Start
 * fest ein. Dreht man das Geraet danach physisch, ist der Bildinhalt der
 * Frames um die Orientierungs-Differenz verdreht. Browser, die den laufenden
 * Stream selbst anpassen, liefern Frames bereits in Geraete-Orientierung -
 * dann ist keine Korrektur noetig (erkennbar an den Frame-Dimensionen).
 */
export function computeFrameRotation({ startAngle, currentAngle, srcW, srcH, devicePortrait }) {
  const delta = (((currentAngle - startAngle) % 360) + 360) % 360;
  if (delta === 0) return 0;
  // 180-Grad-Drehung ist ueber Dimensionen nicht erkennbar; auf Handys
  // meist ohnehin deaktiviert - nicht korrigieren
  if (delta === 180) return 0;
  // Frame entspricht bereits der Geraete-Orientierung -> Browser hat den
  // Stream selbst angepasst, nichts tun (bei quadratischen Frames nicht
  // entscheidbar -> Korrektur anwenden)
  const framePortrait = srcH > srcW;
  if (srcW !== srcH && framePortrait === devicePortrait) return 0;
  return delta;
}

/**
 * Dreht einen Frame um 90/270 Grad (CCW) in einen aufrechten Offscreen-Canvas.
 */
function rotateToUpright(source, srcW, srcH, rotationCcw) {
  const canvas = document.createElement("canvas");
  canvas.width = srcH;
  canvas.height = srcW;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((-rotationCcw * Math.PI) / 180);
  ctx.drawImage(source, -srcW / 2, -srcH / 2, srcW, srcH);
  return canvas;
}

function drawScaled(source, srcW, srcH, target, portrait, jpegQuality) {
  const { sx, sy, sW, sH, outW, outH } = computeCaptureRect(srcW, srcH, target, portrait);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(source, sx, sy, sW, sH, 0, 0, outW, outH);

  return canvas.toDataURL("image/jpeg", jpegQuality);
}

export function useCameraCapture({ sessionId, onSendPhoto, onCapabilitiesChange, t }) {
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [quality, setQuality] = useState("M");
  const [isStartingCamera, setIsStartingCamera] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const imageCaptureRef = useRef(null);
  // Bildschirm-Orientierung beim Stream-Start: der Browser fixiert die
  // Rotationskorrektur des Streams zu diesem Zeitpunkt
  const streamStartAngleRef = useRef(0);
  const [previewRotation, setPreviewRotation] = useState(0);
  const reportInfo = useCallback(
    (payload) => {
      if (!onCapabilitiesChange) return;
      onCapabilitiesChange(payload);
    },
    [onCapabilitiesChange]
  );

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    imageCaptureRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  // Sucher-Korrektur: Wenn der Frame-Inhalt relativ zur Geraetelage verdreht
  // ist, wird das <video> per CSS-Transform zurueckgedreht. Neu berechnen bei
  // Orientierungswechsel und wenn der Browser die Frame-Groesse anpasst.
  const updatePreviewRotation = useCallback(() => {
    const v = videoRef.current;
    if (!streamRef.current || !v || !v.videoWidth) {
      setPreviewRotation(0);
      return;
    }
    const devicePortrait = window.matchMedia?.("(orientation: portrait)")?.matches ?? true;
    setPreviewRotation(
      computeFrameRotation({
        startAngle: streamStartAngleRef.current,
        currentAngle: getOrientationAngle(),
        srcW: v.videoWidth,
        srcH: v.videoHeight,
        devicePortrait,
      })
    );
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError("");
    stopCamera();

    try {
      // Aufloesung passend zur aktuellen Geraete-Orientierung anfordern,
      // damit der Feed direkt richtig herum startet (quer -> Widescreen)
      const landscape = window.matchMedia?.("(orientation: landscape)")?.matches ?? false;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: landscape ? 2560 : 1440 },
          height: { ideal: landscape ? 1440 : 2560 },
        },
        audio: false,
      });

      streamRef.current = stream;
      streamStartAngleRef.current = getOrientationAngle();

      const track = stream.getVideoTracks()[0];
      if (track && track.getCapabilities) {
        // Keine applyConstraints-Nachverhandlung: Die initialen Constraints
        // fordern die Aufloesung bereits orientierungsabhaengig an; ein
        // nachtraegliches Pinnen von width/height/aspect verleitet den
        // Browser zu Crops (quadratischer Stream) und verhindert, dass er
        // den Stream bei Rotation selbst anpassen kann.
        const caps = track.getCapabilities();
        const settings = track.getSettings ? track.getSettings() : {};
        reportInfo({
          type: "track",
          caps,
          settings,
        });
      }

      if (track && "ImageCapture" in window) {
        try {
          imageCaptureRef.current = new window.ImageCapture(track);
        } catch {
          imageCaptureRef.current = null;
        }
      }

      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        try {
          await v.play();
        } catch {
          // ignore; some browsers require a user gesture despite the button
        }
        await new Promise((res) => {
          if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && v.videoWidth > 0) return res();
          let settled = false;

          const onLoaded = () => {
            if (!settled) {
              settled = true;
              cleanup();
              res();
            }
          };

          const onFrame = () => {
            if (!settled && v.videoWidth > 0) {
              settled = true;
              cleanup();
              res();
            }
          };

          const cleanup = () => {
            v.removeEventListener("loadeddata", onLoaded);
            if (v.cancelVideoFrameCallback && vfId != null) v.cancelVideoFrameCallback(vfId);
            clearTimeout(timeout);
            if (track) {
              track.removeEventListener("unmute", onFrame);
              track.removeEventListener("mute", onFrame);
            }
          };

          v.addEventListener("loadeddata", onLoaded);

          let vfId = null;
          if (v.requestVideoFrameCallback) {
            const loop = () => {
              if (settled) return;
              if (v.videoWidth > 0) {
                onFrame();
                return;
              }
              vfId = v.requestVideoFrameCallback(loop);
            };
            vfId = v.requestVideoFrameCallback(loop);
          }

          const track = stream.getVideoTracks()[0];
          if (track && "ImageCapture" in window) {
            const imgCap = new ImageCapture(track);
            const tryGrab = async () => {
              try {
                const bmp = await imgCap.grabFrame();
                if (bmp && bmp.width && bmp.height) {
                  const off = document.createElement("canvas");
                  off.width = bmp.width;
                  off.height = bmp.height;
                  off.getContext("2d").drawImage(bmp, 0, 0);
                }
              } catch {
                // ignore
              }
            };
            tryGrab();
          }
          if (track) {
            track.addEventListener("unmute", onFrame);
            track.addEventListener("mute", onFrame);
          }

          const timeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              cleanup();
              res();
            }
          }, 3000);
        });
      }

      setCameraReady(true);
      updatePreviewRotation();
    } catch (err) {
      setCameraError(err?.message ?? (t ? t("errors.cameraPermissionDenied") : "Camera permission denied"));
      setCameraReady(false);
    }
  }, [reportInfo, stopCamera, updatePreviewRotation]);

  const takePhotoAndSend = useCallback(async () => {
    if (!cameraReady || !videoRef.current || !sessionId) return;

    const target = getCaptureTarget(quality);
    // Die Geraete-Orientierung bestimmt das Foto-Format - nicht die
    // Orientierung des gelieferten Frames (der Stream kann nach einer
    // Drehung noch in der alten Orientierung liefern)
    const devicePortrait = window.matchMedia?.("(orientation: portrait)")?.matches ?? null;

    const trySend = (source, srcW, srcH) => {
      const portrait = devicePortrait ?? srcH >= srcW;

      // Hat sich das Geraet seit Stream-Start gedreht, ist der Bildinhalt
      // der Frames verdreht -> rechnerisch zurueckdrehen (kein Neustart)
      const rotation = computeFrameRotation({
        startAngle: streamStartAngleRef.current,
        currentAngle: getOrientationAngle(),
        srcW,
        srcH,
        devicePortrait: portrait,
      });

      let src = source;
      let w = srcW;
      let h = srcH;
      if (rotation === 90 || rotation === 270) {
        src = rotateToUpright(source, srcW, srcH, rotation);
        w = srcH;
        h = srcW;
      }

      const dataUrl = drawScaled(src, w, h, target, portrait, target.jpeg);
      onSendPhoto?.(dataUrl);
      if (navigator.vibrate) navigator.vibrate(20);
    };

    // 1) Versuche ImageCapture.takePhoto() fuer volle Aufloesung
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (track && imageCaptureRef.current && imageCaptureRef.current.takePhoto) {
      try {
        const blob = await imageCaptureRef.current.takePhoto();
        const bmp = await createImageBitmap(blob);
        reportInfo({ type: "photo", source: "takePhoto", width: bmp.width, height: bmp.height });
        trySend(bmp, bmp.width, bmp.height);
        return;
    } catch {
      // Fallback auf Video-Frame
    }
    }

    // 2) Fallback: Video-Frame nutzen (mit Crop/Downscale, kein Upscale)
    const v = videoRef.current;
    if (!v.videoWidth || !v.videoHeight) {
      setCameraError(t ? t("errors.noVideoFrame") : "No video frame yet - versuche erneut");
      return;
    }
    reportInfo({ type: "photo", source: "video", width: v.videoWidth, height: v.videoHeight });
    trySend(v, v.videoWidth, v.videoHeight);
  }, [cameraReady, onSendPhoto, quality, reportInfo, sessionId]);

  const handleFiles = useCallback(
    async (fileList) => {
      if (!fileList || !fileList.length) return;

      const toDataUrl = (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

      for (const file of Array.from(fileList)) {
        try {
          if (!file?.type?.startsWith("image/")) continue;
          const dataUrl = await toDataUrl(file);
          if (dataUrl) onSendPhoto?.(dataUrl);
          if (navigator.vibrate) navigator.vibrate(10);
        } catch (e) {
          setCameraError(e?.message || (t ? t("errors.uploadFailed") : "Upload fehlgeschlagen"));
        }
      }
    },
    [onSendPhoto]
  );

  const handleStartCamera = useCallback(
    async (e) => {
      e?.stopPropagation?.();
      if (!sessionId || isStartingCamera) return;
      setCameraError("");
      setIsStartingCamera(true);
      await startCamera();
      setIsStartingCamera(false);
    },
    [isStartingCamera, sessionId, startCamera]
  );

  const handleShutter = useCallback(async (e) => {
    e?.stopPropagation?.();
    await takePhotoAndSend();
  }, [takePhotoAndSend]);

  const handleStopCamera = useCallback(
    (e) => {
      e?.stopPropagation?.();
      stopCamera();
      setCameraError("");
    },
    [stopCamera]
  );

  useEffect(() => {
    const mql = window.matchMedia?.("(orientation: portrait)");
    const v = videoRef.current;
    mql?.addEventListener?.("change", updatePreviewRotation);
    v?.addEventListener?.("resize", updatePreviewRotation);
    return () => {
      mql?.removeEventListener?.("change", updatePreviewRotation);
      v?.removeEventListener?.("resize", updatePreviewRotation);
    };
  }, [updatePreviewRotation]);

  // stop camera when tab/page goes inactive
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopCamera();
      }
    };
    const onBeforeUnload = () => stopCamera();

    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stopCamera);
    window.addEventListener("blur", stopCamera);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stopCamera);
      window.removeEventListener("blur", stopCamera);
      window.removeEventListener("beforeunload", onBeforeUnload);
      stopCamera();
    };
  }, [stopCamera]);

  return {
    videoRef,
    cameraReady,
    cameraError,
    isStartingCamera,
    previewRotation,
    handleStartCamera,
    handleShutter,
    handleStopCamera,
    setCameraError,
    setIsStartingCamera,
    setCameraReady,
    quality,
    setQuality,
    handleFiles,
  };
}
