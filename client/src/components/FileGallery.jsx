import React from "react";
import { useTranslation } from "react-i18next";
import { formatFileSize, getFileIcon } from "../utils/fileUtils";

function getDeviceName(ownerUuid, peers, clientUuid) {
  if (ownerUuid === clientUuid) {
    return "Dieses Gerät";
  }
  const peer = peers.find((p) => p.clientUuid === ownerUuid);
  return peer?.deviceName || "Unbekannt";
}

function getTransferStatus(file, transfers) {
  // First try direct lookup by file.id (for sender-side transfers)
  let transfer = transfers.get(file.id);
  if (transfer) return transfer;

  // Then search by fileId property (for receiver-side transfers)
  for (const t of transfers.values()) {
    if (t.fileId === file.id) {
      return t;
    }
  }
  return null;
}

export function FileGallery({
  files = [],
  peers = [],
  clientUuid,
  onDownload,
  onRemoveFile,
  transfers = new Map(),
  connectionStates = new Map(),
}) {
  const { t } = useTranslation();

  if (files.length === 0) {
    return (
      <div className="fileGallery">
        <div className="galleryHeader">
          <h2>{t("desktop.fileGallery.title", "Verfügbare Dateien")}</h2>
        </div>
        <div className="fileGalleryEmpty">
          {t(
            "desktop.fileGallery.empty",
            "Keine Dateien verfügbar. Füge Dateien im Upload-Panel hinzu oder warte bis andere Teilnehmer Dateien teilen."
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fileGallery">
      <div className="galleryHeader">
        <h2>{t("desktop.fileGallery.title", "Verfügbare Dateien")}</h2>
        <span className="fileCount">
          {files.length} {files.length === 1 ? "Datei" : "Dateien"}
        </span>
      </div>

      <div className="fileTable">
        <div className="fileTableHeader">
          <div className="fileTableCol fileColIcon"></div>
          <div className="fileTableCol fileColName">
            {t("desktop.fileGallery.fileName", "Name")}
          </div>
          <div className="fileTableCol fileColSize">
            {t("desktop.fileGallery.fileSize", "Größe")}
          </div>
          <div className="fileTableCol fileColOwner">
            {t("desktop.fileGallery.fileOwner", "Besitzer")}
          </div>
          <div className="fileTableCol fileColStatus">
            {t("desktop.fileGallery.fileStatus", "Status")}
          </div>
          <div className="fileTableCol fileColAction"></div>
        </div>

        <div className="fileTableBody">
          {files.map((file) => {
            const transfer = getTransferStatus(file, transfers);
            const isOwn = file.ownerUuid === clientUuid;
            const connectionState = connectionStates.get(file.ownerUuid);

            return (
              <div key={file.id} className="fileTableRow">
                <div className="fileTableCol fileColIcon">
                  <span className="fileIcon">{getFileIcon(file.name)}</span>
                </div>

                <div className="fileTableCol fileColName">
                  <div className="fileNameText" title={file.name}>
                    {file.name}
                  </div>
                </div>

                <div className="fileTableCol fileColSize">
                  {formatFileSize(file.size)}
                </div>

                <div className="fileTableCol fileColOwner">
                  {getDeviceName(file.ownerUuid, peers, clientUuid)}
                </div>

                <div className="fileTableCol fileColStatus">
                  {transfer ? (
                    <div className="transferStatus">
                      <div className="transferProgress">
                        <div
                          className="transferProgressBar"
                          style={{ width: `${transfer.progress}%` }}
                        ></div>
                      </div>
                      <span className="transferPercent">{transfer.progress}%</span>
                    </div>
                  ) : connectionState === "connected" ? (
                    <span className="statusConnected">●</span>
                  ) : isOwn ? (
                    <span className="statusOwn">-</span>
                  ) : (
                    <span className="statusAvailable">
                      {t("desktop.fileGallery.available", "Verfügbar")}
                    </span>
                  )}
                </div>

                <div className="fileTableCol fileColAction">
                  {isOwn ? (
                    <button
                      className="fileRemoveBtn"
                      onClick={() => onRemoveFile && onRemoveFile(file.id)}
                      title={t("desktop.fileUpload.remove", "Entfernen")}
                    >
                      ✕
                    </button>
                  ) : !transfer ? (
                    <button
                      className="fileDownloadBtn"
                      onClick={() => onDownload(file)}
                    >
                      {t("desktop.fileGallery.download", "Download")}
                    </button>
                  ) : transfer.status === "completed" ? (
                    <span className="transferComplete">
                      {t("desktop.fileGallery.completed", "✓")}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
