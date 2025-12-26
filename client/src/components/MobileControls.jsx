import React from "react";

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
        <div className="qualityPickerWrap">
          <button
            type="button"
            className="qualityToggle"
            onClick={(e) => {
              e.stopPropagation();
              setShowQualityPicker((v) => !v);
            }}
          >
            Aufloesung: {quality}
          </button>
          {showQualityPicker && (
            <div className="qualityMenu" onClick={(e) => e.stopPropagation()}>
              {[
                { id: "S", label: "S (360 x 640)" },
                { id: "M", label: "M (720 x 1280)" },
                { id: "L", label: "L (1080 x 1920)" },
                { id: "XL", label: "XL (1440 x 2560)" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`qualityItem ${quality === opt.id ? "active" : ""}`}
                  onClick={() => {
                    setQuality(opt.id);
                    setShowQualityPicker(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
