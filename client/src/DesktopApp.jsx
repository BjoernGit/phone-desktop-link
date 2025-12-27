import React, { useMemo } from "react";
import { DesktopHero } from "./components/DesktopHero";
import { SessionOfferBar } from "./components/SessionOfferBar";
import { DebugPanel } from "./components/DebugPanel";
import { QrPanel } from "./components/QrPanel";
import { PairingRow } from "./components/PairingRow";
import { DesktopCanvas } from "./components/DesktopCanvas";
import { Lightbox } from "./components/Lightbox";
import { FooterBar } from "./components/FooterBar";
import { PendingApprovals } from "./components/PendingApprovals";

export function DesktopApp({
  sessionId,
  sessionSeed,
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
}) {
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
    const hash = sessionSeed ? `#seed=${sessionSeed}` : "";
    return `${window.location.origin}${window.location.pathname}?${params.toString()}${hash}`;
  }, [clientUuid, sessionId, sessionSeed]);

  const qrBaseSize = 240;
  const qrSize = hasActiveUI ? qrBaseSize * 0.8 : qrBaseSize;

  const uploadPanel = (
    <div>
      <h3>Fotos hinzufuegen</h3>
      <div className="uploadActions">
        <button type="button" onClick={() => desktopFileInputRef.current?.click()}>
          Bild hochladen
        </button>
        <button type="button" onClick={handleDesktopClipboardLoad}>
          Clipboard laden
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
          <div className="clipboardLabel">Clipboard-Vorschau</div>
          {clipboardPreview.type === "image" ? (
            <img src={clipboardPreview.data} alt="Clipboard preview" className="clipboardThumb" />
          ) : (
            <code className="clipboardText">{clipboardPreview.data.slice(0, 120)}</code>
          )}
          <div className="uploadActions">
            <button type="button" onClick={handleDesktopClipboardSend}>
              Vorschau senden
            </button>
            <button type="button" onClick={() => setClipboardPreview(null)}>
              Verwerfen
            </button>
          </div>
        </div>
      )}
      <p className="mutedText">Bilder werden innerhalb dieser Session geteilt.</p>
    </div>
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
                setOfferStatus("Offer abgelehnt");
              }}
              onAccept={() => {
                applyQrOffer(incomingOffer);
                setIncomingOffer(null);
                setOfferStatus("Offer bernommen");
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
              <QrPanel ref={qrPanelRef} value={url} size={240} label="Scanne den QR-Code" className="heroCenter" />
            </div>
          )}

          {hasActiveUI && (
            <>
              <PendingApprovals pending={pendingPeers} onApprove={approvePeer} onReject={rejectPeer} />
              <PairingRow
                uploadPanel={uploadPanel}
                qrSize={qrSize}
                qrDocked={qrDocked}
                url={url}
                qrPanelRef={qrPanelRef}
                peerPanelRef={peerPanelRef}
                hasConnection={hasConnection}
                panelHeights={panelHeights}
                peers={peers}
              />

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
                  Senden
                </button>
                <button
                  type="button"
                  className="overlayBtn"
                  onClick={(e) => {
                    e.stopPropagation();
                    discardClipboardPreview();
                  }}
                >
                  Verwerfen
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
