import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { FEATURE_FLAGS } from "../config/features";

const QR_AUTO_HIDE_MS = 30000; // 30 seconds

export function MobileQrDisplay({ url, sessionId, clientUuid }) {
  const { t } = useTranslation();
  const [qrVisible, setQrVisible] = useState(true);

  useEffect(() => {
    // Auto-hide QR code after 30 seconds (only if feature enabled)
    if (!FEATURE_FLAGS.AUTO_HIDE_QR_CODE) return;

    const timer = setTimeout(() => {
      setQrVisible(false);
    }, QR_AUTO_HIDE_MS);

    return () => clearTimeout(timer);
  }, []);

  const handleShowQr = () => {
    setQrVisible(true);
    // Auto-hide again after 30 seconds (only if feature enabled)
    if (FEATURE_FLAGS.AUTO_HIDE_QR_CODE) {
      setTimeout(() => setQrVisible(false), QR_AUTO_HIDE_MS);
    }
  };

  return (
    <div className="mobileQrDisplayView">
      <div className="mobileQrDisplayContent">
        <h2 className="mobileQrTitle">{t("mobile.qrDisplay.title")}</h2>
        <p className="mobileQrInstructions">{t("mobile.qrDisplay.instructions")}</p>

        {qrVisible || !FEATURE_FLAGS.AUTO_HIDE_QR_CODE ? (
          <>
            <div className="mobileQrCodeWrap">
              <QRCodeSVG value={url} size={280} level="M" />
            </div>

            <div className="mobileQrMeta">
              <div className="mobileQrMetaItem">
                <span className="mobileQrMetaLabel">{t("mobile.qrDisplay.sessionId")}:</span>
                <code className="mobileQrMetaValue">{sessionId || "n/a"}</code>
              </div>
              <div className="mobileQrMetaItem">
                <span className="mobileQrMetaLabel">{t("mobile.qrDisplay.deviceId")}:</span>
                <code className="mobileQrMetaValue">{clientUuid ? clientUuid.slice(0, 8) : "n/a"}</code>
              </div>
            </div>
          </>
        ) : (
          <div className="mobileQrHiddenState">
            <p className="mobileQrHiddenMessage">{t("mobile.qrDisplay.hiddenForSecurity")}</p>
            <button type="button" className="mobileQrShowButton" onClick={handleShowQr}>
              {t("mobile.qrDisplay.showQr")}
            </button>
          </div>
        )}

        <p className="mobileQrHint">{t("mobile.qrDisplay.swipeHint")}</p>
      </div>
    </div>
  );
}
