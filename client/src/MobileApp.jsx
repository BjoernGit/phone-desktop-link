import React from "react";
import { MobileDebugPill } from "./components/MobileDebugPill";
import { MobileControls } from "./components/MobileControls";
import { SessionOfferModal } from "./components/SessionOfferModal";
import { PhotoGrid } from "./components/PhotoGrid";

export function MobileApp({
  sessionId,
  sessionSeed,
  sessionKeyB64,
  encStatus,
  offerStatus,
  qrStatus,
  handleSeedInput,
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
  qrOffer,
  setQrOffer,
  quality,
  setQuality,
  showQualityPicker,
  setShowQualityPicker,
  mobileView,
  setMobileView,
  handleTouchStart,
  handleTouchEnd,
  sendSessionOffer,
  setOfferStatus,
  setQrStatus,
  applyQrOffer,
  incomingOffer,
  setIncomingOffer,
  photos,
  setLightboxSrc,
  copyImageToClipboard,
  saveImage,
  copyPlainUrl,
  copyEncrypted,
}) {
  return (
    <div className="mobileSimpleRoot" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <MobileDebugPill
        sessionId={sessionId}
        sessionSeed={sessionSeed}
        sessionKeyB64={sessionKeyB64}
        encStatus={encStatus}
        offerStatus={offerStatus}
        qrStatus={qrStatus}
        onSeedChange={handleSeedInput}
      />

      <MobileControls
        videoRef={videoRef}
        cameraReady={cameraReady}
        cameraError={cameraError}
        isStartingCamera={isStartingCamera}
        handleStartCamera={handleStartCamera}
        handleShutter={handleShutter}
        fileInputRef={fileInputRef}
        handleFiles={handleFiles}
        qrMode={qrMode}
        setQrMode={setQrMode}
        setQrOffer={setQrOffer}
        handleStartQrCamera={handleStartCamera}
        quality={quality}
        setQuality={setQuality}
        showQualityPicker={showQualityPicker}
        setShowQualityPicker={setShowQualityPicker}
        hidden={mobileView !== "camera"}
      />

      {mobileView === "camera" ? (
        <>
          {qrOffer?.session && (
            <div className="qrOfferPanel">
              <div className="qrOfferText">
                QR erkannt
                <div className="qrOfferMeta">
                  Session: <code>{qrOffer.session}</code>
                  {qrOffer.seed ? (
                    <>
                      <br />
                      Seed: <code>{qrOffer.seed}</code>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="qrOfferActions">
                <button
                  type="button"
                  className="qrOfferBtn"
                  onClick={() => {
                    applyQrOffer(qrOffer);
                    setQrOffer(null);
                    setQrMode(false);
                  }}
                >
                  Session einlesen
                </button>
                <button
                  type="button"
                  className="qrOfferBtn ghost"
                  onClick={() => {
                    if (!sendSessionOffer) return;
                    sendSessionOffer(
                      {
                        session: sessionId,
                        seed: sessionSeed,
                      },
                      qrOffer.session,
                      qrOffer.targetUuid
                    );
                    setOfferStatus("Angebot gesendet");
                    setQrStatus("Session-Angebot gesendet");
                    setTimeout(() => {
                      setQrStatus("");
                      setOfferStatus("idle");
                    }, 3000);
                    setQrOffer(null);
                    setQrMode(false);
                  }}
                >
                  Eigene Session senden
                </button>
              </div>
            </div>
          )}

          <SessionOfferModal
            offer={incomingOffer}
            onDecline={() => setIncomingOffer(null)}
            onAccept={() => {
              applyQrOffer(incomingOffer);
            }}
          />
        </>
      ) : (
        <div className="mobileGalleryView" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          <div className="mobileGalleryPlaceholder">
            <h2>Galerie (Mobil)</h2>
            <button
              type="button"
              className="mobileBackBtn"
              onClick={() => setMobileView("camera")}
            >
              Zurueck zur Kamera
            </button>
            {photos.length === 0 ? (
              <>
                <p>Noch keine Fotos in dieser Session.</p>
                <p>Swipe nach rechts zurueck zur Kamera.</p>
              </>
            ) : (
              <div className="mobileGalleryGrid">
                <PhotoGrid
                  photos={photos}
                  onSelect={setLightboxSrc}
                  onCopy={copyImageToClipboard}
                  onSave={saveImage}
                  showDebug={false}
                  onCopyPlain={copyPlainUrl}
                  onCopyEncrypted={copyEncrypted}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
