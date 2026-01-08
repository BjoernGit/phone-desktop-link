# Feature Flags Documentation

This document describes the temporary feature flags that control security and workflow behaviors in the application. These features are currently **disabled** to simplify the user experience during development, but the code is preserved for future re-enablement.

## Purpose

These flags allow us to toggle features without deleting code. In the future, these can be:
- Moved to user configuration settings
- Offered as premium/paid features
- Re-enabled when multi-user security becomes a priority

## Configuration Files

### Client-side
**Location:** `client/src/config/features.js`

### Server-side
**Location:** `server/config/features.js`

---

## Available Feature Flags

### 1. `REQUIRE_DEVICE_APPROVAL`

**Current Value:** `false` (disabled)

**What it does:**
- When `true`: Desktop users must manually approve each device that wants to join the session
- When `false`: All devices are automatically approved and can join immediately (current behavior)

**Implementation Details:**

**Server:** `server/server.js` (lines ~104-120)
```javascript
const shouldAutoApprove = !state.approved.size || !FEATURE_FLAGS.REQUIRE_DEVICE_APPROVAL;

if (shouldAutoApprove) {
  state.approved.add(clientUuid);
  // ...auto-approve logic
} else {
  state.pending.add(clientUuid);
  // ...requires manual approval
}
```

**Client UI:** `client/src/components/PeerPanel.jsx` (line ~30)
- Conditionally shows/hides approval buttons (Approve/Reject)
- When disabled, buttons never appear

**Mobile UI:** `client/src/MobileApp.jsx` (lines ~79-88)
```javascript
{FEATURE_FLAGS.REQUIRE_DEVICE_APPROVAL && isWaitingForApproval && (
  <div className="waitingForApprovalBanner">
    <span className="waitingIcon">⏳</span>
    {t("mobile.waitingForApproval", "Warte auf Freigabe...")}
  </div>
)}

{FEATURE_FLAGS.REQUIRE_DEVICE_APPROVAL && (
  <PendingApprovals pending={pendingPeers} onApprove={approvePeer} onReject={rejectPeer} />
)}
```

**Related UI:**
- "Waiting for approval" banner on mobile (`MobileApp.jsx` line ~79)
- Pending approvals component on mobile (`MobileApp.jsx` line ~86)
- Approve/Reject buttons in PeerPanel (desktop)
- Pending peer status indicators

---

### 2. `AUTO_HIDE_QR_CODE`

**Current Value:** `false` (disabled)

**What it does:**
- When `true`: QR codes automatically hide after 30 seconds for security
- When `false`: QR codes remain visible at all times (current behavior)

**Implementation Details:**

**Mobile Component:** `client/src/components/MobileQrDisplay.jsx` (lines ~11-28)
```javascript
useEffect(() => {
  // Auto-hide QR code after 30 seconds (only if feature enabled)
  if (!FEATURE_FLAGS.AUTO_HIDE_QR_CODE) return;

  const timer = setTimeout(() => {
    setQrVisible(false);
  }, QR_AUTO_HIDE_MS);

  return () => clearTimeout(timer);
}, []);
```

**Desktop Component:** `client/src/components/QrPanel.jsx` (lines ~13-22)
```javascript
useEffect(() => {
  // Auto-hide QR code after 30 seconds (only if feature enabled)
  if (!FEATURE_FLAGS.AUTO_HIDE_QR_CODE) return;

  const timer = setTimeout(() => {
    setQrVisible(false);
  }, QR_AUTO_HIDE_MS);

  return () => clearTimeout(timer);
}, []);
```

**Related UI:**
- "Show QR Code" button (appears when QR is hidden)
- "Hidden for security" message
- 30-second auto-hide timer

---

### 3. `MANUAL_FILE_SYNC`

**Current Value:** `false` (disabled)

**What it does:**
- When `true`: Desktop users must manually click "Sync Files" button to share file metadata with late joiners
- When `false`: File metadata automatically syncs to all approved peers (current behavior)

**Implementation Details:**

**Auto-sync Logic:** `client/src/App.jsx` (lines ~216-234)
```javascript
useEffect(() => {
  if (FEATURE_FLAGS.MANUAL_FILE_SYNC || isMobile || !syncFilesToPeer) return;

  const approvedPeers = Object.entries(peerStatuses)
    .filter(([_, status]) => status === "approved")
    .map(([uuid]) => uuid);

  approvedPeers.forEach((peerUuid) => {
    if (peer && sharedFiles.length > 0) {
      syncFilesToPeer(peerUuid).catch(/* ... */);
    }
  });
}, [peerStatuses, syncFilesToPeer, isMobile, peers, sharedFiles.length]);
```

**UI Control:** `client/src/components/PeerPanel.jsx` (line ~31)
- Conditionally shows/hides "Sync Files" button for recently approved peers
- When disabled, button never appears

**Related Behavior:**
- `approvePeer()` in `App.jsx` only adds to `recentlyApprovedPeers` when manual sync is enabled
- Auto-sync triggers on peer approval when flag is disabled

---

## Important Notes

### File Sync vs File Transfer
⚠️ **Note:** File sync only broadcasts **metadata** (filename, size, type, owner). It does NOT trigger automatic downloads. Late joiners still need to manually click download for each file they want.

### Photos vs Files
Photos (data URLs) are always automatically shared with all peers in the session. The `MANUAL_FILE_SYNC` flag only affects file metadata broadcasting, not photo sharing.

---

## How to Re-enable Features

### Option 1: Change Flag Values
Edit the flag values in the configuration files:

```javascript
// client/src/config/features.js
export const FEATURE_FLAGS = {
  REQUIRE_DEVICE_APPROVAL: true,  // Enable manual approval
  AUTO_HIDE_QR_CODE: true,        // Enable QR auto-hiding
  MANUAL_FILE_SYNC: true,         // Enable manual file sync
};
```

```javascript
// server/config/features.js
export const FEATURE_FLAGS = {
  REQUIRE_DEVICE_APPROVAL: true,  // Enable manual approval
};
```

### Option 2: Future User Configuration
When implementing user settings:

1. Create user preferences storage (localStorage, database, etc.)
2. Replace hardcoded flag values with user preference lookups
3. Add UI controls in settings panel
4. Optionally gate features behind paid plans

---

## Testing Checklist

When re-enabling features, test these scenarios:

### REQUIRE_DEVICE_APPROVAL = true
- [ ] First device auto-approves
- [ ] Second device shows "Waiting for approval" on mobile
- [ ] Desktop shows Approve/Reject buttons
- [ ] Approve button adds device to session
- [ ] Reject button disconnects device

### AUTO_HIDE_QR_CODE = true
- [ ] QR code visible on initial load
- [ ] QR code hides after 30 seconds
- [ ] "Show QR Code" button appears
- [ ] Clicking button shows QR again
- [ ] QR auto-hides again after 30 seconds

### MANUAL_FILE_SYNC = true
- [ ] Late joiner doesn't see existing files initially
- [ ] "Sync Files" button appears for recently approved peers
- [ ] Clicking button broadcasts file metadata
- [ ] Late joiner can now see and download files
- [ ] Button disappears after successful sync

---

## Security Considerations

### Why These Features Exist
1. **Device Approval:** Prevents unauthorized devices from joining your session
2. **QR Auto-Hide:** Prevents shoulder-surfing attacks in public spaces
3. **Manual File Sync:** Gives explicit control over what content late joiners can access

### Risk of Keeping Disabled
- Anyone with the QR code can join your session
- QR codes remain visible and scannable indefinitely
- Late joiners automatically receive all file metadata

### Recommended for Production
Enable all three flags when:
- Application is public-facing
- Users handle sensitive content
- Multi-user security is important

---

## Current Flag Status

All flags are currently set to `false` (disabled):

✅ **REQUIRE_DEVICE_APPROVAL = false**
- All devices auto-approve instantly
- No approval UI shown anywhere (desktop or mobile)
- Photos and files immediately shared with all peers

✅ **AUTO_HIDE_QR_CODE = false**
- QR codes always visible
- No auto-hide behavior

✅ **MANUAL_FILE_SYNC = false**
- File metadata auto-syncs to all approved peers
- No manual sync button needed

---

## Related Files

### Configuration
- `client/src/config/features.js` - Client feature flags
- `server/config/features.js` - Server feature flags

### Server Logic
- `server/server.js` - Peer approval logic (lines ~104-120)

### Client Components
- `client/src/App.jsx` - Main app logic, auto-sync (lines ~216-234)
- `client/src/components/PeerPanel.jsx` - Desktop peer approval UI (lines ~30-31)
- `client/src/components/MobileQrDisplay.jsx` - Mobile QR auto-hide logic (lines ~11-28, ~37)
- `client/src/components/QrPanel.jsx` - Desktop QR auto-hide logic (lines ~13-22, ~35)
- `client/src/MobileApp.jsx` - Mobile approval UI (lines ~79-88)
- `client/src/components/PendingApprovals.jsx` - Mobile approval buttons component

### Hooks
- `client/src/hooks/useSessionSockets.js` - Socket communication, peer-status events
- `client/src/hooks/useAppFileTransfer.js` - File sync logic, syncFilesToPeer function

---

*Last Updated: 2026-01-08*
