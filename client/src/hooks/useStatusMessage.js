import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Small helper to handle short-lived status messages with auto-clear timeouts.
 */
export function useStatusMessage(defaultTimeout = 1500) {
  const [message, setMessage] = useState("");
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setMessage("");
  }, []);

  const show = useCallback(
    (msg, duration = defaultTimeout) => {
      if (!msg) {
        clear();
        return;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      setMessage(msg);
      timerRef.current = setTimeout(() => {
        setMessage("");
        timerRef.current = null;
      }, duration);
    },
    [clear, defaultTimeout]
  );

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    []
  );

  return { message, show, clear, setMessage };
}
