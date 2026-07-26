import React from "react";
import { useTranslation } from "react-i18next";
import { formatFileSize, getFileIcon } from "../utils/fileUtils";

function getDeviceName(ownerUuid, peers, clientUuid) {
  if (ownerUuid === clientUuid) {
    return `Dieses Gerät (${clientUuid.slice(0, 8)})`;
  }
  const peer = peers.find((p) => p.clientUuid === ownerUuid);
  if (peer) {
    // Show device name if available, otherwise show short UUID
    const shortUuid = peer.clientUuid ? peer.clientUuid.slice(0, 8) : '?';
    return peer.deviceName ? `${peer.deviceName} (${shortUuid})` : shortUuid;
  }
  // Fallback: show short UUID even if peer not found (for late joiners)
  return ownerUuid ? ownerUuid.slice(0, 8) : "Unbekannt";
}

// A transfer that is actively moving data right now
function isTransferActive(transfer) {
  return transfer?.status === "sending" || transfer?.status === "receiving";
}

// A transfer that has stalled - the download is being retried in the background
function isTransferStalled(transfer) {
  return transfer?.status === "failed" || transfer?.status === "timeout";
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
  pendingDownloads = new Set(),
  connectionStates = new Map(),
}) {
  const { t } = useTranslation();

  if (files.length === 0) {
    return (
      <div className="fileGallery">
        <div className="fileGalleryEmpty">
          {t(
            "desktop.fileGallery.empty",
            "Keine Dateien verfügbar. Klicke auf \"Dateien auswählen\" oder warte bis andere Teilnehmer Dateien bereitstellen."
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fileGallery">
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

            // Click registered, but no data is flowing yet (connect / retry)
            const isPending =
              pendingDownloads.has(file.id) && (!transfer || isTransferStalled(transfer));
            const isActive = !isPending && isTransferActive(transfer);
            const rowClass = [
              "fileTableRow",
              isPending ? "isPending" : "",
              isActive ? "isTransferring" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div key={file.id} className={rowClass}>
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
                  {isPending ? (
                    <span className="statusPending">
                      <span className="statusPendingDot"></span>
                      {t("desktop.fileGallery.preparing", "Verbindung wird aufgebaut …")}
                    </span>
                  ) : transfer ? (
                    <div className="transferStatus">
                      <div className="transferProgress">
                        <div
                          className={`transferProgressBar${isActive ? " isActive" : ""}`}
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
                  ) : isPending ? (
                    <button
                      className="fileDownloadBtn isPending"
                      disabled
                      title={t("desktop.fileGallery.preparing", "Verbindung wird aufgebaut …")}
                    >
                      {t("desktop.fileGallery.requested", "Angefordert …")}
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
                  ) : isActive ? (
                    <span className="transferActive">
                      {t("desktop.fileGallery.transferring", "Überträgt …")}
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
