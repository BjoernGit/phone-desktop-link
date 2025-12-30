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
    <div className="sectionHeader">
      <h3 className="sectionTitle">{t("desktop.fileUpload.title", "Dateien")}</h3>
      <div className="uploadActions">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFileSelect}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={handleSelectClick}
          disabled={disabled}
        >
          {t("desktop.fileUpload.selectFiles", "Dateien auswählen")}
        </button>
      </div>
    </div>
  );
}
