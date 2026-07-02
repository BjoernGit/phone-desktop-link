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
 * The fixed quality format is applied in the source's orientation
 * (landscape source -> landscape format), center-cropping the source to
 * the target aspect. Never upscales.
 */
export function computeCaptureRect(srcW, srcH, target) {
  const landscape = srcW >= srcH;
  const targetW = landscape ? target.long : target.short;
  const targetH = landscape ? target.short : target.long;
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

function drawScaled(source, srcW, srcH, target, jpegQuality) {
  const { sx, sy, sW, sH, outW, outH } = computeCaptureRect(srcW, srcH, target);

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

      const track = stream.getVideoTracks()[0];
      if (track && track.getCapabilities) {
        const caps = track.getCapabilities();
        const settings = track.getSettings ? track.getSettings() : {};
        // Versuche moeglichst hohe Aufloesung per applyConstraints - aber
        // unter Beibehaltung des gelieferten Seitenverhaeltnisses.
        // width.max UND height.max gleichzeitig anzufordern erlaubt Chrome,
        // den Stream auf diese Kombination zu croppen (bei gleichen Maxima
        // wird er quadratisch).
        const aspect =
          settings.aspectRatio ||
          (settings.width && settings.height ? settings.width / settings.height : 0);
        if (track.applyConstraints && caps.width?.max && aspect) {
          const maxW = caps.width.max;
          const maxH = caps.height?.max || Math.round(maxW / aspect);
          let targetW = maxW;
          let targetH = Math.round(maxW / aspect);
          if (targetH > maxH) {
            targetH = maxH;
            targetW = Math.round(maxH * aspect);
          }
          try {
            await track.applyConstraints({
              width: { ideal: targetW },
              height: { ideal: targetH },
              aspectRatio: { ideal: aspect },
            });
          } catch {
            // ignorieren, fallback auf vorhandene Settings
          }
        }
        const finalSettings = track.getSettings ? track.getSettings() : {};
        reportInfo({
          type: "track",
          caps,
          settings: finalSettings,
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
    } catch (err) {
      setCameraError(err?.message ?? (t ? t("errors.cameraPermissionDenied") : "Camera permission denied"));
      setCameraReady(false);
    }
  }, [reportInfo, stopCamera]);

  const takePhotoAndSend = useCallback(async () => {
    if (!cameraReady || !videoRef.current || !sessionId) return;

    const target = getCaptureTarget(quality);

    const trySend = (source, srcW, srcH) => {
      const dataUrl = drawScaled(source, srcW, srcH, target, target.jpeg);
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

  // Restart the camera when the device orientation changes while active.
  // The stream is negotiated for one orientation; after a rotation the feed
  // would otherwise keep the old orientation and render sideways/letterboxed.
  useEffect(() => {
    const mql = window.matchMedia?.("(orientation: landscape)");
    if (!mql?.addEventListener) return undefined;

    const onOrientationChange = () => {
      if (!streamRef.current) return; // camera not running
      startCamera();
    };

    mql.addEventListener("change", onOrientationChange);
    return () => mql.removeEventListener("change", onOrientationChange);
  }, [startCamera]);

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
