import { useCallback, useRef } from "react";

/**
 * Hook for handling touch swipe gestures on mobile
 * Provides circular navigation between views: camera → gallery → files → qrDisplay → camera
 *
 * @param {string} mobileView - Current mobile view ("camera" | "gallery" | "files" | "qrDisplay")
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

      // Circular navigation: camera → gallery → files → qrDisplay → camera (infinite loop)
      const ORDER = ["camera", "gallery", "files", "qrDisplay"];
      const idx = ORDER.indexOf(mobileView);
      if (idx === -1) return;

      if (dx < -40) {
        // Swipe left (finger moves left, content moves right)
        setMobileView(ORDER[(idx + 1) % ORDER.length]);
      } else if (dx > 40) {
        // Swipe right (finger moves right, content moves left)
        setMobileView(ORDER[(idx - 1 + ORDER.length) % ORDER.length]);
      }
    },
    [mobileView, setMobileView]
  );

  return {
    handleTouchStart,
    handleTouchEnd,
  };
}
