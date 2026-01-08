import React from "react";
import { useTranslation } from "react-i18next";

export function AlertModal({ isOpen, title, message, onClose }) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="alertOverlay" onClick={onClose}>
      <div className="alertModal" onClick={(e) => e.stopPropagation()}>
        {title && <div className="alertTitle">{title}</div>}
        <div className="alertMessage">{message}</div>
        <div className="alertActions">
          <button type="button" className="alertBtn" onClick={onClose}>
            {t("common.buttons.ok", "OK")}
          </button>
        </div>
      </div>
    </div>
  );
}