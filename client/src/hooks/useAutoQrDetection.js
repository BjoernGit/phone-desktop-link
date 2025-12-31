import { useEffect, useRef } from "react";
import jsQR from "jsqr";

function parseQrUrl(raw) {
  try {
    const url = new URL(raw);
    const session = url.searchParams.get("session") || "";
    const targetUuid = url.searchParams.get("uid") || "";
    const hashParams = url.hash ? new URLSearchParams(url.hash.replace(/^#/, "")) : new URLSearchParams();
    const seed = hashParams.get("seed") || "";
    const offerSecret = hashParams.get("ok") || "";
    const timestamp = hashParams.get("t") || "";
    return { session, seed, targetUuid, offerSecret, timestamp, raw };
  } catch {
    return { session: "", seed: "", offerSecret: "", timestamp: "", raw };
  }
}

/**
 * Hook for automatic low-res QR code detection in camera stream
 * Scans every N frames (default: 10) to detect QR codes without user interaction
 * 
 * @param {Object} options
 * @param {React.RefObject} options.videoRef - Reference to video element
 * @param {boolean} options.enabled - Whether detection is enabled (should be true when camera is ready)
 * @param {Function} options.onDetected - Callback when QR code is detected (receives parsed QR data)
 * @param {Function} [options.onLost] - Callback when QR code is no longer detected
 * @param {number} [options.scanInterval=10] - Number of frames to skip between scans
 */
export function useAutoQrDetection({ videoRef, enabled, onDetected, onLost, scanInterval = 10 }) {
  const frameCountRef = useRef(0);
  const detectedRef = useRef(false);
  const canvasRef = useRef(null);
  const lastDetectedSessionRef = useRef(null);

  useEffect(() => {
    if (!enabled) {
      frameCountRef.current = 0;
      detectedRef.current = false;
      return;
    }

    // Create canvas once for reuse
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    let active = true;

    const scan = () => {
      if (!active) return;

      frameCountRef.current++;
      
      // Only scan every N frames
      if (frameCountRef.current % scanInterval !== 0) {
        requestAnimationFrame(scan);
        return;
      }

      const v = videoRef.current;
      if (!v || !v.videoWidth || !v.videoHeight) {
        requestAnimationFrame(scan);
        return;
      }

      // Use low resolution for performance (max 240px width)
      const maxW = 240;
      const scale = Math.min(1, maxW / v.videoWidth);
      const w = Math.max(120, Math.round(v.videoWidth * scale));
      const h = Math.max(120, Math.round(v.videoHeight * scale));
      
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      
      const imgData = ctx.getImageData(0, 0, w, h);
      const result = jsQR(imgData.data, w, h);
      
      if (result?.data) {
        const parsed = parseQrUrl(result.data);
        if (parsed.session) {
          if (!detectedRef.current || lastDetectedSessionRef.current !== parsed.session) {
            detectedRef.current = true;
            lastDetectedSessionRef.current = parsed.session;
            onDetected?.(parsed);
            // Continue scanning to detect if QR disappears
          }
        } else {
          // QR code detected but no valid session - ignore
        }
      } else {
        // No QR code detected
        if (detectedRef.current) {
          detectedRef.current = false;
          lastDetectedSessionRef.current = null;
          onLost?.();
        }
      }

      requestAnimationFrame(scan);
    };

    requestAnimationFrame(scan);

    return () => {
      active = false;
      detectedRef.current = false;
      frameCountRef.current = 0;
    };
  }, [enabled, videoRef, onDetected, scanInterval]);

  // Reset detection state when enabled changes
  useEffect(() => {
    if (!enabled) {
      detectedRef.current = false;
    }
  }, [enabled]);
}

