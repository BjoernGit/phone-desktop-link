import { isMobileDevice } from "./session";

const DEVICE_ID_KEY = "filebeacon-device-id";

export function getOrCreateDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12);
    localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}

export function getDeviceType() {
  return isMobileDevice() ? "mobile" : "desktop";
}
