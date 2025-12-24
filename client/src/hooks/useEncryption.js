import { useCallback, useState } from "react";
import { deriveAesKeyFromSeed, exportAesKeyBase64Url } from "../utils/crypto";

export function useEncryption(sessionId, setEncStatus) {
  const [sessionKey, setSessionKey] = useState(null);
  const [sessionKeyB64, setSessionKeyB64] = useState("");

  const applySeed = useCallback(
    async (seed, sessionOverride) => {
      const sid = sessionOverride || sessionId;
      if (!seed || !sid) {
        setSessionKey(null);
        setSessionKeyB64("");
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
        setSessionKey(null);
        setSessionKeyB64("");
        setEncStatus?.("key-error");
      }
    },
    [sessionId, setEncStatus]
  );

  return { sessionKey, sessionKeyB64, applySeed };
}
