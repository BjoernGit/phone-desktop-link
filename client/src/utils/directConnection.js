/**
 * Direct Connection Boost
 *
 * Browsers hide local IP addresses behind mDNS hostnames (xxxx.local) in
 * WebRTC ICE candidates unless the origin has camera or microphone
 * permission. On networks that don't forward multicast DNS between devices
 * (mesh WiFi systems, some access points), peers can't resolve each other's
 * mDNS names, so direct P2P fails even though the devices could reach each
 * other via their real IPs.
 *
 * Requesting (and immediately releasing) the camera unmasks the real local
 * IP in ICE candidates. One unmasked side is enough: the hidden peer sends
 * connectivity checks to the visible address and the reverse path is
 * learned via peer-reflexive candidates.
 */
export async function requestDirectConnectionBoost() {
  if (!navigator.mediaDevices?.getUserMedia) return false;

  // Camera first (matches the product), microphone as fallback for
  // desktops without a webcam - either permission unmasks host candidates.
  for (const constraints of [{ video: true }, { audio: true }]) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      // User denied - don't immediately prompt again for the other device
      if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
        return false;
      }
      // NotFoundError etc. (no such device) - try the next constraint set
    }
  }
  return false;
}
