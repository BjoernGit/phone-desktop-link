import { forwardRef } from "react";

export const PeerPanel = forwardRef(function PeerPanel({ peers, hasConnection, style }, ref) {
  const peerCount = peers.length;
  return (
    <div className="peerPanel" ref={ref} style={style}>
      <div className="panelTitle">Verbundene Ger&auml;te</div>
      <div className="panelMeta">
        <span className={`pill ${hasConnection ? "ok" : "wait"}`}>
          <span className="dot" />
          {hasConnection ? `${peerCount} Ger&auml;t(e) verbunden` : "Wartet auf Verbindung"}
        </span>
      </div>
      {hasConnection ? (
        <div className="peerList">
          {peers.map((p) => (
            <span key={p.id} className="peerTag">
              {p.name || p.role}
            </span>
          ))}
        </div>
      ) : (
        <div className="peerEmpty">Verbinde ein Ger&auml;t, um neue Fotos zu senden.</div>
      )}
    </div>
  );
});
