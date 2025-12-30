import React from "react";
import { useTranslation } from "react-i18next";
import { PeerPanel } from "./PeerPanel";
import { QrPanel } from "./QrPanel";

export function PairingRow({
  qrSize,
  qrDocked,
  url,
  qrPanelRef,
  peerPanelRef,
  hasConnection,
  panelHeights,
  peers,
  pendingPeers,
  onApprovePeer,
  onRejectPeer,
}) {
  const { t } = useTranslation();
  return (
    <section
      className="pairingRow"
      style={{
        "--qr-size": `${qrSize}px`,
      }}
    >
      <PeerPanel
        ref={peerPanelRef}
        peers={peers}
        hasConnection={hasConnection}
        style={panelHeights?.qr ? { height: `${panelHeights.qr}px` } : undefined}
        pendingPeers={pendingPeers}
        onApprovePeer={onApprovePeer}
        onRejectPeer={onRejectPeer}
      />
      <QrPanel
        ref={qrPanelRef}
        value={url}
        size={qrSize}
        label={qrDocked ? t("desktop.qr.pairMore") : t("desktop.qr.label")}
        className={qrDocked ? "docked" : "centered"}
      />
    </section>
  );
}
