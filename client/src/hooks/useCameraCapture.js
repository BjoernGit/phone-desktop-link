import { useCallback, useEffect, useRef, useState } from "react";

function getCaptureTarget(quality) {
  switch (quality) {
    case "small":
      return { width: 640, height: 360, jpeg: 0.65 };
    case "medium":
      return { width: 1280, height: 720, jpeg: 0.75 };
    case "large":
      return { width: 1920, height: 1080, jpeg: 0.8 };
    case "xlarge":
      return { width: 2560, height: 1440, jpeg: 0.82 };
    default:
      return { width: 1280, height: 720, jpeg: 0.75 };
  }
}

export function useCameraCapture({ sessionId, onSendPhoto }) {
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [quality, setQuality] = useState("medium");
  const [isStartingCamera, setIsStartingCamera] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError("");
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });

      streamRef.current = stream;
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

    const v = videoRef.current;
    if (!v.videoWidth || !v.videoHeight) {
      setCameraError("No video frame yet - versuche erneut");
      return;
    }

    let { width: targetW, height: targetH, jpeg } = getCaptureTarget(quality);
    const isPortrait = v.videoHeight > v.videoWidth || window.innerHeight > window.innerWidth;
    if (isPortrait) {
      targetW = 720;
      targetH = 1280;
    }

    if (v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || v.videoWidth === 0) {
      await new Promise((res) => {
        let settled = false;
        const onLoaded = () => {
          if (!settled) {
            settled = true;
            cleanup();
            res();
          }
        };
        const cleanup = () => {
          v.removeEventListener("loadeddata", onLoaded);
          clearTimeout(timeout);
        };
        v.addEventListener("loadeddata", onLoaded);
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            cleanup();
            res();
          }
        }, 500);
      });
    }

    const vw = v.videoWidth || targetW;
    const vh = v.videoHeight || targetH;
    const srcAspect = vw / vh;
    const targetAspect = targetW / targetH;

    let sx = 0;
    let sy = 0;
    let sW = vw;
    let sH = vh;

    if (srcAspect > targetAspect) {
      sW = Math.round(vh * targetAspect);
      sx = Math.round((vw - sW) / 2);
    } else if (srcAspect < targetAspect) {
      sH = Math.round(vw / targetAspect);
      sy = Math.round((vh - sH) / 2);
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d", { alpha: false });

    const maxTries = 3;
    let tries = 0;
    let sent = false;

    while (tries < maxTries && !sent) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(v, sx, sy, sW, sH, 0, 0, targetW, targetH);

      try {
        const sampleW = Math.min(20, canvas.width);
        const sampleH = Math.min(20, canvas.height);
        const sxp = Math.floor((canvas.width - sampleW) / 2);
        const syp = Math.floor((canvas.height - sampleH) / 2);
        const img = ctx.getImageData(sxp, syp, sampleW, sampleH).data;
        let sum = 0;
        for (let i = 0; i < img.length; i += 4) {
          sum += 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
        }
        const avg = sum / (sampleW * sampleH);
        if (avg < 12 && tries < maxTries - 1) {
          await new Promise((res) => setTimeout(res, 220));
          tries += 1;
          continue;
        }
      } catch (e) {
        // ignore and send once
      }

      const imageDataUrl = canvas.toDataURL("image/jpeg", jpeg);
      onSendPhoto?.(imageDataUrl);
      sent = true;
    }

    if (navigator.vibrate) navigator.vibrate(20);
  }, [cameraReady, onSendPhoto, quality, sessionId]);

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
    setQuality,
  };
}
