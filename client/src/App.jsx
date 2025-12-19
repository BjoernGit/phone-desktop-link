import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import "./App.css";
import heroLogo from "./assets/Snap2Desk_Text_Logo.png";
import { isMobileDevice } from "./utils/session";
import { toBlob } from "./utils/image";
import { useSessionSockets } from "./hooks/useSessionSockets";
import { useCameraCapture } from "./hooks/useCameraCapture";

export default function App() {
  const [isMobile, setIsMobile] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [debugDataUrl, setDebugDataUrl] = useState("");
  const [showDebug, setShowDebug] = useState(false);

  const deviceName = useMemo(() => {
    const uaData = navigator.userAgentData;
    if (uaData?.platform) return uaData.platform;
    if (navigator.platform) return navigator.platform;
    const ua = navigator.userAgent || "";
    if (ua.includes("Android")) return "Android";
    if (ua.includes("iPhone")) return "iPhone";
    if (ua.includes("iPad")) return "iPad";
    if (ua.includes("Mac")) return "Mac";
    if (ua.includes("Win")) return "Windows";
    return "Unbekanntes Gerät";
  }, []);

  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  const { sessionId, socketConnected, peers, photos, sendPhoto, addLocalPhoto } = useSessionSockets({
    isMobile,
    deviceName,
  });

  const {
    videoRef,
    cameraReady,
    cameraError,
    isStartingCamera,
    handleStartCamera,
    handleShutter,
  } = useCameraCapture({ sessionId, onSendPhoto: sendPhoto });

  async function copyImageToClipboard(src) {
    const supportsImageClipboard = !!(navigator.clipboard?.write && window.ClipboardItem);
    try {
      if (supportsImageClipboard) {
        const tryWrite = async (blob, label) => {
          if (!blob) throw new Error("Kein Bild");
          const type = blob.type || "image/jpeg";
          const item = new ClipboardItem({ [type]: blob });
          await navigator.clipboard.write([item]);
          setCopyStatus(`${label} kopiert`);
          setTimeout(() => setCopyStatus(""), 1500);
        };

        try {
          const jpeg = await toBlob(src, "jpeg");
          await tryWrite(jpeg, "JPEG");
          return;
        } catch (errJpeg) {
          console.warn("JPEG-Clipboard fehlgeschlagen, versuche PNG:", errJpeg);
          const png = await toBlob(src, "png");
          await tryWrite(png, "PNG");
          return;
        }
      }
    } catch (e) {
      // fallback below
      console.warn("Bild-Clipboard fehlgeschlagen, falle zurück auf Text:", e);
    }
    try {
      await navigator.clipboard.writeText(src);
      setCopyStatus(
        supportsImageClipboard
          ? "Link kopiert (Bild-Clipboard blockiert)"
          : "Link kopiert (Bild-Clipboard nicht unterstützt)"
      );
      setTimeout(() => setCopyStatus(""), 1500);
    } catch (e) {
      setCopyStatus("Kopieren nicht möglich");
      setTimeout(() => setCopyStatus(""), 1500);
    }
  }

  async function saveImage(src) {
    try {
      let blob = null;
      try {
        blob = await toBlob(src, "jpeg");
      } catch {
        blob = await toBlob(src, "png");
      }
      if (!blob) throw new Error("Kein Bild");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ext = blob.type === "image/png" ? "png" : "jpg";
      a.href = url;
      a.download = `photo-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("Speichern fehlgeschlagen:", e);
      setCopyStatus("Speichern nicht möglich");
      setTimeout(() => setCopyStatus(""), 1500);
    }
  }

  function injectDebugPhoto() {
    if (!debugDataUrl.trim()) return;
    const src = debugDataUrl.trim();
    const looksOkay = src.startsWith("data:image") || src.startsWith("http://") || src.startsWith("https://");
    if (!looksOkay) {
      setCopyStatus("Ungültige Quelle");
      setTimeout(() => setCopyStatus(""), 1200);
      return;
    }
    addLocalPhoto(src);
    setDebugDataUrl("");
  }

  if (!isMobile) {
    const url = sessionId
      ? `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sessionId)}`
      : window.location.href;

    const peerCount = peers.length;
    const hasPhotos = photos.length > 0;
    const hasConnection = peerCount > 0;
    const hasActiveUI = hasConnection || hasPhotos;
    const qrDocked = hasActiveUI;

    return (
      <div className="desktopShell">
        <div className="pageContent">
          <header className="desktopHero">
            <div className="heroCopy">
              <img className="heroLogo" src={heroLogo} alt="Snap2Desk Logo" />
              <div className="heroSub">
                Pics from your phone straight to your desktop. Fast, simple, safe, without an account.
              </div>
            </div>
          </header>

          {showDebug && (
            <div className="debugPanel">
              <label className="debugLabel" htmlFor="debugDataUrl">
                Debug Data-URL einfuegen
              </label>
              <div className="debugControls">
                <textarea
                  id="debugDataUrl"
                  className="debugInput"
                  placeholder="data:image/jpeg;base64,..."
                  value={debugDataUrl}
                  onChange={(e) => setDebugDataUrl(e.target.value)}
                />
                <button type="button" className="debugBtn" onClick={injectDebugPhoto}>
                  Add
                </button>
              </div>
              {copyStatus && <div className="debugStatus">{copyStatus}</div>}
            </div>
          )}

          {!hasActiveUI && (
            <div className="qrHeroWrap">
              <div className="qrPanel heroCenter">
                <div className="qrLabel">Scanne den QR-Code</div>
                <div className="qrWrap">
                  <QRCodeSVG value={url} size={240} />
                </div>
              </div>
            </div>
          )}

          {hasActiveUI && (
            <>
              <section
                className="pairingRow"
                style={{ "--qr-size": qrDocked ? "180px" : "240px" }}
              >
                <div className="peerPanel">
                  <div className="panelTitle">Verbundene Geräte</div>
                  <div className="panelMeta">
                    <span className={`pill ${hasConnection ? "ok" : "wait"}`}>
                      <span className="dot" />
                      {hasConnection ? `${peerCount} Gerät(e) verbunden` : "Wartet auf Verbindung"}
                    </span>
                  </div>
                  {hasConnection ? (
                    <div className="peerList">
                      {peers.map((p) => (
                        <span key={p.id} className="peerTag">
                          {p.name || p.role}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="peerEmpty">Verbinde ein Gerät, um neue Fotos zu senden.</div>
                  )}
                </div>

                <div className={`qrPanel ${qrDocked ? "docked" : "centered"}`}>
                  <div className="qrLabel">{qrDocked ? "Weitere Geräte koppeln" : "Scanne den QR-Code"}</div>
                  <div className="qrWrap">
                    <QRCodeSVG value={url} size={qrDocked ? 180 : 240} />
                  </div>
                </div>
              </section>

              <main className="desktopCanvas">
                {photos.length === 0 ? (
                  <div className="emptyInvite">
                    <div className="emptyCallout">Bereit, Fotos zu empfangen</div>
                    <div className="emptyHint">Scanne den QR-Code mit deinem Handy und tippe auf den Auslöser.</div>
                  </div>
                ) : (
                  <div className="photoGrid">
                    {photos.map((src, idx) => (
                      <div
                        key={idx}
                        className="photoCard"
                        role="button"
                        tabIndex={0}
                        onClick={() => setLightboxSrc(src)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setLightboxSrc(src);
                          }
                        }}
                        aria-label={`Foto ${idx + 1} ansehen`}
                      >
                        <img className="photoImg" src={src} alt={`Photo ${idx}`} />
                        <div className="cardOverlay">
                          <button
                            type="button"
                            className="overlayBtn"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyImageToClipboard(src);
                            }}
                            aria-label="In Zwischenablage kopieren"
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            className="overlayBtn"
                            onClick={(e) => {
                              e.stopPropagation();
                              saveImage(src);
                            }}
                            aria-label="Speichern"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </main>
            </>
          )}
        </div>

        {lightboxSrc && (
          <div className="lightbox" onClick={() => setLightboxSrc(null)}>
            <img className="lightboxImg" src={lightboxSrc} alt="Vergrößertes Foto" />
            <div className="lightboxActions">
              <button
                type="button"
                className="overlayBtn"
                onClick={(e) => {
                  e.stopPropagation();
                  copyImageToClipboard(lightboxSrc);
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="overlayBtn"
                onClick={(e) => {
                  e.stopPropagation();
                  saveImage(lightboxSrc);
                }}
              >
                Save
              </button>
            </div>
          </div>
        )}

        <footer className="footer">
          <div className="footerInner">
            <div className="footerMeta">© 2025 Snap2Desk. Alle Rechte vorbehalten.</div>
            <div className="footerLinks">
              <button type="button" className="footerLinkBtn" onClick={() => setShowDebug((v) => !v)}>
                Debug
              </button>
              <span>•</span>
              <a href="#" aria-label="Datenschutz">Datenschutz</a>
              <span>•</span>
              <a href="#" aria-label="Cookies">Cookies</a>
              <span>•</span>
              <a href="#" aria-label="Nutzungsbedingungen">Nutzungsbedingungen</a>
              <span>•</span>
              <a href="#" aria-label="Impressum">Impressum</a>
              <span>•</span>
              <a href="#" aria-label="Support">Support</a>
            </div>
            <div className="footerLocale">Schweiz</div>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="mobileSimpleRoot">
      <video ref={videoRef} className="mobileSimpleVideo" playsInline muted autoPlay />

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
    </div>
  );
}
