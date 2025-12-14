import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import "./App.css";

const isLocal =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const SERVER_URL = isLocal
  ? "http://localhost:3000"
  : window.location.origin;

function App() {
  const socketRef = useRef(null);
  const videoRef = useRef(null);

  const [sessionId, setSessionId] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [status, setStatus] = useState("connecting");
  const [photos, setPhotos] = useState([]);
  const [cameraActive, setCameraActive] = useState(false);

  useEffect(() => {
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    setIsMobile(mobile);

    const params = new URLSearchParams(window.location.search);
    let session = params.get("session");

    if (!session && !mobile) {
      session = crypto.randomUUID().slice(0, 8);
      window.history.replaceState({}, "", `?session=${session}`);
    }

    setSessionId(session);

    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => setStatus("connected"));
    socket.on("disconnect", () => setStatus("disconnected"));

    if (session) {
      socket.emit("join-session", { sessionId: session });

      socket.on("photo", ({ imageDataUrl }) => {
        setPhotos((p) => [imageDataUrl, ...p]);
      });
    }

    return () => {
      socket.disconnect();
    };
  }, []);

  const startCamera = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    videoRef.current.srcObject = stream;
    setCameraActive(true);
  };

  const takePhoto = () => {
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas
      .getContext("2d")
      .drawImage(videoRef.current, 0, 0);

    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.7);
    socketRef.current.emit("photo", { sessionId, imageDataUrl });
  };

  if (!isMobile) {
    return (
      <div className="desktop">
        <h1>Phone ↔ Desktop Link</h1>
        {sessionId && <QRCodeSVG value={window.location.href} size={220} />}
        <p>Status: {status}</p>

        <div className="gallery">
          {photos.map((p, i) => (
            <img key={i} src={p} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mobile">
      {!cameraActive ? (
        <div className="start" onClick={startCamera}>
          Tap to start camera
        </div>
      ) : (
        <>
          <video ref={videoRef} autoPlay playsInline />
          <button className="shutter" onClick={takePhoto} />
        </>
      )}
    </div>
  );
}

export default App;
