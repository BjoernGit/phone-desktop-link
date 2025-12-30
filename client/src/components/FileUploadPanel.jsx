import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { formatFileSize, getFileIcon } from "../utils/fileUtils";

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

        <p className="uploadPanelHint">
          {sharedFiles.length > 0
            ? t("desktop.fileUpload.fileCount", {
                count: sharedFiles.length,
                defaultValue: `${sharedFiles.length} Datei(en) geteilt`,
              })
            : t(
                "desktop.fileUpload.hint",
                "Wähle Dateien aus, die du mit anderen teilen möchtest"
              )}
        </p>
      </div>
    </div>
  );
}
