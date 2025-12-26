import { useEffect } from "react";
import jsQR from "jsqr";

function parseQrUrl(raw) {
  try {
    const url = new URL(raw);
    const session = url.searchParams.get("session") || "";
    const targetUuid = url.searchParams.get("uid") || "";
    const seed = url.hash ? new URLSearchParams(url.hash.replace(/^#/, "")).get("seed") || "" : "";
    return { session, seed, targetUuid, raw };
  } catch {
    return { session: "", seed: "", raw };
  }
}

export function useQrScanner({ enabled, videoRef, onResult, onStart, onStop }) {
  useEffect(() => {
    if (!enabled) return undefined;
    onStart?.();
    let active = true;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const scan = () => {
      if (!active) return;
      const v = videoRef.current;
      if (!v || !v.videoWidth || !v.videoHeight) {
        requestAnimationFrame(scan);
        return;
      }
      const maxW = 320;
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
          onResult?.(parsed);
          return;
        }
      }
      requestAnimationFrame(scan);
    };

    requestAnimationFrame(scan);
    return () => {
      active = false;
      onStop?.();
    };
  }, [enabled, videoRef, onResult, onStart, onStop]);
}
