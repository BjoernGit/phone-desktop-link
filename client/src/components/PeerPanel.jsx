import { forwardRef } from "react";
import { useTranslation } from "react-i18next";

export const PeerPanel = forwardRef(function PeerPanel({ peers, hasConnection, style }, ref) {
  const { t } = useTranslation();
  const peerCount = peers.length;

  return (
    <div className="peerPanel" ref={ref} style={style}>
      <div className="panelTitle">{t("desktop.peers.title")}</div>
      <div className="panelMeta">
        <span className={`pill ${hasConnection ? "ok" : "wait"}`}>
          <span className="dot" />
          {hasConnection ? `${peerCount} ${t("desktop.peers.connected")}` : t("desktop.peers.waiting")}
        </span>
      </div>
      {hasConnection ? (
        <div className="peerList">
          {peers.map((p) => (
            <span key={p.id} className="peerTag">
              {(p.name || p.role) + (p.clientUuid ? ` (${p.clientUuid.slice(0, 6)})` : "")}
            </span>
          ))}
        </div>
      ) : (
        <div className="peerEmpty">{t("desktop.peers.empty")}</div>
      )}
    </div>
  );
});
