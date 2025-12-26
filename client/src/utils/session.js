export function getSessionIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("session");
}

export function ensureDesktopSessionId() {
  const params = new URLSearchParams(window.location.search);
  let sessionId = params.get("session");

  if (!sessionId) {
    sessionId = (crypto.randomUUID?.() ?? `sess_${Date.now().toString(16)}`).replace(/-/g, "").slice(0, 16);
    params.set("session", sessionId);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", newUrl);
  }

  return sessionId;
}

export function isMobileDevice() {
  return (
    (navigator.userAgentData && navigator.userAgentData.mobile) ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}
