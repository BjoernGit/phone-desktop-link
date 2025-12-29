import React from "react";
import { useTranslation } from "react-i18next";

function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getFileIcon(fileName) {
  const ext = fileName.split(".").pop().toLowerCase();

  if (["pdf"].includes(ext)) return "📄";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📽️";
  if (["txt", "md"].includes(ext)) return "📃";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "📦";
  if (["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"].includes(ext)) return "🖼️";
  if (["mp4", "avi", "mov", "mkv", "webm"].includes(ext)) return "🎬";
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext)) return "🎵";
  if (["js", "jsx", "ts", "tsx", "json"].includes(ext)) return "💻";
  if (["html", "css", "scss"].includes(ext)) return "🌐";
  if (["py", "java", "cpp", "c", "cs"].includes(ext)) return "⚙️";

  return "📁";
}

function getDeviceName(ownerUuid, peers, clientUuid) {
  if (ownerUuid === clientUuid) {
    return "Dieses Gerät";
  }
  const peer = peers.find((p) => p.clientUuid === ownerUuid);
  return peer?.deviceName || "Unbekannt";
}

function getTransferStatus(file, transfers) {
  const transfer = transfers.get(file.id);
  if (!transfer) return null;
  return transfer;
}

export function FileGallery({
  files = [],
  peers = [],
  clientUuid,
  onDownload,
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
                  {!isOwn && !transfer && (
                    <button
                      className="fileDownloadBtn"
                      onClick={() => onDownload(file)}
                    >
                      {t("desktop.fileGallery.download", "Download")}
                    </button>
                  )}
                  {transfer && transfer.status === "completed" && (
                    <span className="transferComplete">
                      {t("desktop.fileGallery.completed", "✓")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
