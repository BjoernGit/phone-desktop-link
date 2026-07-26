import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatFileSize, getFileIcon } from "../utils/fileUtils";
import { FILE_TRANSFER_CONFIG } from "../config/fileTransfer";
import { AlertModal } from "./AlertModal";

const { MAX_FILE_SIZE } = FILE_TRANSFER_CONFIG;

// A transfer that is actively moving data right now
function isTransferActive(transfer) {
  return transfer?.status === "sending" || transfer?.status === "receiving";
}

// A transfer that has stalled - the download is being retried in the background
function isTransferStalled(transfer) {
  return transfer?.status === "failed" || transfer?.status === "timeout";
}

// Wording for a download that ended without the file arriving
function noticeLabel(reason, t) {
  if (reason === "revoked") {
    return t("mobile.files.noticeRevoked", "Vom Absender zurückgezogen");
  }
  if (reason === "notFound") {
    return t("mobile.files.noticeNotFound", "Nicht mehr verfügbar");
  }
  if (reason === "peerGone") {
    return t("mobile.files.noticePeerGone", "Gerät nicht mehr verbunden");
  }
  return t("mobile.files.noticeFailed", "Download fehlgeschlagen");
}

function getTransferStatus(file, transfers) {
  // Direct lookup by file.id (sender-side transfers)
  const direct = transfers.get(file.id);
  if (direct) return direct;

  // Search by fileId property (receiver-side transfers)
  for (const t of transfers.values()) {
    if (t.fileId === file.id) {
      return t;
    }
  }
  return null;
}

function getOwnerLabel(file, peers, clientUuid, t) {
  if (file.ownerUuid === clientUuid) {
    return t("mobile.files.you", "Dieses Gerät");
  }
  const peer = peers.find((p) => p.clientUuid === file.ownerUuid);
  if (peer?.name) return peer.name;
  return file.ownerUuid ? file.ownerUuid.slice(0, 8) : "?";
}

/**
 * Mobile file sharing view: share own files, list all session files,
 * download peer files. Compact single-column layout for small screens.
 */
export function MobileFilePanel({
  files = [],
  sharedFiles = [],
  peers = [],
  clientUuid,
  onDownload,
  onRemoveFile,
  onFilesChange,
  onDismissNotice,
  transfers = new Map(),
  pendingDownloads = new Set(),
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const [alertState, setAlertState] = useState({ isOpen: false, title: "", message: "" });

  const handleFileSelect = (e) => {
    const newFiles = Array.from(e.target.files || []);
    if (newFiles.length === 0) return;

    const oversizedFiles = newFiles.filter((file) => file.size > MAX_FILE_SIZE);
    if (oversizedFiles.length > 0) {
      const maxSizeGB = (MAX_FILE_SIZE / (1024 * 1024 * 1024)).toFixed(1);
      const fileList = oversizedFiles.map((f) => `• ${f.name} (${formatFileSize(f.size)})`).join("\n");

      setAlertState({
        isOpen: true,
        title: t("errors.fileTooLargeTitle", "Datei zu groß"),
        message: t("errors.fileTooLarge", {
          defaultValue: `Die folgenden Dateien überschreiten die maximale Größe von ${maxSizeGB} GB:\n\n${fileList}\n\nBitte wähle kleinere Dateien aus.`,
          maxSize: maxSizeGB,
          files: fileList,
        }),
      });

      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const fileMetadata = newFiles.map((file) => ({
      id: `${Date.now()}-${file.name}`,
      name: file.name,
      size: file.size,
      type: file.type,
      file,
    }));

    onFilesChange([...sharedFiles, ...fileMetadata]);

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="mobileFilePanel">
      <div className="mobileFileHeader">
        <h2>{t("mobile.files.title", "Dateien")}</h2>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />
        <button
          type="button"
          className="mobileFileSelectBtn"
          onClick={() => fileInputRef.current?.click()}
        >
          {t("mobile.files.select", "Dateien teilen")}
        </button>
      </div>

      {files.length === 0 ? (
        <div className="mobileFileEmpty">
          <p>{t("mobile.files.empty", "Keine Dateien in dieser Session.")}</p>
          <p className="mobileFileHint">{t("mobile.files.hint", "Geteilte Dateien von allen Geräten erscheinen hier.")}</p>
        </div>
      ) : (
        <div className="mobileFileList">
          {files.map((file) => {
            const transfer = getTransferStatus(file, transfers);
            const isOwn = file.ownerUuid === clientUuid;

            // Tombstone: the download ended without the file arriving
            const notice = file.notice;

            // Tap registered, but no data is flowing yet (connect / retry)
            const isPending =
              !notice &&
              pendingDownloads.has(file.id) &&
              (!transfer || isTransferStalled(transfer));
            const isActive = !notice && !isPending && isTransferActive(transfer);
            const rowClass = [
              "mobileFileRow",
              notice ? "hasNotice" : "",
              isPending ? "isPending" : "",
              isActive ? "isTransferring" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div key={file.id} className={rowClass}>
                <span className="mobileFileIcon">{getFileIcon(file.name)}</span>
                <div className="mobileFileInfo">
                  <div className="mobileFileName" title={file.name}>{file.name}</div>
                  <div className={`mobileFileMeta${notice ? " isNotice" : ""}`}>
                    {notice
                      ? noticeLabel(notice.reason, t)
                      : isPending
                      ? t("mobile.files.preparing", "Verbindung wird aufgebaut …")
                      : `${formatFileSize(file.size)} · ${getOwnerLabel(file, peers, clientUuid, t)}`}
                  </div>
                  {notice ? (
                    notice.progress > 0 && (
                      <div className="mobileFileProgress isStopped">
                        <div
                          className="mobileFileProgressBar"
                          style={{ width: `${notice.progress}%` }}
                        ></div>
                      </div>
                    )
                  ) : isPending ? (
                    <div className="mobileFileProgress isIndeterminate">
                      <div className="mobileFileProgressBar"></div>
                    </div>
                  ) : transfer && transfer.status !== "completed" ? (
                    <div className="mobileFileProgress">
                      <div
                        className={`mobileFileProgressBar${isActive ? " isActive" : ""}`}
                        style={{ width: `${transfer.progress}%` }}
                      ></div>
                    </div>
                  ) : null}
                </div>
                <div className="mobileFileAction">
                  {notice && notice.stillListed ? (
                    // File is still on offer - let the user try again
                    <button
                      type="button"
                      className="mobileFileDownloadBtn"
                      onClick={() => onDownload && onDownload(file)}
                    >
                      {t("mobile.files.retry", "Nochmal")}
                    </button>
                  ) : notice ? (
                    <button
                      type="button"
                      className="mobileFileNoticeDismissBtn"
                      onClick={() => onDismissNotice && onDismissNotice(file.id)}
                      aria-label={t("mobile.files.dismissNotice", "Hinweis ausblenden")}
                    >
                      ✕
                    </button>
                  ) : isOwn ? (
                    <button
                      type="button"
                      className="mobileFileRemoveBtn"
                      onClick={() => onRemoveFile && onRemoveFile(file.id)}
                      aria-label={t("mobile.files.remove", "Entfernen")}
                    >
                      ✕
                    </button>
                  ) : isPending ? (
                    <button
                      type="button"
                      className="mobileFileDownloadBtn isPending"
                      disabled
                    >
                      {t("mobile.files.requested", "Warte …")}
                    </button>
                  ) : transfer?.status === "completed" ? (
                    <span className="mobileFileDone">✓</span>
                  ) : transfer ? (
                    <span className="mobileFilePercent">{transfer.progress}%</span>
                  ) : (
                    <button
                      type="button"
                      className="mobileFileDownloadBtn"
                      onClick={() => onDownload && onDownload(file)}
                    >
                      {t("mobile.files.download", "Laden")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertModal
        isOpen={alertState.isOpen}
        title={alertState.title}
        message={alertState.message}
        onClose={() => setAlertState({ isOpen: false, title: "", message: "" })}
      />
    </div>
  );
}
