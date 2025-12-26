import React from "react";
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
        aria-label="Bild aus Galerie waehlen"
      >
        Galerie
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
        aria-label="QR-Modus umschalten"
      >
        QR
      </button>
      {qrMode && <div className="qrBadge">QR Mode</div>}

      {!cameraReady && (
        <>
          <div className="mobileSimpleHint" aria-hidden>
            Tippe, um die Kamera freizugeben
          </div>
          <button type="button" className="startBtn" onClick={handleStartCamera} disabled={isStartingCamera}>
            {isStartingCamera ? "Startet..." : "Kamera starten"}
          </button>
          {cameraError && <div className="tapError">{cameraError}</div>}
        </>
      )}

      {cameraReady && (
        <button
          type="button"
          className="shutter singleShutter"
          onClick={handleShutter}
          aria-label="Foto aufnehmen und senden"
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
