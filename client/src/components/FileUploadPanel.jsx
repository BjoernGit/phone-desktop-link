import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatFileSize, getFileIcon } from "../utils/fileUtils";
import { FILE_TRANSFER_CONFIG } from "../config/fileTransfer";
import { AlertModal } from "./AlertModal";

const { MAX_FILE_SIZE } = FILE_TRANSFER_CONFIG;

export function FileUploadPanel({ sharedFiles = [], onFilesChange, disabled = false }) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const [alertState, setAlertState] = useState({ isOpen: false, title: "", message: "" });

  const handleFileSelect = (e) => {
    const newFiles = Array.from(e.target.files || []);
    if (newFiles.length === 0) return;

    // Validate file sizes
    const oversizedFiles = newFiles.filter(file => file.size > MAX_FILE_SIZE);
    if (oversizedFiles.length > 0) {
      const maxSizeGB = (MAX_FILE_SIZE / (1024 * 1024 * 1024)).toFixed(1);
      const fileList = oversizedFiles.map(f => `• ${f.name} (${formatFileSize(f.size)})`).join('\n');

      setAlertState({
        isOpen: true,
        title: t("errors.fileTooLargeTitle", "Datei zu groß"),
        message: t("errors.fileTooLarge", {
          defaultValue: `Die folgenden Dateien überschreiten die maximale Größe von ${maxSizeGB} GB:\n\n${fileList}\n\nBitte wähle kleinere Dateien aus.`,
          maxSize: maxSizeGB,
          files: fileList
        })
      });

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

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

  const handleCloseAlert = () => {
    setAlertState({ isOpen: false, title: "", message: "" });
  };

  return (
    <>
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

      <AlertModal
        isOpen={alertState.isOpen}
        title={alertState.title}
        message={alertState.message}
        onClose={handleCloseAlert}
      />
    </>
  );
}
