/**
 * Network Configuration
 * Centralized network detection and IP range configuration
 */

/**
 * Private IP address ranges for local network detection
 * Includes localhost, local domains, and RFC 1918 private ranges
 */
export const PRIVATE_IP_PATTERNS = [
  "localhost",
  "127.0.0.1",
  ".local",     // mDNS local domains
  "192.168.",   // Class C private
  "10.",        // Class A private
  "172.16.",    // Class B private (172.16.0.0 - 172.31.255.255)
  "172.17.",
  "172.18.",
  "172.19.",
  "172.2",      // Covers 172.20.x.x - 172.29.x.x
  "172.3",      // Covers 172.30.x.x - 172.31.x.x
];

/**
 * Check if a hostname is on the local network
 * @param {string} hostname - The hostname to check
 * @returns {boolean} True if the hostname is on a local/private network
 */
export function isLocalNetwork(hostname) {
  if (!hostname) return false;

  return PRIVATE_IP_PATTERNS.some(
    (pattern) =>
      hostname === pattern ||
      hostname.endsWith(pattern) ||
      hostname.startsWith(pattern)
  );
}
