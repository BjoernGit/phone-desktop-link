import { useCallback, useRef } from "react";

/**
 * Hook for handling touch swipe gestures on mobile
 * Provides circular navigation between views: camera ↔ qrDisplay ↔ gallery
 *
 * @param {string} mobileView - Current mobile view ("camera" | "qrDisplay" | "gallery")
 * @param {function} setMobileView - Setter for mobile view
 * @returns {{ handleTouchStart: function, handleTouchEnd: function }}
 */
export function useAppTouchGestures(mobileView, setMobileView) {
  const touchStartRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
    const t = e.changedTouches?.[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (e) => {
      const start = touchStartRef.current;
      const t = e.changedTouches?.[0];
      touchStartRef.current = null;
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;

      // Only handle clear horizontal swipes (min 40px, more horizontal than vertical)
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;

      // Circular navigation: qrDisplay ← camera → gallery (and wraps around)
      // Layout: [gallery] → [qrDisplay] ← [camera] → [gallery] (infinite loop)
      if (dx < -40) {
        // Swipe left (finger moves left, content moves right)
        if (mobileView === "camera") setMobileView("gallery");
        else if (mobileView === "gallery") setMobileView("qrDisplay");
        else if (mobileView === "qrDisplay") setMobileView("camera");
      } else if (dx > 40) {
        // Swipe right (finger moves right, content moves left)
        if (mobileView === "camera") setMobileView("qrDisplay");
        else if (mobileView === "qrDisplay") setMobileView("gallery");
        else if (mobileView === "gallery") setMobileView("camera");
      }
    },
    [mobileView, setMobileView]
  );

  return {
    handleTouchStart,
    handleTouchEnd,
  };
}
