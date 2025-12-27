import React from "react";
import { useTranslation } from "react-i18next";
import { QualityPicker } from "./QualityPicker";

export function MobileControls({
  videoRef,
  cameraReady,
  cameraError,
  isStartingCamera,
  handleStartCamera,
  handleShutter,
  fileInputRef,
  handleFiles,
  qrMode,
  setQrMode,
  setQrOffer,
  handleStartQrCamera,
  quality,
  setQuality,
  showQualityPicker,
  setShowQualityPicker,
  hidden = false,
}) {
  const { t } = useTranslation();
  return (
    <div className={hidden ? "mobileCameraView hidden" : "mobileCameraView"}>
      <video ref={videoRef} className="mobileSimpleVideo" playsInline muted autoPlay />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="uploadBtn"
        onClick={() => fileInputRef.current?.click()}
        aria-label={t("common.aria.chooseFromGallery")}
      >
        {t("mobile.controls.gallery")}
      </button>
      <button
        type="button"
        className={`qrToggle ${qrMode ? "active" : ""}`}
        onClick={() => {
          if (!cameraReady && handleStartQrCamera) {
            handleStartQrCamera();
          }
          setQrMode((v) => !v);
          setQrOffer(null);
        }}
        aria-label={t("common.aria.toggleQr")}
      >
        QR
      </button>
      {qrMode && <div className="qrBadge">{t("mobile.controls.qrBadge")}</div>}

      {!cameraReady && (
        <>
          <div className="mobileSimpleHint" aria-hidden>
            {t("mobile.controls.tapToRelease")}
          </div>
          <button type="button" className="startBtn" onClick={handleStartCamera} disabled={isStartingCamera}>
            {isStartingCamera ? t("mobile.controls.starting") : t("mobile.controls.startCamera")}
          </button>
          {cameraError && <div className="tapError">{cameraError}</div>}
        </>
      )}

      {cameraReady && (
        <button
          type="button"
          className="shutter singleShutter"
          onClick={handleShutter}
          aria-label={t("common.aria.takePhoto")}
        />
      )}

      {cameraReady && (
        <QualityPicker
          quality={quality}
          open={showQualityPicker}
          onToggle={() => setShowQualityPicker((v) => !v)}
          onSelect={(id) => {
            setQuality(id);
            setShowQualityPicker(false);
          }}
        />
      )}
    </div>
  );
}
