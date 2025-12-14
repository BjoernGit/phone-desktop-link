import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import './App.css';

// --- CONNECTION LOGIC ---
// Local (localhost) -> Force Port 3000.
// Online (Render) -> Automatically use the current URL (since Frontend & Backend are served together).
const SERVER_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000' 
  : window.location.origin;

const socket = io(SERVER_URL);

function App() {
  const [sessionId, setSessionId] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [status, setStatus] = useState('Waiting for connection...');
  const [photos, setPhotos] = useState([]);
  const [cameraActive, setCameraActive] = useState(false);
  
  const videoRef = useRef(null);

  useEffect(() => {
    // Check if mobile device
    const checkMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);
    setIsMobile(checkMobile);

    // Get Session ID from URL or create new one
    const params = new URLSearchParams(window.location.search);
    let currentSession = params.get("session");

    if (!currentSession && !checkMobile) {
      currentSession = crypto.randomUUID().slice(0, 8);
      const newUrl = `${window.location.pathname}?session=${currentSession}`;
      window.history.replaceState({}, "", newUrl);
    }

    if (currentSession) {
      setSessionId(currentSession);
      
      // Event Listeners
      socket.on(`session-${currentSession}`, (imageSrc) => {
        setPhotos((prev) => [imageSrc, ...prev]); 
      });

      socket.on("connect", () => {
        setStatus("Connected! 🟢");
      });

      socket.on("disconnect", () => {
        setStatus("Disconnected 🔴");
      });

      return () => {
        socket.off(`session-${currentSession}`);
        socket.off("connect");
        socket.off("disconnect");
      };
    }
  }, []);

  const startCamera = async () => {
    try {
      setCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment" } 
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Camera Error: " + err.message);
      setCameraActive(false);
    }
  };

  const takePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.7);
    
    socket.emit("photo", { sessionId, imageDataUrl });
    if (navigator.vibrate) navigator.vibrate(50);
    alert("Sent! 🚀");
  };

  if (!isMobile) {
    return (
      <div className="container desktop">
        <h1>Phone ↔ Desktop Link 💻</h1>
        <div className="box">
          <p className="muted">Scan the QR Code:</p>
          {sessionId && (
            <div className="qr-wrapper">
              <QRCodeSVG value={window.location.href} size={200} />
            </div>
          )}
          <div className="status-box">Status: <strong>{status}</strong></div>
        </div>
        <div className="gallery">
          {photos.map((src, idx) => (
            <img key={idx} src={src} alt={`Upload ${idx}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-fullscreen">
      {!cameraActive ? (
        <div className="start-screen" onClick={startCamera}>
          <h2>Start Camera 📸</h2>
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