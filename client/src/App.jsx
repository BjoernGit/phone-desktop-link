import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import './App.css';

// --- WICHTIGE EINSTELLUNG ---
// 1. Wenn wir lokal sind (localhost), nutzen wir strikt Port 3000.
// 2. Wenn wir auf Render sind, nutzen wir die aktuelle URL (Origin).
// HINWEIS: Falls dein Backend auf Render eine ANDERE URL hat als das Frontend,
// musst du 'window.location.origin' durch die echte Backend-URL ersetzen!
const SERVER_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000' 
  : window.location.origin; 

const socket = io(SERVER_URL);

function App() {
  const [sessionId, setSessionId] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [status, setStatus] = useState('Warte auf Verbindung...');
  const [photos, setPhotos] = useState([]);
  const [cameraActive, setCameraActive] = useState(false);
  
  const videoRef = useRef(null);

  useEffect(() => {
    // Mobil-Erkennung
    const checkMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);
    setIsMobile(checkMobile);

    // Session ID aus URL holen
    const params = new URLSearchParams(window.location.search);
    let currentSession = params.get("session");

    // Wenn Desktop und noch keine Session -> Neue generieren
    if (!currentSession && !checkMobile) {
      currentSession = crypto.randomUUID().slice(0, 8);
      const newUrl = `${window.location.pathname}?session=${currentSession}`;
      window.history.replaceState({}, "", newUrl);
    }

    if (currentSession) {
      setSessionId(currentSession);
      console.log("Beitreten der Session:", currentSession);

      // --- SOCKET EVENTS ---

      // Empfange Foto nur für diese Session
      socket.on(`session-${currentSession}`, (imageSrc) => {
        console.log("Neues Foto empfangen!");
        setPhotos((prev) => [imageSrc, ...prev]); 
      });

      socket.on("connect", () => {
        setStatus("Verbunden! 🟢");
      });

      socket.on("disconnect", () => {
        setStatus("Getrennt 🔴");
      });

      return () => {
        socket.off(`session-${currentSession}`);
        socket.off("connect");
        socket.off("disconnect");
      };
    }
  }, []);

  // Kamera starten
  const startCamera = async () => {
    try {
      setCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment" } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Kamera Fehler:", err);
      alert("Kamera-Zugriff verweigert oder nicht möglich.");
      setCameraActive(false);
    }
  };

  // Foto machen & Senden
  const takePhoto = () => {
    if (!videoRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    
    // Als JPG komprimieren
    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.7);
    
    // An Server senden
    socket.emit("photo", { sessionId, imageDataUrl });
    
    if (navigator.vibrate) navigator.vibrate(50);
    alert("Foto gesendet! 🚀");
  };

  // --- DESKTOP ANSICHT ---
  if (!isMobile) {
    return (
      <div className="container desktop">
        <h1>Phone ↔ Desktop Link 💻</h1>
        <div className="box">
          <p className="muted">Scanne diesen Code (Handy öffnet Render URL):</p>
          
          {sessionId && (
            <div className="qr-wrapper">
              <QRCodeSVG value={window.location.href} size={200} />
            </div>
          )}
          
          <div className="status-box">Status: <strong>{status}</strong></div>
        </div>

        <div className="gallery">
          {photos.map((src, idx) => (
            <img key={idx} src={src} alt={`Foto ${idx}`} />
          ))}
        </div>
      </div>
    );
  }

  // --- MOBILE ANSICHT ---
  return (
    <div className="mobile-fullscreen">
      {!cameraActive ? (
        <div className="start-screen" onClick={startCamera}>
          <h2>Kamera starten 📸</h2>
          <p>Session: {sessionId}</p>
        </div>
      ) : (
        <>
          <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
          <div className="controls">
            <button className="shutter-btn" onClick={takePhoto}></button>
          </div>
        </>
      )}
    </div>
  );
}

export default App;