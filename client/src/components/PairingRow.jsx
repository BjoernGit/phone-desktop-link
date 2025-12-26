import React from "react";
import { PeerPanel } from "./PeerPanel";
import { QrPanel } from "./QrPanel";

export function PairingRow({
  uploadPanel,
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
      className={`pairingRow ${uploadPanel ? "withUpload" : ""}`}
      style={{
        "--qr-size": `${qrSize}px`,
      }}
    >
      {uploadPanel ? <div className="uploadPanel">{uploadPanel}</div> : null}
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
        label={qrDocked ? "Weitere Geräte koppeln" : "Scanne den QR-Code"}
        className={qrDocked ? "docked" : "centered"}
      />
    </section>
  );
}
