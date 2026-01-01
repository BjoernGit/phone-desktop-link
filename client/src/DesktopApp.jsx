import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DesktopHero } from "./components/DesktopHero";
import { SessionOfferBar } from "./components/SessionOfferBar";
import { DebugPanel } from "./components/DebugPanel";
import { QrPanel } from "./components/QrPanel";
import { PairingRow } from "./components/PairingRow";
import { DesktopCanvas } from "./components/DesktopCanvas";
import { Lightbox } from "./components/Lightbox";
import { FooterBar } from "./components/FooterBar";
import { FileUploadPanel } from "./components/FileUploadPanel";
import { FileGallery } from "./components/FileGallery";

export function DesktopApp({
  sessionId,
  sessionSeed,
  offerSecret,
  sessionKeyB64,
  encStatus,
  offerStatus,
  setOfferStatus,
  clientUuid,
  peers,
  photos,
  showDebug,
  setShowDebug,
  debugDataUrl,
  setDebugDataUrl,
  injectDebugPhoto,
  copyStatus,
  qrStatus,
  handleSeedInput,
  applyQrOffer,
  incomingOffer,
  setIncomingOffer,
  copyImageToClipboard,
  saveImage,
  copyPlainUrl,
  copyEncrypted,
  handleDesktopFiles,
  desktopFileInputRef,
  handleDesktopClipboardLoad,
  clipboardPreview,
  handleDesktopClipboardSend,
  setClipboardPreview,
  clipboardMode,
  discardClipboardPreview,
  lightboxSrc,
  setLightboxSrc,
  qrPanelRef,
  peerPanelRef,
  panelHeights,
  legalOpen,
  legalContent,
  navigate,
  allowDebug,
  pendingPeers = [],
  approvePeer,
  rejectPeer,
  recentlyApprovedPeers = [],
  onSyncFiles,
  sharedFiles = [],
  onSharedFilesChange,
  allFiles = [],
  onFileDownload,
  onRemoveFile,
  fileTransfers = new Map(),
  webRTCConnections = new Map(),
}) {
  const { t } = useTranslation();
  const peerCount = peers.length;
  const hasPhotos = photos.length > 0;
  const hasConnection = peerCount > 0;
  const hasActiveUI = hasConnection || hasPhotos;
  const qrDocked = hasActiveUI;

  const url = useMemo(() => {
    if (!sessionId) return window.location.href;
    const params = new URLSearchParams(window.location.search);
    params.delete("key");
    params.set("session", sessionId);
    if (clientUuid) params.set("uid", clientUuid);
    const hashParams = new URLSearchParams();
    if (sessionSeed) hashParams.set("seed", sessionSeed);
    if (offerSecret) hashParams.set("ok", offerSecret);
    const hash = hashParams.toString();
    return `${window.location.origin}${window.location.pathname}?${params.toString()}${hash ? `#${hash}` : ""}`;
  }, [clientUuid, offerSecret, sessionId, sessionSeed]);

  const qrBaseSize = 240;
  const qrSize = hasActiveUI ? qrBaseSize * 0.8 : qrBaseSize;

  const photoUploadControls = (
    <>
      <div className="uploadActions">
        <button type="button" onClick={() => desktopFileInputRef.current?.click()}>
          {t("desktop.upload.uploadImage")}
        </button>
        <button type="button" onClick={handleDesktopClipboardLoad}>
          {t("desktop.upload.loadClipboard")}
        </button>
      </div>
      <input
        ref={desktopFileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          handleDesktopFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {clipboardPreview && (
        <div className="clipboardPreview">
          <div className="clipboardLabel">{t("desktop.upload.clipboardPreview")}</div>
          {clipboardPreview.type === "image" ? (
            <img src={clipboardPreview.data} alt="Clipboard preview" className="clipboardThumb" />
          ) : (
            <code className="clipboardText">{clipboardPreview.data.slice(0, 120)}</code>
          )}
          <div className="uploadActions">
            <button type="button" onClick={handleDesktopClipboardSend}>
              {t("desktop.upload.sendPreview")}
            </button>
            <button type="button" onClick={() => setClipboardPreview(null)}>
              {t("common.buttons.discard")}
            </button>
          </div>
        </div>
      )}
    </>
  );

  const fileUploadPanel = (
    <FileUploadPanel sharedFiles={sharedFiles} onFilesChange={onSharedFilesChange} disabled={!hasConnection} />
  );

  return (
    <>
      <div className="desktopShell">
        <div className="pageContent">
          <DesktopHero />

          {incomingOffer && (
            <SessionOfferBar
              offer={incomingOffer}
              onDecline={() => {
                if (incomingOffer?.fromUuid) {
                  rejectPeer(incomingOffer.fromUuid);
                }
                setIncomingOffer(null);
                setOfferStatus(t("status.offerRejected"));
              }}
              onAccept={() => {
                applyQrOffer(incomingOffer);
                setIncomingOffer(null);
                setOfferStatus(t("status.offerAccepted"));
              }}
            />
          )}

          {allowDebug && showDebug && (
            <DebugPanel
              value={debugDataUrl}
              onChange={setDebugDataUrl}
              onAdd={injectDebugPhoto}
              status={copyStatus || qrStatus}
              metrics={`seed: ${sessionSeed || "n/a"} | key: ${sessionKeyB64 || "n/a"} | enc: ${encStatus} | offer: ${offerStatus}`}
              seedValue={sessionSeed}
              onSeedChange={handleSeedInput}
              offerStatus={offerStatus}
            />
          )}

          {!hasActiveUI && (
            <div className="qrHeroWrap">
              <QrPanel ref={qrPanelRef} value={url} size={240} label={t("desktop.qr.label")} className="heroCenter" />
            </div>
          )}

          {hasActiveUI && (
            <>
              {/* Pairing Section: QR Code + Connected Devices */}
              <PairingRow
                qrSize={qrSize}
                qrDocked={qrDocked}
                url={url}
                qrPanelRef={qrPanelRef}
                peerPanelRef={peerPanelRef}
                hasConnection={hasConnection}
                panelHeights={panelHeights}
                peers={peers}
                pendingPeers={pendingPeers}
                onApprovePeer={approvePeer}
                onRejectPeer={rejectPeer}
                recentlyApprovedPeers={recentlyApprovedPeers}
                onSyncFiles={onSyncFiles}
              />

              {/* Photo Section: Upload + Gallery */}
              <section className="contentSection photoSection">
                <div className="sectionCard">
                  <div className="sectionHeader">
                    <h3 className="sectionTitle">{t("desktop.gallery.title", "Galerie")}</h3>
                    {photoUploadControls}
                  </div>
                  <main className="desktopCanvas">
                    <DesktopCanvas
                      photos={photos}
                      onSelect={setLightboxSrc}
                      onCopy={copyImageToClipboard}
                      onSave={saveImage}
                      showDebug={showDebug}
                      onCopyPlain={copyPlainUrl}
                      onCopyEncrypted={copyEncrypted}
                    />
                  </main>
                </div>
              </section>

              {/* File Section: Upload + Gallery */}
              <section className="contentSection fileSection">
                <div className="sectionCard">
                  {fileUploadPanel}
                  <FileGallery
                    files={allFiles}
                    peers={peers}
                    clientUuid={clientUuid}
                    onDownload={onFileDownload}
                    onRemoveFile={onRemoveFile}
                    transfers={fileTransfers}
                    connectionStates={webRTCConnections}
                  />
                </div>
              </section>
            </>
          )}
        </div>

        <Lightbox
          src={lightboxSrc}
          onClose={clipboardMode ? discardClipboardPreview : () => setLightboxSrc(null)}
          onCopy={copyImageToClipboard}
          onSave={saveImage}
          showDebug={showDebug}
          onCopyPlain={copyPlainUrl}
          onCopyEncrypted={copyEncrypted}
          actions={
            clipboardMode ? (
              <>
                <button
                  type="button"
                  className="overlayBtn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDesktopClipboardSend();
                  }}
                >
                  {t("common.buttons.send")}
                </button>
                <button
                  type="button"
                  className="overlayBtn"
                  onClick={(e) => {
                    e.stopPropagation();
                    discardClipboardPreview();
                  }}
                >
                  {t("common.buttons.discard")}
                </button>
              </>
            ) : undefined
          }
        />

        <FooterBar onToggleDebug={allowDebug ? () => setShowDebug((v) => !v) : undefined} />
      </div>

      {legalOpen && (
        <div className="legalModal" onClick={() => navigate("/")}>
          <div
            className="legalModalCard"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <button type="button" className="legalClose" onClick={() => navigate("/")}>
              &times;
            </button>
            <div className="legalModalBody">{legalContent}</div>
          </div>
        </div>
      )}
    </>
  );
}
