import { useCallback, useEffect, useRef, useState } from "react";

function getCaptureTarget(quality) {
  switch (quality) {
    case "S":
      return { width: 360, height: 640, jpeg: 0.75 };
    case "M":
      return { width: 720, height: 1280, jpeg: 0.82 };
    case "L":
      return { width: 1080, height: 1920, jpeg: 0.88 };
    case "XL":
      return { width: 1440, height: 2560, jpeg: 0.9 };
    default:
      return { width: 720, height: 1280, jpeg: 0.82 };
  }
}

function drawScaled(source, srcW, srcH, targetW, targetH, jpegQuality) {
  const targetAspect = targetW / targetH;
  const srcAspect = srcW / srcH;

  let sW = srcW;
  let sH = srcH;
  let sx = 0;
  let sy = 0;

  // Crop, um das Ziel-Aspect zu treffen
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

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(source, sx, sy, sW, sH, 0, 0, outW, outH);

  return canvas.toDataURL("image/jpeg", jpegQuality);
}

export function useCameraCapture({ sessionId, onSendPhoto, onCapabilitiesChange }) {
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
        audio: false,
      });

      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      if (track && track.getCapabilities) {
        const caps = track.getCapabilities();
        // Versuche moeglichst hohe Aufloesung per applyConstraints
        const targetW = caps.width?.max || 2560;
        const targetH = caps.height?.max || 2560;
        if (targetW && targetH && track.applyConstraints) {
          try {
            await track.applyConstraints({
              width: { ideal: targetW },
              height: { ideal: targetH },
            });
          } catch (e) {
            // ignorieren, fallback auf vorhandene Settings
          }
        }
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
        } catch (e) {
          imageCaptureRef.current = null;
        }
      }

      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        try {
          await v.play();
        } catch (e) {
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
              } catch (e) {
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
      setCameraError(err?.message ?? "Camera permission denied");
      setCameraReady(false);
    }
  }, [stopCamera]);

  const takePhotoAndSend = useCallback(async () => {
    if (!cameraReady || !videoRef.current || !sessionId) return;

    const { width: targetW, height: targetH, jpeg } = getCaptureTarget(quality);

    const trySend = (source, srcW, srcH) => {
      const dataUrl = drawScaled(source, srcW, srcH, targetW, targetH, jpeg);
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
      } catch (e) {
        // Fallback auf Video-Frame
      }
    }

    // 2) Fallback: Video-Frame nutzen (mit Crop/Downscale, kein Upscale)
    const v = videoRef.current;
    if (!v.videoWidth || !v.videoHeight) {
      setCameraError("No video frame yet - versuche erneut");
      return;
    }
    reportInfo({ type: "photo", source: "video", width: v.videoWidth, height: v.videoHeight });
    trySend(v, v.videoWidth, v.videoHeight);
  }, [cameraReady, onSendPhoto, quality, sessionId]);

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
          setCameraError(e?.message || "Upload fehlgeschlagen");
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
