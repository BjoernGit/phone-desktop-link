import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { FEATURE_FLAGS } from "../config/features";

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
  onRejectPeer,
  recentlyApprovedPeers = [],
  onSyncFiles
}, ref) {
  const { t } = useTranslation();

  return (
    <div className="peerPanel" ref={ref} style={style}>
      <div className="panelTitle">{t("desktop.peers.title")}</div>
      {hasConnection ? (
        <div className="peerListTable">
          {peers.map((p) => {
            const isPending = FEATURE_FLAGS.REQUIRE_DEVICE_APPROVAL && pendingPeers.includes(p.clientUuid);
            const isRecentlyApproved = FEATURE_FLAGS.MANUAL_FILE_SYNC && recentlyApprovedPeers.includes(p.clientUuid);
            return (
              <div key={p.id} className={`peerListItem ${isPending ? "pending" : ""} ${isRecentlyApproved ? "recentlyApproved" : ""}`}>
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
                {isRecentlyApproved && (
                  <div className="peerActions">
                    <button
                      type="button"
                      className="peerActionBtn syncBtn"
                      onClick={() => onSyncFiles?.(p.clientUuid)}
                    >
                      {t("desktop.peers.syncFiles", "Dateien synchronisieren")}
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
