import { useCallback, useState } from "react";
import { deriveAesKeyFromSeed, exportAesKeyBase64Url } from "../utils/crypto";

export function useEncryption(sessionId, setEncStatus) {
  const [sessionKey, setSessionKey] = useState(null);
  const [sessionKeyB64, setSessionKeyB64] = useState("");

  const clearKey = useCallback(() => {
    setSessionKey(null);
    setSessionKeyB64("");
    setEncStatus?.("no-key");
  }, [setEncStatus]);

  const applySeed = useCallback(
    async (seed, sessionOverride) => {
      const sid = sessionOverride || sessionId;
      if (!seed || !sid) {
        clearKey();
        setEncStatus?.("missing-seed");
        return;
      }
      try {
        const key = await deriveAesKeyFromSeed(seed, sid);
        const keyB64 = await exportAesKeyBase64Url(key);
        setSessionKey(key);
        setSessionKeyB64(keyB64);
        setEncStatus?.("key-ready");
      } catch (e) {
        console.warn("Key derive/import failed", e);
        clearKey();
        setEncStatus?.("key-error");
      }
    },
    [sessionId, setEncStatus, clearKey]
  );

  return { sessionKey, sessionKeyB64, applySeed, clearKey };
}
