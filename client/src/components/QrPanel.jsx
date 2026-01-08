import { forwardRef, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import { FEATURE_FLAGS } from "../config/features";

const QR_AUTO_HIDE_MS = 30000; // 30 seconds

export const QrPanel = forwardRef(function QrPanel({ value, size = 240, label, className = "" }, ref) {
  const { t } = useTranslation();
  const [qrVisible, setQrVisible] = useState(true);
  const classes = ["qrPanel", className].filter(Boolean).join(" ");

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
    <div className={classes} ref={ref}>
      {label && <div className="qrLabel">{label}</div>}
      {qrVisible || !FEATURE_FLAGS.AUTO_HIDE_QR_CODE ? (
        <div className="qrWrap">
          <QRCodeSVG value={value} size={size} />
        </div>
      ) : (
        <div className="qrHiddenState">
          <p className="qrHiddenMessage">{t("mobile.qrDisplay.hiddenForSecurity")}</p>
          <button type="button" className="qrShowButton" onClick={handleShowQr}>
            {t("mobile.qrDisplay.showQr")}
          </button>
        </div>
      )}
    </div>
  );
});
