# Session Merge - Analyse und Implementierungsplan

## Problem: Cognitive Overload beim QR-Scan

Beim Scannen eines QR-Codes auf dem Mobilgerät erscheint aktuell ein Dialog mit zwei Optionen:

1. **"Read Session"** - Wechsle zur Session des gescannten QR-Codes
2. **"Send Own Session"** - Sende meine Session an das andere Gerät

**Das Problem:** Der User muss verstehen, welche Session "gewinnen" soll. Diese Entscheidung ist für normale Anwender verwirrend - sie wollen einfach nur, dass alle Geräte miteinander verbunden sind.

---

## Ist-Zustand Analyse

### Aktuelle Architektur

#### Session-Identifikation
- Jedes Gerät generiert eine 16-Zeichen Session-ID (`crypto.randomUUID().slice(0,16)`)
- Die Session-ID wird in der URL gespeichert (`?session=abc123...`)
- Relevante Datei: [client/src/utils/session.js](../client/src/utils/session.js)

#### Seed und Verschlüsselung
- Jede Session hat einen 128-bit Seed (base64url-kodiert)
- Der Seed wird via HKDF zu einem AES-GCM-128 Key abgeleitet
- Geräte mit gleichem Seed + Session-ID haben denselben Encryption Key
- Relevante Datei: [client/src/utils/crypto.js](../client/src/utils/crypto.js)

#### QR-Code Format
```
https://example.com/?session=ABC123&uid=DEVICE_UUID#seed=BASE64SEED&ok=OFFERSECRET&t=TIMESTAMP
```

Komponenten:
- `session` - Session-ID (required)
- `uid` - UUID des QR-Erstellers (optional)
- `seed` - Encryption Seed (im Hash-Fragment, nicht an Server gesendet)
- `ok` - Offer Secret für verschlüsselte Session-Offers
- `t` - Timestamp für TTL-Validierung (10 Minuten)

#### Session-Offer Mechanismus
1. Device B scannt QR von Device A
2. Dialog erscheint mit zwei Optionen:
   - **Read Session**: B wechselt zu A's Session, übernimmt A's Seed
   - **Send Own Session**: B verschlüsselt seine Session/Seed mit A's `offerSecret` und sendet via Server

Relevante Dateien:
- [client/src/hooks/useSessionSockets.js](../client/src/hooks/useSessionSockets.js) - `sendSessionOffer`
- [client/src/App.jsx](../client/src/App.jsx) - `applyQrOffer`, `onSessionOffer`
- [server/server.js](../server/server.js) - `session-offer` Handler

### Was passiert bei den aktuellen Optionen

#### Szenario 1: "Read Session" (B → A's Session)

```
VORHER:
  Session A: [Desktop-A, Computer-C]
  Session B: [Mobile-B, Tablet-D]

User auf Mobile-B scannt QR von Desktop-A und wählt "Read Session"

NACHHER:
  Session A: [Desktop-A, Computer-C, Mobile-B]  ← B ist gewechselt
  Session B: [Tablet-D]                          ← D bleibt alleine zurück
```

**Problem:** Tablet-D weiß nicht, dass Mobile-B gewechselt ist. Es bleibt isoliert.

#### Szenario 2: "Send Own Session" (A → B's Session)

```
VORHER:
  Session A: [Desktop-A, Computer-C]
  Session B: [Mobile-B, Tablet-D]

User auf Mobile-B scannt QR von Desktop-A und wählt "Send Own Session"

NACHHER:
  Session A: [Computer-C]                        ← C bleibt alleine zurück
  Session B: [Mobile-B, Tablet-D, Desktop-A]     ← A hat gewechselt
```

**Problem:** Computer-C weiß nicht, dass Desktop-A gewechselt ist. Es bleibt isoliert.

---

## Gewünschtes Verhalten

**"Sessions mergen"** = ALLE Teilnehmer von Session A UND Session B landen in EINER gemeinsamen Session mit demselben Seed/Key.

```
VORHER:
  Session A: [Desktop-A, Computer-C]
  Session B: [Mobile-B, Tablet-D]

User auf Mobile-B scannt QR von Desktop-A und wählt "Sessions zusammenführen"

NACHHER:
  Session A: [Desktop-A, Computer-C, Mobile-B, Tablet-D]  ← Alle vereint
  Session B: [leer/aufgelöst]
```

---

## Konzept-Entscheidungen

### Frage 1: Welche Session "gewinnt"?

| Option | Beschreibung | Pro | Contra |
|--------|--------------|-----|--------|
| A | Die ältere Session | Konsistent | Nicht immer die "richtige" |
| B | Die größere Session (mehr Teilnehmer) | Minimiert Migration | Komplexe Logik |
| C | Immer die des Scanners | Intuitiv für Scanner | Kontra-intuitiv für Gescannten |
| **D** | **Immer die des Gescannten** | **Intuitiv: "Ich scanne um beizutreten"** | - |

**Empfehlung:** Option **D** - Die Session des QR-Codes gewinnt. Das entspricht der mentalen Erwartung: "Ich scanne den Code, um dieser Session beizutreten."

### Frage 2: Auto-Accept oder Bestätigung?

| Option | Beschreibung | Pro | Contra |
|--------|--------------|-----|--------|
| A | Auto-Accept | Nahtlose UX | Weniger Kontrolle |
| B | Bestätigungs-Modal | Volle Kontrolle | Zusätzlicher Klick |
| **C** | **Feature-Flag gesteuert** | **Flexibel** | Mehr Code |

**Empfehlung:** Option **C** - Feature-Flag `AUTO_ACCEPT_SESSION_MERGES` (default: true)

### Frage 3: Was passiert mit Approval-Status?

Wenn ein Gerät die Session wechselt, muss sein Approval-Status (approved/pending/rejected) migriert werden.

**Empfehlung:**
- `approved` Status wird zur neuen Session übertragen
- `pending` bleibt pending (muss neu genehmigt werden)
- `rejected` wird NICHT übertragen (frischer Start)

---

## Implementierungsplan

### Phase 1: Server-seitiger Merge-Handler

**Datei:** `server/server.js`

Neues Event `session-merge`:

```javascript
socket.on("session-merge", async ({ fromSession, toSession, toSeed, toOfferSecret }) => {
  const sid = coerceSessionId(fromSession);
  if (!sid || !toSession || !toSeed) return;

  // Validierung
  if (socket.data.sessionId !== sid) return;
  if (!isValidSessionId(toSession)) return;

  // Rate-Limiting
  if (!allowMerge(ip)) {
    registerStrike(ip, "merge-rate");
    return;
  }

  console.log(`session-merge: ${sid} → ${toSession}`);
  auditLog("merge", { from: sid, to: toSession, initiator: socket.data.clientUuid });

  // Finde alle Sockets in der Quell-Session
  const fromRoom = roomName(sid);
  const roomSockets = io.sockets.adapter.rooms.get(fromRoom);
  if (!roomSockets) return;

  // Generiere Nonce für Replay-Schutz
  const nonce = generateNonce();
  const ts = Date.now();

  // Sende "merge-redirect" an alle Peers (außer Initiator)
  const mergeRedirect = {
    toSession,
    toSeed,          // Verschlüsselt transportiert
    toOfferSecret,
    initiatorUuid: socket.data.clientUuid,
    nonce,
    ts,
  };

  roomSockets.forEach((socketId) => {
    if (socketId === socket.id) return;
    const peerSocket = io.sockets.sockets.get(socketId);
    if (peerSocket) {
      peerSocket.emit("merge-redirect", mergeRedirect);
    }
  });

  // Migriere Approval-Status
  const fromState = getSessionState(sid);
  const toState = getSessionState(toSession);

  fromState.approved.forEach((uuid) => {
    toState.approved.add(uuid);
  });
});
```

**Neue Rate-Limiter-Funktion:**

```javascript
// In middleware/rateLimiter.js
const mergeRequests = new Map();
const MERGE_LIMIT = 5;      // Max 5 merges
const MERGE_WINDOW = 60000; // Pro Minute

function allowMerge(ip) {
  const now = Date.now();
  const record = mergeRequests.get(ip) || { count: 0, windowStart: now };

  if (now - record.windowStart > MERGE_WINDOW) {
    record.count = 1;
    record.windowStart = now;
  } else {
    record.count++;
  }

  mergeRequests.set(ip, record);
  return record.count <= MERGE_LIMIT;
}
```

### Phase 2: Client-seitige Merge-Logik

**Datei:** `client/src/hooks/useSessionSockets.js`

Neue Funktion `sendSessionMerge`:

```javascript
const sendSessionMerge = useCallback(
  async (targetOffer) => {
    if (!sessionId || !targetOffer?.session) return;

    const mergePayload = {
      fromSession: sessionId,
      toSession: targetOffer.session,
      toSeed: targetOffer.seed,
      toOfferSecret: targetOffer.offerSecret,
    };

    socket.emit("session-merge", mergePayload);

    // Initiator wechselt selbst zur Ziel-Session
    // (wird von App.jsx via Callback behandelt)
  },
  [sessionId, socket]
);
```

Neuer Event-Listener für `merge-redirect`:

```javascript
useEffect(() => {
  const handleMergeRedirect = (payload) => {
    const { toSession, toSeed, toOfferSecret, initiatorUuid, nonce, ts } = payload;

    // Validierung
    if (!toSession || !toSeed) return;

    // TTL-Check (5 Minuten)
    if (Date.now() - ts > 5 * 60 * 1000) {
      console.warn("merge-redirect expired");
      return;
    }

    // Callback an App.jsx
    onMergeRedirect?.({
      toSession,
      toSeed,
      toOfferSecret,
      initiatorUuid,
    });
  };

  socket.on("merge-redirect", handleMergeRedirect);
  return () => socket.off("merge-redirect", handleMergeRedirect);
}, [socket, onMergeRedirect]);
```

### Phase 3: App-Integration

**Datei:** `client/src/App.jsx`

Neuer Callback `onMergeRedirect`:

```javascript
const handleMergeRedirect = useCallback(
  (payload) => {
    const { toSession, toSeed, toOfferSecret, initiatorUuid } = payload;

    // Auto-Accept wenn Flag gesetzt
    if (FEATURE_FLAGS.AUTO_ACCEPT_SESSION_MERGES) {
      applyQrOffer({
        session: toSession,
        seed: toSeed,
        offerSecret: toOfferSecret,
      });
      setQrStatus(t("status.sessionMerged"));
      setTimeout(() => setQrStatus(""), SESSION_STATUS_DISMISS_MS);
      return;
    }

    // Sonst: Zeige Bestätigungs-Modal
    setMergeRequest({
      toSession,
      toSeed,
      toOfferSecret,
      initiatorUuid,
    });
  },
  [applyQrOffer, t]
);
```

### Phase 4: UI-Vereinfachung

**Datei:** `client/src/MobileApp.jsx`

Ersetze die zwei verwirrenden Buttons durch einen klaren "Merge"-Button:

```jsx
<div className="qrOfferActions">
  {/* Primärer Button: Sessions zusammenführen */}
  <button
    type="button"
    className="qrOfferBtn primary"
    onClick={() => {
      sendSessionMerge(qrOffer);
      applyQrOffer(qrOffer);  // Initiator wechselt selbst
      setQrOffer(null);
      setShowQrDialog(false);
    }}
  >
    {t("mobile.qr.mergeSessions")}
  </button>

  {/* Erweiterte Optionen (eingeklappt) */}
  <details className="qrAdvancedOptions">
    <summary>{t("mobile.qr.advancedOptions")}</summary>
    <div className="qrAdvancedButtons">
      <button
        type="button"
        className="qrOfferBtn secondary"
        onClick={() => {
          applyQrOffer(qrOffer);  // Nur selbst wechseln
          setQrOffer(null);
          setShowQrDialog(false);
        }}
      >
        {t("mobile.qr.joinAlone")}
      </button>
      <button
        type="button"
        className="qrOfferBtn secondary"
        onClick={() => {
          sendSessionOffer(...);  // Andere einladen
          setQrOffer(null);
          setShowQrDialog(false);
        }}
      >
        {t("mobile.qr.inviteOther")}
      </button>
    </div>
  </details>
</div>
```

### Phase 5: Neue Übersetzungen

**Datei:** `client/src/i18n/locales/de.json`

```json
{
  "mobile": {
    "qr": {
      "mergeSessions": "Sessions zusammenführen",
      "advancedOptions": "Erweiterte Optionen",
      "joinAlone": "Nur ich wechseln",
      "inviteOther": "Anderen einladen"
    }
  },
  "status": {
    "sessionMerged": "Sessions wurden zusammengeführt",
    "mergeInProgress": "Merge läuft..."
  }
}
```

**Datei:** `client/src/i18n/locales/en.json`

```json
{
  "mobile": {
    "qr": {
      "mergeSessions": "Merge Sessions",
      "advancedOptions": "Advanced Options",
      "joinAlone": "Join Alone",
      "inviteOther": "Invite Other"
    }
  },
  "status": {
    "sessionMerged": "Sessions have been merged",
    "mergeInProgress": "Merge in progress..."
  }
}
```

### Phase 6: Feature-Flag

**Datei:** `client/src/config/features.js`

```javascript
export const FEATURE_FLAGS = {
  // ... bestehende Flags
  AUTO_ACCEPT_SESSION_MERGES: true,  // Automatisch Merge-Redirects akzeptieren
};
```

**Datei:** `server/config/features.js`

```javascript
module.exports = {
  FEATURE_FLAGS: {
    // ... bestehende Flags
    ENABLE_SESSION_MERGE: true,  // Session-Merge-Feature aktiviert
  },
};
```

### Phase 7: Merge-Bestätigungs-Modal (Optional)

**Neue Datei:** `client/src/components/MergeRequestModal.jsx`

```jsx
export function MergeRequestModal({ request, onAccept, onDecline }) {
  const { t } = useTranslation();

  if (!request) return null;

  return (
    <div className="modalOverlay">
      <div className="modalContent">
        <h3>{t("merge.title")}</h3>
        <p>
          {t("merge.description", {
            initiator: request.initiatorUuid?.slice(0, 8)
          })}
        </p>
        <div className="modalActions">
          <button onClick={onDecline} className="btn secondary">
            {t("merge.decline")}
          </button>
          <button onClick={onAccept} className="btn primary">
            {t("merge.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Edge Cases und Lösungen

### Edge Case 1: Offline-Geräte

**Problem:** Ein Gerät in der Quell-Session ist offline und erhält den `merge-redirect` nicht.

**Lösung:**
- Beim Reconnect prüft das Gerät, ob andere Peers noch in der Session sind
- Falls die Session leer ist, zeige Hinweis: "Session ist nicht mehr aktiv"
- Optional: Server speichert "Session wurde gemergt zu X" für späteren Abruf

### Edge Case 2: Gleichzeitige Merges

**Problem:** Zwei Geräte versuchen gleichzeitig einen Merge in verschiedene Richtungen.

**Lösung:**
- Server-seitig: Merge-Lock pro Session (5 Sekunden Cooldown)
- Erste Anfrage gewinnt, weitere erhalten Fehler "merge-in-progress"

```javascript
const mergeLocks = new Map();

function acquireMergeLock(sessionId) {
  const now = Date.now();
  const lock = mergeLocks.get(sessionId);

  if (lock && now - lock < 5000) {
    return false;  // Lock aktiv
  }

  mergeLocks.set(sessionId, now);
  return true;
}
```

### Edge Case 3: Zyklische Merges

**Problem:** Session A mergt zu B, während B zu A mergt.

**Lösung:**
- Bereits durch Merge-Lock abgedeckt
- Zusätzlich: Server prüft ob Ziel-Session gerade selbst einen Merge initiiert

### Edge Case 4: Große Sessions

**Problem:** Session mit 20+ Geräten - alle erhalten gleichzeitig `merge-redirect`.

**Lösung:**
- Gestaffelter Versand (10ms Delay zwischen Nachrichten)
- Rate-Limiting pro Session für Merge-Events

---

## Sicherheitsüberlegungen

### 1. Seed-Transport

Der Seed wird niemals im Klartext an den Server gesendet. Er ist im Hash-Fragment der URL (`#seed=...`) und wird nur Client-zu-Client via verschlüsseltem `session-offer` übertragen.

Bei `merge-redirect` wird der Seed ebenfalls verschlüsselt:
- Der Initiator hat den Seed bereits (aus QR-Code)
- Andere Peers erhalten ihn via verschlüsseltem `merge-redirect`

### 2. Replay-Schutz

Jeder `merge-redirect` enthält:
- `nonce` - Einmalige Zufallszahl
- `ts` - Timestamp

Server und Client prüfen:
- Nonce wurde nicht wiederverwendet
- Timestamp ist nicht älter als 5 Minuten

### 3. Rate-Limiting

Neue Limits für Merge-Operationen:
- Max 5 Merges pro IP pro Minute
- Max 10 Merges pro Session pro Minute
- Strikes bei Überschreitung → temporärer Ban

### 4. Validierung

Alle Eingaben werden validiert:
- `toSession` - Gültige Session-ID (Format-Check)
- `toSeed` - Gültiges Base64URL (Längen-Check)
- `initiatorUuid` - Gültige UUID

---

## Implementierungs-Reihenfolge

| # | Datei | Änderung | Priorität |
|---|-------|----------|-----------|
| 1 | `server/config/features.js` | Feature-Flag hinzufügen | Hoch |
| 2 | `server/middleware/rateLimiter.js` | `allowMerge` Funktion | Hoch |
| 3 | `server/server.js` | `session-merge` Handler | Hoch |
| 4 | `client/src/config/features.js` | Feature-Flag hinzufügen | Hoch |
| 5 | `client/src/hooks/useSessionSockets.js` | `sendSessionMerge` + Listener | Hoch |
| 6 | `client/src/App.jsx` | `onMergeRedirect` Callback | Hoch |
| 7 | `client/src/MobileApp.jsx` | UI-Vereinfachung | Mittel |
| 8 | `client/src/i18n/locales/*.json` | Übersetzungen | Mittel |
| 9 | `client/src/components/MergeRequestModal.jsx` | Optional: Modal | Niedrig |
| 10 | `server/session/sessionManager.js` | Status-Migration | Niedrig |

---

## Testplan

### Unit Tests

1. **Rate-Limiter Tests**
   - `allowMerge` erlaubt 5 Requests, blockiert 6.
   - Window reset nach 60 Sekunden

2. **Validation Tests**
   - Ungültige Session-IDs werden abgelehnt
   - Abgelaufene Timestamps werden abgelehnt

### Integration Tests

1. **Einfacher Merge (2 Geräte)**
   - Device A in Session 1
   - Device B in Session 2
   - B scannt A's QR → Merge
   - Beide in Session 1, gleicher Key

2. **Multi-Device Merge (4 Geräte)**
   - Session 1: [A, B]
   - Session 2: [C, D]
   - C scannt A's QR → Merge
   - Alle 4 in Session 1

3. **Offline-Gerät**
   - Session 1: [A, B-offline]
   - Session 2: [C]
   - C scannt A's QR → Merge
   - A und C in Session 1
   - B reconnected → sieht leere Session

4. **Gleichzeitige Merges**
   - A versucht Merge zu Session X
   - B versucht Merge zu Session Y (gleichzeitig)
   - Nur einer sollte durchgehen

### E2E Tests

1. Vollständiger Flow auf echten Geräten
2. QR-Scan → Dialog → Merge → Verifizierung
3. Foto-Transfer nach Merge funktioniert

---

## Zukünftige Erweiterung: Session-History (Phase 8+)

### Motivation

Das aktuelle Design hat eine Schwäche: Wenn ein Gerät offline ist während ein Merge stattfindet, erhält es den `merge-redirect` nicht und bleibt in der alten (nun leeren) Session zurück.

**Lösung:** Eine client-seitige Session-History, die alle besuchten Sessions mit ihren Credentials speichert.

### Konzept: Session-History

Jedes Gerät führt lokal eine Liste aller Sessions, in denen es war:

```javascript
// Gespeichert in localStorage/IndexedDB
const sessionHistory = [
  {
    sessionId: "abc123...",
    seed: "base64seed...",
    offerSecret: "base64secret...",
    joinedAt: 1704067200000,
    leftAt: 1704070800000,        // null wenn noch aktiv
    mergedTo: "xyz789...",        // null wenn nicht gemergt
    deviceName: "Desktop-A",      // Wer hat diese Session erstellt
  },
  {
    sessionId: "xyz789...",
    seed: "newseed...",
    offerSecret: "newsecret...",
    joinedAt: 1704070800000,
    leftAt: null,
    mergedTo: null,
    deviceName: "Mobile-B",
  }
];
```

### Anwendungsfälle

#### 1. Offline-Gerät kommt zurück

```
Szenario:
- Device B war in Session "old123" mit Device A
- Device A merged zu Session "new456" (B war offline)
- Device B kommt online, joint "old123" → leer

Mit Session-History:
1. B joint "old123" → Server antwortet "session-info"
2. Server: "Diese Session wurde zu 'new456' gemergt"
3. B schaut in History: Hat B Credentials für "new456"?
   - Ja → Auto-switch zu "new456"
   - Nein → Zeige: "Session wurde gemergt. QR scannen für neue Session"
```

#### 2. Mehrfache Merges nachverfolgen

```
Session-Kette: A → B → C → D

Device X war in Session A, ging offline.
Kommt zurück:
1. Server: "A wurde zu B gemergt"
2. Client fragt: "B wurde zu C gemergt"
3. Client fragt: "C wurde zu D gemergt"
4. Client: "D ist aktiv" → Switch zu D
```

#### 3. Session wiederherstellen nach Browser-Refresh

Aktuell: Session-ID in URL, Seed im Hash-Fragment (geht verloren bei manchen Redirects)

Mit History:
- Seed wird lokal gespeichert
- Bei Refresh: Lade Seed aus History für aktuelle Session-ID

### Implementierung (Später)

#### Client-seitig: Session-History Store

**Neue Datei:** `client/src/utils/sessionHistory.js`

```javascript
const STORAGE_KEY = "filebeacon-session-history";
const MAX_HISTORY_SIZE = 50;  // Älteste Einträge rotieren

export function getSessionHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addSessionToHistory(entry) {
  const history = getSessionHistory();

  // Duplikat-Check
  const existing = history.findIndex(h => h.sessionId === entry.sessionId);
  if (existing !== -1) {
    // Update existierenden Eintrag
    history[existing] = { ...history[existing], ...entry };
  } else {
    history.unshift(entry);
  }

  // Rotation: Behalte nur die neuesten MAX_HISTORY_SIZE
  const trimmed = history.slice(0, MAX_HISTORY_SIZE);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function markSessionMerged(fromSessionId, toSessionId) {
  const history = getSessionHistory();
  const entry = history.find(h => h.sessionId === fromSessionId);
  if (entry) {
    entry.mergedTo = toSessionId;
    entry.leftAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }
}

export function findCredentialsForSession(sessionId) {
  const history = getSessionHistory();
  return history.find(h => h.sessionId === sessionId);
}

export function followMergeChain(startSessionId) {
  const history = getSessionHistory();
  let current = startSessionId;
  const visited = new Set();

  while (current && !visited.has(current)) {
    visited.add(current);
    const entry = history.find(h => h.sessionId === current);
    if (!entry?.mergedTo) break;
    current = entry.mergedTo;
  }

  return current;  // Die finale Session in der Kette
}
```

#### Server-seitig: Merge-History

**Erweiterung in:** `server/session/sessionManager.js`

```javascript
// Speichert wohin Sessions gemergt wurden
const mergeHistory = new Map();  // sessionId → targetSessionId

function recordMerge(fromSession, toSession) {
  mergeHistory.set(fromSession, {
    to: toSession,
    at: Date.now(),
  });
}

function getMergeTarget(sessionId) {
  return mergeHistory.get(sessionId)?.to || null;
}

// Cleanup: Alte Merge-Records nach 24h löschen
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [sid, record] of mergeHistory) {
    if (record.at < cutoff) {
      mergeHistory.delete(sid);
    }
  }
}, 60 * 60 * 1000);  // Stündlich
```

#### Neues Event: `session-info`

Wenn ein Client eine Session joint, sendet der Server Info über den Session-Status:

```javascript
// Server
socket.on("join-session", ({ sessionId, ... }) => {
  // ... existing logic ...

  // Prüfe ob Session gemergt wurde
  const mergeTarget = getMergeTarget(sessionId);
  if (mergeTarget) {
    socket.emit("session-info", {
      status: "merged",
      mergedTo: mergeTarget,
    });
  }
});

// Client
socket.on("session-info", ({ status, mergedTo }) => {
  if (status === "merged" && mergedTo) {
    // Prüfe ob wir Credentials für Ziel-Session haben
    const creds = findCredentialsForSession(mergedTo);
    if (creds) {
      // Auto-switch zur neuen Session
      applyQrOffer({
        session: mergedTo,
        seed: creds.seed,
        offerSecret: creds.offerSecret,
      });
    } else {
      // Zeige Info-Modal
      setSessionMergedInfo({ targetSession: mergedTo });
    }
  }
});
```

### Sicherheitsüberlegungen für Session-History

1. **Lokale Speicherung**
   - Seeds werden nur lokal gespeichert (localStorage/IndexedDB)
   - Niemals an Server gesendet
   - Bei "Clear Site Data" werden sie gelöscht

2. **Rotation**
   - Maximal 50 Sessions in History
   - Älteste werden automatisch entfernt
   - Reduziert Risiko bei Device-Kompromittierung

3. **Keine Cross-Device Sync**
   - History ist device-lokal
   - Kein Cloud-Backup der Seeds
   - Jedes Gerät hat eigene History

4. **Optional: Encryption at Rest**
   - History könnte mit device-spezifischem Key verschlüsselt werden
   - Erhöht Komplexität, für MVP nicht nötig

### Implementierungs-Reihenfolge (Phase 8+)

| # | Komponente | Beschreibung | Abhängigkeit |
|---|------------|--------------|--------------|
| 8.1 | `sessionHistory.js` | Client-seitiger History-Store | - |
| 8.2 | `sessionManager.js` | Server-seitige Merge-History | - |
| 8.3 | `useSessionSockets.js` | History bei Session-Wechsel aktualisieren | 8.1 |
| 8.4 | `server.js` | `session-info` Event bei Join | 8.2 |
| 8.5 | `App.jsx` | `session-info` Handler + Auto-Follow | 8.1, 8.4 |
| 8.6 | UI | Info-Modal wenn Credentials fehlen | 8.5 |

### Vorteile der Session-History

1. **Offline-Resilience** - Geräte finden nach Offline-Phase zurück
2. **Seed-Persistenz** - Kein Seed-Verlust bei Browser-Refresh
3. **Audit-Trail** - User sieht welche Sessions er besucht hat
4. **Multi-Merge Support** - Folge der Merge-Kette automatisch
5. **Recovery** - Bei Problemen kann auf frühere Session zurückgewechselt werden

### Risiken und Mitigationen

| Risiko | Mitigation |
|--------|------------|
| LocalStorage voll | Rotation auf 50 Einträge |
| Seeds im Klartext lokal | Akzeptables Risiko; Alternative: WebCrypto für Encryption at Rest |
| Merge-Chain zu lang | Limit auf 10 Hops, danach Abbruch |
| Server-Memory für Merge-History | 24h TTL + Cleanup-Job |

---

## Offene Fragen

1. **Soll "Send Own Session" komplett entfernt werden?**
   - Pro: Weniger Verwirrung
   - Contra: Power-User möchten vielleicht die Kontrolle

2. **Merge-Bestätigung auf Desktop?**
   - Soll der Desktop-User benachrichtigt werden, wenn ein Mobile den Merge initiiert?
   - Oder ist Auto-Accept ausreichend?

3. **Session-Cleanup?**
   - Soll eine leere Session nach Merge automatisch gelöscht werden?
   - Oder für potentielle Reconnects aufbewahren?

4. **Session-History Encryption?**
   - Sollen die lokal gespeicherten Seeds zusätzlich verschlüsselt werden?
   - Trade-off: Mehr Sicherheit vs. Komplexität (Key-Management)
