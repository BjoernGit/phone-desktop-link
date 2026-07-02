import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatFileSize, getFileIcon } from "../utils/fileUtils";
import { FILE_TRANSFER_CONFIG } from "../config/fileTransfer";
import { AlertModal } from "./AlertModal";

const { MAX_FILE_SIZE } = FILE_TRANSFER_CONFIG;

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
  transfers = new Map(),
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

            return (
              <div key={file.id} className="mobileFileRow">
                <span className="mobileFileIcon">{getFileIcon(file.name)}</span>
                <div className="mobileFileInfo">
                  <div className="mobileFileName" title={file.name}>{file.name}</div>
                  <div className="mobileFileMeta">
                    {formatFileSize(file.size)} · {getOwnerLabel(file, peers, clientUuid, t)}
                  </div>
                  {transfer && transfer.status !== "completed" && (
                    <div className="mobileFileProgress">
                      <div
                        className="mobileFileProgressBar"
                        style={{ width: `${transfer.progress}%` }}
                      ></div>
                    </div>
                  )}
                </div>
                <div className="mobileFileAction">
                  {isOwn ? (
                    <button
                      type="button"
                      className="mobileFileRemoveBtn"
                      onClick={() => onRemoveFile && onRemoveFile(file.id)}
                      aria-label={t("mobile.files.remove", "Entfernen")}
                    >
                      ✕
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
