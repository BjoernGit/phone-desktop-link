import { forwardRef } from "react";
import { useTranslation } from "react-i18next";

function getRoleIcon(role) {
  if (role === "mobile") {
    return "📱";
  }
  return "💻";
}

export const PeerPanel = forwardRef(function PeerPanel({
  peers,
  hasConnection,
  style,
  pendingPeers = [],
  onApprovePeer,
  onRejectPeer
}, ref) {
  const { t } = useTranslation();

  return (
    <div className="peerPanel" ref={ref} style={style}>
      <div className="panelTitle">{t("desktop.peers.title")}</div>
      {hasConnection ? (
        <div className="peerListTable">
          {peers.map((p) => {
            const isPending = pendingPeers.includes(p.clientUuid);
            return (
              <div key={p.id} className={`peerListItem ${isPending ? "pending" : ""}`}>
                <span className="peerIcon" title={p.role}>
                  {getRoleIcon(p.role)}
                </span>
                <div className="peerInfo">
                  <div className="peerName">{p.name || "Gerät"}</div>
                  <div className="peerUuid" title={p.clientUuid}>
                    {p.clientUuid || "N/A"}
                  </div>
                </div>
                {isPending && (
                  <div className="peerActions">
                    <button
                      type="button"
                      className="peerActionBtn rejectBtn"
                      onClick={() => onRejectPeer?.(p.clientUuid)}
                    >
                      {t("common.buttons.reject", "Ablehnen")}
                    </button>
                    <button
                      type="button"
                      className="peerActionBtn approveBtn"
                      onClick={() => onApprovePeer?.(p.clientUuid)}
                    >
                      {t("common.buttons.approve", "Zulassen")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="peerEmpty">{t("desktop.peers.empty")}</div>
      )}
    </div>
  );
});
