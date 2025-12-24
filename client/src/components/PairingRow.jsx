import React from "react";
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
}) {
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
      />
      <QrPanel
        ref={qrPanelRef}
        value={url}
        size={qrSize}
        label={qrDocked ? "Weitere Geraete koppeln" : "Scanne den QR-Code"}
        className={qrDocked ? "docked" : "centered"}
      />
    </section>
  );
}
