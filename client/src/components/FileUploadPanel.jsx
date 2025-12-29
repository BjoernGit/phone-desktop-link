import React, { useRef } from "react";
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

  // Document icons
  if (["pdf"].includes(ext)) return "📄";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📽️";
  if (["txt", "md"].includes(ext)) return "📃";

  // Archive icons
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "📦";

  // Media icons
  if (["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"].includes(ext)) return "🖼️";
  if (["mp4", "avi", "mov", "mkv", "webm"].includes(ext)) return "🎬";
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext)) return "🎵";

  // Code icons
  if (["js", "jsx", "ts", "tsx", "json"].includes(ext)) return "💻";
  if (["html", "css", "scss"].includes(ext)) return "🌐";
  if (["py", "java", "cpp", "c", "cs"].includes(ext)) return "⚙️";

  // Default
  return "📁";
}

export function FileUploadPanel({ sharedFiles = [], onFilesChange, disabled = false }) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const newFiles = Array.from(e.target.files || []);
    if (newFiles.length === 0) return;

    // Convert to file metadata
    const fileMetadata = newFiles.map((file) => ({
      id: `${Date.now()}-${file.name}`,
      name: file.name,
      size: file.size,
      type: file.type,
      file, // Keep reference to File object
    }));

    onFilesChange([...sharedFiles, ...fileMetadata]);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveFile = (fileId) => {
    onFilesChange(sharedFiles.filter((f) => f.id !== fileId));
  };

  const handleSelectClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <div className="uploadPanel">
      <div className="panelHeader">
        <h3>{t("desktop.fileUpload.title", "Dateien teilen")}</h3>
      </div>

      <div className="panelContent">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFileSelect}
          disabled={disabled}
        />

        <button
          className="uploadPanelButton"
          onClick={handleSelectClick}
          disabled={disabled}
        >
          {t("desktop.fileUpload.selectFiles", "Dateien auswählen")}
        </button>

        {sharedFiles.length === 0 ? (
          <p className="uploadPanelHint">
            {t(
              "desktop.fileUpload.hint",
              "Wähle Dateien aus, die du mit anderen teilen möchtest"
            )}
          </p>
        ) : (
          <div className="uploadPanelFileList">
            {sharedFiles.map((file) => (
              <div key={file.id} className="uploadPanelFileItem">
                <span className="uploadFileIcon">{getFileIcon(file.name)}</span>
                <div className="uploadFileInfo">
                  <div className="uploadFileName">{file.name}</div>
                  <div className="uploadFileSize">{formatFileSize(file.size)}</div>
                </div>
                <button
                  className="uploadFileRemove"
                  onClick={() => handleRemoveFile(file.id)}
                  title={t("desktop.fileUpload.remove", "Entfernen")}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {sharedFiles.length > 0 && (
          <div className="uploadPanelStats">
            {t("desktop.fileUpload.fileCount", {
              count: sharedFiles.length,
              defaultValue: `${sharedFiles.length} Datei(en) geteilt`,
            })}
          </div>
        )}
      </div>
    </div>
  );
}
