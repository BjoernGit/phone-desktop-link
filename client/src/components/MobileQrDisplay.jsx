import React from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";

export function MobileQrDisplay({ url, sessionId, clientUuid }) {
  const { t } = useTranslation();

  return (
    <div className="mobileQrDisplayView">
      <div className="mobileQrDisplayContent">
        <h2 className="mobileQrTitle">{t("mobile.qrDisplay.title")}</h2>
        <p className="mobileQrInstructions">{t("mobile.qrDisplay.instructions")}</p>

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

        <p className="mobileQrHint">{t("mobile.qrDisplay.swipeHint")}</p>
      </div>
    </div>
  );
}
