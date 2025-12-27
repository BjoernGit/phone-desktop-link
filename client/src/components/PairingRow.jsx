import React from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
        label={qrDocked ? t("desktop.qr.pairMore") : t("desktop.qr.label")}
        className={qrDocked ? "docked" : "centered"}
      />
    </section>
  );
}
