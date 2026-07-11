import React from "react";
import { useTranslation } from "react-i18next";

/**
 * Offered when a WebRTC P2P connection could not be established: a one-time
 * camera/microphone permission unmasks the local IP in ICE candidates so
 * peers on multicast-blocking networks (mesh WiFi) can connect directly.
 * See utils/directConnection.js for details.
 */
export function DirectConnectionModal({ isOpen, onEnable, onSkip }) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="alertOverlay" onClick={onSkip}>
      <div className="alertModal" onClick={(e) => e.stopPropagation()}>
        <div className="alertTitle">{t("desktop.directConnection.title")}</div>
        <div className="alertMessage">{t("desktop.directConnection.message")}</div>
        <div className="alertActions">
          <button type="button" className="alertBtn alertBtnSecondary" onClick={onSkip}>
            {t("desktop.directConnection.skip")}
          </button>
          <button type="button" className="alertBtn" onClick={onEnable}>
            {t("desktop.directConnection.enable")}
          </button>
        </div>
      </div>
    </div>
  );
}
