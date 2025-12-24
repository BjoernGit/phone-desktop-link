import React from "react";

export function MobileDebugPill({ sessionId, sessionSeed, sessionKeyB64, encStatus, offerStatus, qrStatus, onSeedChange }) {
  return (
    <div className="mobileDebugPill">
      <div className="pillLine">Session: {sessionId || "n/a"}</div>
      <label className="pillLine pillLabel">
        Seed:
        <input
          className="pillInput"
          value={sessionSeed || ""}
          placeholder="seed"
          onChange={(e) => onSeedChange(e.target.value)}
        />
      </label>
      <div className="pillLine">Key: {sessionKeyB64 || "n/a"}</div>
      <div className="pillLine">ENC: {encStatus}</div>
      {offerStatus && <div className="pillLine">Offer: {offerStatus}</div>}
      {qrStatus && <div className="pillLine">{qrStatus}</div>}
    </div>
  );
}
