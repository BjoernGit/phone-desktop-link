# Refactoring-Analyse

**Erstellt:** 2025-12-29
**Zuletzt aktualisiert:** 2025-12-30
**Status:** Phase 1-4 größtenteils abgeschlossen

---

## Zusammenfassung

| Phase | Aufwand | Impact | Status |
|-------|---------|--------|--------|
| 1. App.jsx + Utils aufteilen | 16-20h | Kritisch | [x] Erledigt |
| 2. Hooks + Server modularisieren | 12-16h | Hoch | [x] Erledigt |
| 3. Config + TypeScript | 10-14h | Mittel | [x] Erledigt |
| 4. Cleanup + Polish | 6-10h | Niedrig | [~] Teilweise (4.3 offen) |

**Gesamt:** ~45-60h für ~30% Code-Reduktion

---

## Phase 1: Kritisch

### 1.1 App.jsx aufteilen (1062 Zeilen)

**Problem:**
- 53 React Hooks in einer Datei
- Vermischt: Session-Management, Encryption, File Transfer, WebRTC, Clipboard, QR-Scanning, Touch-Gesten
- 40+ Props werden an Child-Components durchgereicht

**Lösung - Neue Custom Hooks erstellen:**

```
client/src/hooks/
├── useAppFileTransfer.js      # Zeilen 234-356, 459-531
├── useAppWebRTCSetup.js       # Zeilen 239-290
├── useAppEncryption.js        # Zeilen 644-874
└── useAppTouchGestures.js     # Zeilen 93-124
```

**useAppFileTransfer.js soll enthalten:**
- `sharedFiles`, `peerFiles`, `receivedBlobs` State
- Socket.io File Transfer Handlers (Zeilen 307-449)
- WebRTC File Transfer Setup (Zeilen 459-531)
- `handleFileDownload`, `handleSharedFilesChange`, `handleRemoveFile`
- Refs: `webRTCInitiatedRef`, `sharedFilesRef`, `registeredHandlersRef`

**useAppWebRTCSetup.js soll enthalten:**
- Eager WebRTC Connection Logic (Zeilen 253-290)
- File List Broadcast (Zeilen 292-305)
- `webRTCInitiatedRef` Management

**useAppEncryption.js soll enthalten:**
- `sessionSeed`, `offerSecret`, `encStatus`, `seedInitialized` State
- `decryptPhoto`, `applySeedAndStore`, `handleSeedInput`
- Encryption useEffect (Zeilen 817-856)
- `sendPhotoSecure`

**useAppTouchGestures.js soll enthalten:**
- `touchStartRef`
- `handleTouchStart`, `handleTouchEnd`
- Swipe Navigation Logic

---

### 1.2 Duplizierte Utility-Funktionen extrahieren

**Problem:**
- `formatFileSize()` in FileGallery.jsx UND FileUploadPanel.jsx identisch
- `getFileIcon()` in FileGallery.jsx UND FileUploadPanel.jsx identisch

**Lösung:**

Erstelle `client/src/utils/fileUtils.js`:

```javascript
/**
 * Format bytes to human readable string
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Get emoji icon for file type based on extension
 * @param {string} fileName
 * @returns {string}
 */
export function getFileIcon(fileName) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const icons = {
    pdf: "📄",
    doc: "📝", docx: "📝",
    xls: "📊", xlsx: "📊",
    ppt: "📽️", pptx: "📽️",
    zip: "📦", rar: "📦", "7z": "📦",
    mp3: "🎵", wav: "🎵", flac: "🎵",
    mp4: "🎬", avi: "🎬", mkv: "🎬", mov: "🎬",
    jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️", webp: "🖼️",
    txt: "📃",
    json: "📋",
    html: "🌐", css: "🎨", js: "⚡",
  };
  return icons[ext] || "📁";
}
```

Dann in beiden Components importieren:
```javascript
import { formatFileSize, getFileIcon } from "../utils/fileUtils";
```

---

## Phase 2: Hoch

### 2.1 useFileTransfer aufteilen (446 Zeilen)

**Problem:**
- Handhabt Senden UND Empfangen
- Verschachtelte State-Logik
- Timeout-Logik an mehreren Stellen dupliziert

**Lösung:**

```
client/src/hooks/
├── useFileSender.js     # sendFile, Backpressure, Chunking
└── useFileReceiver.js   # createMessageHandler, Reassembly, Timeouts
```

**Shared Config extrahieren:**

```javascript
// client/src/config/fileTransfer.js
export const FILE_TRANSFER_CONFIG = {
  CHUNK_SIZE: 16384,                    // 16 KB (WebRTC recommended)
  MAX_BUFFERED_AMOUNT: 256 * 1024,      // 256 KB
  MAX_FILE_SIZE: 500 * 1024 * 1024,     // 500 MB
  TRANSFER_CLEANUP_DELAY: 30 * 1000,    // 30 seconds
  TRANSFER_TIMEOUT: 5 * 60 * 1000,      // 5 minutes
  BACKPRESSURE_BASE_DELAY: 5,           // ms
  BACKPRESSURE_MAX_DELAY: 100,          // ms
};
```

---

### 2.2 useWebRTC refactoren (569 Zeilen)

**Problem:**
- Message-Listener-Setup dupliziert (Initiator/Receiver: Zeilen 150-162, 278-290)
- ICE-Candidate-Buffering dupliziert
- DataChannel-Handler (onopen, onclose, onerror) wiederholt

**Lösung - Helper-Funktionen extrahieren:**

```javascript
// client/src/utils/webrtcHelpers.js

/**
 * Setup DataChannel event handlers
 */
export function setupDataChannelHandlers(dc, peerUuid, {
  onOpen,
  onClose,
  onError,
  messageCallbacksRef,
  messageBufferRef,
}) {
  dc.addEventListener("message", (msgEvent) => {
    const callback = messageCallbacksRef.current.get(peerUuid);
    if (callback) {
      callback(msgEvent);
    } else {
      const buffer = messageBufferRef.current.get(peerUuid) || [];
      buffer.push(msgEvent);
      messageBufferRef.current.set(peerUuid, buffer);
    }
  });

  dc.onopen = onOpen;
  dc.onclose = onClose;
  dc.onerror = onError;
}
```

---

### 2.3 server.js modularisieren (606 Zeilen)

**Problem:**
- Alle Socket-Events in einer Datei
- Rate-Limiting-Logik verstreut
- File-Transfer-Handler dupliziert

**Lösung - Neue Dateistruktur:**

```
server/
├── server.js                      # Main entry, Express setup
├── config/
│   └── limits.js                  # All rate limits and thresholds
├── middleware/
│   └── rateLimiter.js             # createRateLimiter, ban logic
├── handlers/
│   ├── sessionHandler.js          # join-session, leave-session, peer-decision
│   ├── photoHandler.js            # photo events
│   ├── offerHandler.js            # session-offer
│   ├── webrtcSignaling.js         # webrtc-offer, webrtc-answer, webrtc-ice-candidate
│   └── fileTransferHandler.js     # file-request, file-transfer-*, file-list-update
└── session/
    └── sessionManager.js          # Session state management
```

**server/config/limits.js:**

```javascript
module.exports = {
  // Rate limits
  PHOTO_LIMIT_PER_IP: 20,
  PHOTO_LIMIT_PER_SESSION: 120,
  OFFER_LIMIT_PER_IP: 10,
  OFFER_LIMIT_PER_SESSION: 60,
  JOIN_LIMIT: 10,

  // Time windows
  RATE_WINDOW_MS: 60 * 1000,
  JOIN_WINDOW_MS: 60 * 1000,

  // File transfer
  SOCKETIO_MAX_FILE_SIZE: 30 * 1024 * 1024,
  SOCKETIO_TRANSFER_LIMIT_BYTES: 100 * 1024 * 1024,
  MAX_CONCURRENT_TRANSFERS: 3,

  // Security
  NONCE_TTL_MS: 5 * 60 * 1000,
  BAN_DURATION_MS: 15 * 60 * 1000,
  BAN_THRESHOLD: 5,
  MAX_CIPHER_BASE64: 8_000_000,
};
```

---

## Phase 3: Mittel

### 3.1 Magic Numbers zentralisieren

**Betroffene Stellen:**

| Datei | Zeile | Problem |
|-------|-------|---------|
| App.jsx | 28-40 | IP-Ranges hardcoded |
| App.jsx | 670 | QR TTL als Magic Number |
| App.jsx | 316, 327 | Chunk-Size als Literal |
| server.js | 39-41, 65-66 | Timeout-Konstanten verstreut |

**Lösung:**

```
client/src/config/
├── network.js      # PRIVATE_IP_RANGES, isLocalNetwork()
├── security.js     # QR_TTL_MS, NONCE_TTL_MS
└── fileTransfer.js # CHUNK_SIZE, MAX_FILE_SIZE
```

**client/src/config/network.js:**

```javascript
export const PRIVATE_IP_RANGES = [
  "localhost",
  "127.0.0.1",
  ".local",
  "192.168.",
  "10.",
  "172.16.", "172.17.", "172.18.", "172.19.",
  "172.2", "172.3",
];

export function isLocalNetwork(hostname) {
  return PRIVATE_IP_RANGES.some(range =>
    hostname === range ||
    hostname.endsWith(range) ||
    hostname.startsWith(range)
  );
}
```

---

### 3.2 TypeScript hinzufügen (Phased)

**Phase 3.2a - JSDoc für Utils:**

```javascript
// client/src/utils/crypto.js
/**
 * @typedef {Object} EncryptedPayload
 * @property {string} iv - Base64url encoded IV
 * @property {string} ciphertext - Base64url encoded ciphertext
 * @property {string} [mime] - Optional MIME type
 */

/**
 * Encrypt a data URL
 * @param {string} dataUrl - The data URL to encrypt
 * @param {CryptoKey} key - The encryption key
 * @returns {Promise<EncryptedPayload>}
 */
export async function encryptDataUrl(dataUrl, key) { ... }
```

**Phase 3.2b - tsconfig.json hinzufügen:**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["client/src/**/*"],
  "exclude": ["node_modules"]
}
```

---

### 3.3 Error Handling vereinheitlichen

**Problem:**
- `alert()` blockiert UI
- Errors nur geloggt, nicht angezeigt
- Inkonsistente Fehlerbehandlung

**Lösung:**

```javascript
// client/src/utils/errorHandler.js

/**
 * @typedef {'error' | 'warning' | 'info'} NotificationType
 */

/**
 * Show notification to user (non-blocking)
 * @param {string} message
 * @param {NotificationType} type
 */
export function notifyUser(message, type = 'error') {
  // TODO: Integrate with a toast library or custom notification system
  // For now, use console and non-blocking notification
  if (type === 'error') {
    console.error(`[User Error] ${message}`);
  } else {
    console.log(`[User ${type}] ${message}`);
  }

  // Temporary: Use alert but could be replaced with toast
  if (type === 'error') {
    setTimeout(() => alert(message), 0);
  }
}

/**
 * Handle file transfer errors
 * @param {Error} error
 * @param {string} context
 */
export function handleFileTransferError(error, context) {
  console.error(`[FileTransfer] ${context}:`, error);
  notifyUser(`File transfer failed: ${error.message}`, 'error');
}

/**
 * Handle socket errors
 * @param {Error} error
 */
export function handleSocketError(error) {
  console.error(`[Socket] Error:`, error);
  notifyUser('Connection error. Please refresh the page.', 'error');
}
```

---

## Phase 4: Niedrig

### 4.1 Dead Code entfernen

| Datei | Zeilen | Problem |
|-------|--------|---------|
| MobileApp.jsx | 60-71 | MobileDebugPill mit `display: none` |
| useSessionSockets.js | 224-230 | "manual-join" Event unbenutzt |

**Aktion:** Entweder entfernen oder mit Feature-Flag steuern.

---

### 4.2 Duplizierte Canvas-Logik in image.js

**Problem:**
- `blobToJpeg()` und `blobToPng()` fast identisch (Zeilen 13-50 vs 52-85)

**Lösung:**

```javascript
// client/src/utils/image.js

async function convertBlobToFormat(blob, format, quality = 0.92) {
  // Shared canvas conversion logic
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  let img;
  try {
    img = await createImageBitmap(blob);
  } catch {
    // Fallback for older browsers
    img = await loadImageFromBlob(blob);
  }

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob(resolve, `image/${format}`, quality);
  });
}

export async function blobToJpeg(blob, quality = 0.92) {
  return convertBlobToFormat(blob, 'jpeg', quality);
}

export async function blobToPng(blob) {
  return convertBlobToFormat(blob, 'png', 1);
}
```

---

### 4.3 Component-Struktur verbessern

**DesktopApp.jsx (280 Zeilen, 68 Props):**

Aufteilen in:
```
client/src/components/desktop/
├── DesktopApp.jsx           # Main container
├── QrSection.jsx            # QR display logic
├── ActiveSessionSection.jsx # Peers, canvas, files
├── PendingApprovals.jsx     # Approval UI
└── LegalPageHandler.jsx     # Legal modal logic
```

---

## Fortschritts-Tracking

### Phase 1
- [x] 1.1 App.jsx aufteilen *(teilweise erledigt 2025-12-30)*
  - [x] useAppFileTransfer.js erstellen *(~400 Zeilen aus App.jsx extrahiert)*
  - [ ] useAppWebRTCSetup.js erstellen *(in useAppFileTransfer integriert)*
  - [ ] useAppEncryption.js erstellen *(noch ausstehend - stark verwoben)*
  - [x] useAppTouchGestures.js erstellen
  - [x] App.jsx refactoren *(von 1062 auf ~650 Zeilen reduziert)*
- [x] 1.2 fileUtils.js erstellen *(erledigt 2025-12-29)*
  - [x] formatFileSize extrahieren
  - [x] getFileIcon extrahieren
  - [x] FileGallery.jsx updaten
  - [x] FileUploadPanel.jsx updaten

### Phase 2
- [x] 2.1 useFileTransfer aufteilen *(erledigt 2025-12-30)*
  - [x] useFileSender.js erstellen
  - [x] useFileReceiver.js erstellen
  - [x] fileTransfer config erstellen
- [x] 2.2 useWebRTC refactoren *(erledigt 2025-12-30)*
  - [x] webrtcHelpers.js erstellen
  - [x] DataChannel setup extrahieren
- [x] 2.3 server.js modularisieren *(erledigt 2025-12-30)*
  - [x] config/limits.js erstellen
  - [x] handlers/ Ordner erstellen
  - [x] session/sessionManager.js erstellen
  - [x] middleware/rateLimiter.js erstellen
  - [x] utils/validation.js erstellen

### Phase 3
- [x] 3.1 Config-Dateien erstellen *(erledigt 2025-12-30)*
  - [x] network.js erstellen (IP-Range-Erkennung)
  - [x] security.js erstellen (QR TTL, Status-Timeouts)
  - [x] App.jsx aktualisieren (imports + usage)
- [x] 3.2 TypeScript/JSDoc hinzufügen *(erledigt 2025-12-30)*
  - [x] crypto.js vollständig dokumentiert
- [x] 3.3 Error Handler erstellen *(erledigt 2025-12-30)*
  - [x] errorHandler.js mit notifyUser, handleFileTransferError, etc.

### Phase 4
- [x] 4.1 Dead Code entfernen *(geprüft 2025-12-30)*
  - MobileDebugPill: Behalten - ist absichtlich verstecktes Debug-Tooling
  - manual-join Event: Behalten - ist Notfall-Fallback
- [x] 4.2 image.js refactoren *(erledigt 2025-12-30)*
  - [x] convertBlobToFormat() extrahiert
  - [x] blobToJpeg/blobToPng vereinfacht
- [ ] 4.3 Component-Struktur verbessern

---

## Notizen

### 2025-12-30: Phase 1 Refactoring

**Neue Dateien erstellt:**
- `client/src/hooks/useAppTouchGestures.js` - Touch-Gesten für Mobile-Navigation
- `client/src/hooks/useAppFileTransfer.js` - Komplette File-Transfer-Orchestrierung (WebRTC + Socket.io)
- `client/src/utils/fileUtils.js` - Gemeinsame File-Utility-Funktionen

**App.jsx Reduktion:**
- Vorher: 1062 Zeilen
- Nachher: ~650 Zeilen
- Entfernt: ~400 Zeilen File-Transfer-Logik

**Entscheidungen:**
- `useAppWebRTCSetup` wurde in `useAppFileTransfer` integriert, da die WebRTC-Logik eng mit File-Transfer verbunden ist
- `useAppEncryption` wurde nicht extrahiert, da die Encryption-Logik stark mit Session-Management und Photo-Handling verwoben ist - würde zu vielen Parametern führen

**Build erfolgreich:** `npm run build` läuft ohne Fehler durch.

**Bug-Fix (peer-file-list):**
- Problem: Nach dem Refactoring wurden Peer-Dateilisten nicht mehr angezeigt
- Ursache: `onPeerFileList` wurde nicht mehr an `useSessionSockets` übergeben
- Lösung: `peerFileListHandlerRef` Ref-Pattern verwendet um Henne-Ei-Problem zu umgehen
  - `useSessionSockets` ruft `onPeerFileList` auf (braucht callback vor socket)
  - `useAppFileTransfer` gibt `handlePeerFileList` zurück (braucht socket)
  - Ref wird nach `useAppFileTransfer` gesetzt und von `useSessionSockets` verwendet

### 2025-12-30: Phase 2.3 Server Config

**Neue Datei erstellt:**
- `server/config/limits.js` - Zentralisierte Server-Konfiguration

**Enthält alle Rate-Limits und Thresholds:**
- CORS/Origins Konfiguration
- Socket.io Buffer-Größe
- Security/Banning (Nonce TTL, Ban Duration, Strike Threshold)
- Rate Limits für Joins, Photos, Offers
- File Transfer Limits (Max Size, Transfer Rate, Concurrent Transfers)
- Validation Limits (Cipher Size, Session/UUID Längen)

**server.js aktualisiert:**
- Alle hardcodierten Konstanten durch `config.*` ersetzt
- Lokale `SOCKETIO_MAX_FILE_SIZE` Konstante entfernt
- Import: `const config = require("./config/limits");`

### 2025-12-30: Phase 2.1 useFileTransfer aufteilen

**Neue Dateien erstellt:**
- `client/src/config/fileTransfer.js` - Zentralisierte File-Transfer-Konfiguration
- `client/src/hooks/useFileSender.js` - Sende-Logik mit Backpressure-Control
- `client/src/hooks/useFileReceiver.js` - Empfangs-Logik mit Chunk-Reassembly

**fileTransfer.js Config enthält:**
- `FILE_TRANSFER_CONFIG`: Chunk-Größe, Buffer-Limits, Timeouts, Backpressure-Parameter
- `TRANSFER_STATUS`: Status-Konstanten (sending, receiving, completed, failed, timeout)
- `FILE_MESSAGE_TYPES`: Protokoll-Nachrichtentypen (file-start, file-chunk, file-complete, file-request)

**useFileTransfer.js refactored:**
- Vorher: 446 Zeilen (monolithisch)
- Nachher: 84 Zeilen (Komposition)
- Composiert useFileSender + useFileReceiver
- API bleibt vollständig kompatibel (keine Breaking Changes)

**Build erfolgreich:** `npm run build` läuft ohne Fehler durch.

### 2025-12-30: Phase 2.2 useWebRTC refactoren

**Neue Datei erstellt:**
- `client/src/utils/webrtcHelpers.js` - Extrahierte WebRTC-Hilfsfunktionen

**webrtcHelpers.js enthält:**
- `setupDataChannelMessageListener()` - Message-Listener mit Buffering (eliminiert Duplikation)
- `setupDataChannelEventHandlers()` - onopen, onclose, onerror, onstatechange (eliminiert Duplikation)
- `processBufferedIceCandidates()` - ICE-Kandidaten-Verarbeitung (eliminiert Duplikation)
- `createPeerConnectionConfig()` - RTCPeerConnection-Konfiguration
- `WEBRTC_CONFIG` - Zentralisierte Konstanten (MAX_ICE_CANDIDATES, ICE_SERVERS, Timeouts)

**useWebRTC.js refactored:**
- Vorher: 569 Zeilen
- Nachher: 483 Zeilen (~15% Reduktion)
- Duplizierten DataChannel-Handler-Code eliminiert (createOffer + handleOffer)
- Duplizierten ICE-Processing-Code eliminiert (handleOffer + handleAnswer)
- Magic Numbers in WEBRTC_CONFIG zentralisiert

**Build erfolgreich:** `npm run build` läuft ohne Fehler durch.

### 2025-12-30: Phase 2.3 Server Modularisierung

**Neue Server-Struktur:**
```
server/
├── server.js                    # Main entry (cleaner Imports)
├── config/
│   └── limits.js               # Alle Konfigurationskonstanten
├── session/
│   └── sessionManager.js       # Session-State-Verwaltung
├── middleware/
│   └── rateLimiter.js          # Rate Limiting, Banning, Audit Logging
├── utils/
│   └── validation.js           # Input-Validierung
└── handlers/
    ├── webrtcSignaling.js      # WebRTC offer/answer/ICE
    └── fileTransferHandler.js  # File-Transfer-Events
```

**Neue Dateien erstellt:**
- `server/session/sessionManager.js` - Session-State, roomName(), coerceSessionId(), inRoom(), findSocketsByUuid()
- `server/middleware/rateLimiter.js` - Alle Rate-Limiter, isBanned(), registerStrike(), nonceSeen(), auditLog()
- `server/utils/validation.js` - isValidSessionId(), isValidRole(), isValidUuid(), isValidBase64Url(), isValidMime(), isValidEncPayload(), hmacValid()
- `server/handlers/webrtcSignaling.js` - WebRTC-Events (offer, answer, ice-candidate)
- `server/handlers/fileTransferHandler.js` - File-Transfer-Events (file-list-update, file-request, file-transfer-*)

**server.js refactored:**
- Entfernt: `crypto`, `fs` Imports (in Module verschoben)
- Alle Funktionen in spezialisierte Module extrahiert
- Klare Import-Struktur mit Kategorien (Config, Session, Rate Limiting, Validation, Handlers)
- Handler-Registrierung modular: `registerWebRTCHandlers()`, `registerFileTransferHandlers()`

**Server-Syntax-Check:** `node --check server/server.js` erfolgreich.

### 2025-12-30: Phase 3 Client Config & Error Handling

**Neue Dateien erstellt:**
- `client/src/config/network.js` - Netzwerk-Erkennung
  - `PRIVATE_IP_PATTERNS` - Array mit localhost, .local, RFC 1918 Ranges
  - `isLocalNetwork(hostname)` - Prüft ob Host lokal/privat ist
- `client/src/config/security.js` - Sicherheits-Konstanten
  - `QR_TTL_MS` - QR-Code Gültigkeitsdauer (10 Minuten)
  - `STATUS_DISMISS_MS` - Status-Meldung Anzeigedauer (3 Sekunden)
  - `SESSION_STATUS_DISMISS_MS` - Session-Status Anzeigedauer (2 Sekunden)
- `client/src/utils/errorHandler.js` - Zentralisierte Fehlerbehandlung
  - `notifyUser(message, type, options)` - Nicht-blockierende Benutzerbenachrichtigung
  - `handleFileTransferError(error, context)` - File-Transfer-Fehler
  - `handleWebRTCError(error, peerUuid)` - WebRTC-Fehler
  - `handleSocketError(error)` - Socket-Fehler
  - `handleCryptoError(error, operation)` - Crypto-Fehler
  - `withErrorHandling(fn, context)` - Async Error Wrapper

**App.jsx aktualisiert:**
- Import von `isLocalNetwork` aus config/network.js
- Import von `QR_TTL_MS`, `STATUS_DISMISS_MS`, `SESSION_STATUS_DISMISS_MS` aus config/security.js
- Hardcodierte IP-Range-Prüfung (12 Zeilen) durch `isLocalNetwork(host)` ersetzt
- Magic Numbers (2000, 3000, 10*60*1000) durch Config-Konstanten ersetzt

**JSDoc-Dokumentation hinzugefügt:**
- `client/src/utils/crypto.js` - Vollständige JSDoc-Dokumentation
  - Typedef für `EncryptedPayload` und `DataUrlParts`
  - Alle Funktionen dokumentiert mit @param, @returns, @throws

### 2025-12-30: Phase 4 Cleanup

**Dead Code Review (4.1):**
- `MobileDebugPill` - Versteckt via `display: none`, aber absichtlich behalten für Mobile-Debugging
- `manual-join` Event - Notfall-Fallback für Session-Join, absichtlich behalten
- Beide sind Debug/Emergency-Tooling, kein echter Dead Code

**image.js refactored (4.2):**
- Vorher: 100 Zeilen mit duplizierter Canvas-Logik in blobToJpeg/blobToPng
- Nachher: 113 Zeilen mit shared `convertBlobToFormat()` Funktion
- Duplikation eliminiert, JSDoc hinzugefügt
- Bonus: `try/finally` für sauberes URL.revokeObjectURL()

**Verbleibend (4.3):**
- DesktopApp.jsx (280 Zeilen, 68 Props) könnte in QrSection, ActiveSessionSection, etc. aufgeteilt werden
- Nicht dringend, da die aktuelle Struktur funktional ist
