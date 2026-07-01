import React from "react";
import { useTranslation } from "react-i18next";
import { MobileDebugPill } from "./components/MobileDebugPill";
import { MobileControls } from "./components/MobileControls";
import { SessionOfferModal } from "./components/SessionOfferModal";
import { PhotoGrid } from "./components/PhotoGrid";
import { PendingApprovals } from "./components/PendingApprovals";
import { MobileQrDisplay } from "./components/MobileQrDisplay";
import { FEATURE_FLAGS } from "./config/features";

export function MobileApp({
  sessionId,
  sessionSeed,
  offerSecret,
  sessionKeyB64,
  encStatus,
  offerStatus,
  qrStatus,
  allowDebug,
  handleSeedInput,
  videoRef,
  cameraReady,
  cameraError,
  isStartingCamera,
  handleStartCamera,
  handleShutter,
  fileInputRef,
  handleFiles,
  showQrDialog,
  setShowQrDialog,
  qrCountdown,
  qrOffer,
  setQrOffer,
  quality,
  setQuality,
  showQualityPicker,
  setShowQualityPicker,
  mobileView,
  handleTouchStart,
  handleTouchEnd,
  sendSessionOffer,
  sendSessionMerge,
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
  pendingPeers = [],
  approvePeer,
  rejectPeer,
  isWaitingForApproval = false,
  clientUuid,
  qrUrl,
}) {
  const { t } = useTranslation();

  return (
    <div className="mobileSimpleRoot" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* Hidden for production; keep component wired for quick re-activation when mobile debugging is needed */}
      <div style={{ display: "none" }}>
        <MobileDebugPill
          sessionId={sessionId}
          sessionSeed={sessionSeed}
          sessionKeyB64={sessionKeyB64}
          encStatus={encStatus}
          offerStatus={offerStatus}
          qrStatus={qrStatus}
          onSeedChange={handleSeedInput}
        />
      </div>

      <div className="selfIdBadge">{t("mobile.selfId", { id: clientUuid ? clientUuid.slice(0, 8) : "n/a" })}</div>

      {FEATURE_FLAGS.REQUIRE_DEVICE_APPROVAL && isWaitingForApproval && (
        <div className="waitingForApprovalBanner">
          <span className="waitingIcon">⏳</span>
          {t("mobile.waitingForApproval", "Warte auf Freigabe...")}
        </div>
      )}

      {FEATURE_FLAGS.REQUIRE_DEVICE_APPROVAL && (
        <PendingApprovals pending={pendingPeers} onApprove={approvePeer} onReject={rejectPeer} />
      )}

      <MobileControls
        videoRef={videoRef}
        cameraReady={cameraReady}
        cameraError={cameraError}
        isStartingCamera={isStartingCamera}
        handleStartCamera={handleStartCamera}
        handleShutter={handleShutter}
        fileInputRef={fileInputRef}
        handleFiles={handleFiles}
        quality={quality}
        setQuality={setQuality}
        showQualityPicker={showQualityPicker}
        setShowQualityPicker={setShowQualityPicker}
        hidden={mobileView !== "camera"}
      />

      {mobileView === "camera" ? (
        <>
          {showQrDialog && qrOffer?.session && (
            <div className="qrOfferPanel">
              <button
                type="button"
                className="qrOfferClose"
                onClick={() => {
                  setShowQrDialog(false);
                  setQrOffer(null);
                }}
                aria-label="Close"
              ></button>
              <div className="qrOfferText">
                {t("mobile.qr.countdown", { seconds: qrCountdown ?? 0 })}
                {allowDebug && (
                  <div className="qrOfferMeta">
                    {t("mobile.qr.session")} <code>{qrOffer.session}</code>
                    {qrOffer.seed ? (
                      <>
                        <br />
                        {t("mobile.qr.seed")} <code>{qrOffer.seed}</code>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="qrOfferActions">
                {/* Primary action: Merge sessions - brings all devices from both sessions together */}
                <button
                  type="button"
                  className="qrOfferBtn primary"
                  onClick={async () => {
                    // Send merge request to all peers in current session.
                    // Await it: the encrypted merge must be emitted while we
                    // are still joined to the source session.
                    if (sendSessionMerge) {
                      await sendSessionMerge(qrOffer);
                    }
                    // Also switch ourselves to the target session
                    applyQrOffer(qrOffer);
                    setQrStatus(t("mobile.qr.sessionsMerged"));
                    setTimeout(() => setQrStatus(""), 3000);
                    setQrOffer(null);
                    setShowQrDialog(false);
                  }}
                >
                  {t("mobile.qr.mergeSessions")}
                </button>

                {/* Advanced options for power users */}
                {FEATURE_FLAGS.SHOW_QR_ADVANCED_OPTIONS && (
                  <details className="qrAdvancedOptions">
                    <summary>{t("mobile.qr.advancedOptions")}</summary>
                    <div className="qrAdvancedButtons">
                      {/* Join alone - only switch this device */}
                      <button
                        type="button"
                        className="qrOfferBtn secondary"
                        onClick={() => {
                        applyQrOffer(qrOffer);
                        setQrOffer(null);
                        setShowQrDialog(false);
                        }}
                      >
                        {t("mobile.qr.joinAlone")}
                      </button>
                      {/* Send own session - invite the other device to our session */}
                      {sessionId && sessionSeed && (
                        <button
                          type="button"
                          className="qrOfferBtn secondary"
                          onClick={() => {
                            sendSessionOffer(
                              {
                                session: sessionId,
                                seed: sessionSeed,
                                offerSecret,
                              },
                              qrOffer.session,
                              qrOffer.targetUuid,
                              qrOffer.offerSecret
                            );
                            setOfferStatus(t("mobile.qr.offerSent"));
                            setQrStatus(t("mobile.qr.offerSentStatus"));
                          setTimeout(() => {
                            setQrStatus("");
                            setOfferStatus("idle");
                          }, 3000);
                          setQrOffer(null);
                          setShowQrDialog(false);
                          }}
                        >
                          {t("mobile.qr.inviteOther")}
                        </button>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </div>
          )}

          <SessionOfferModal
            offer={incomingOffer}
            onDecline={() => {
              if (incomingOffer?.fromUuid) {
                rejectPeer(incomingOffer.fromUuid);
              }
              setIncomingOffer(null);
            }}
            onAccept={() => {
              applyQrOffer(incomingOffer);
            }}
          />
        </>
      ) : mobileView === "gallery" ? (
        <div className="mobileGalleryView" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          <div className="mobileGalleryPlaceholder">
            <h2>{t("mobile.gallery.title")}</h2>
            {photos.length === 0 ? (
              <>
                <p>{t("mobile.gallery.empty")}</p>
                <p>{t("mobile.gallery.swipeBack")}</p>
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
      ) : (
        <MobileQrDisplay url={qrUrl} sessionId={sessionId} clientUuid={clientUuid} />
      )}
    </div>
  );
}
