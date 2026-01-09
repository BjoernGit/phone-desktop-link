/**
 * Feature Flags Configuration
 * Centralized control for optional features and security behaviors
 *
 * These flags allow you to enable/disable features without deleting code.
 * Future: Can be moved to user config or paid plan features
 */

export const FEATURE_FLAGS = {
  /**
   * Require manual approval for devices joining a session
   * When false: devices automatically join without approval prompt
   * When true: desktop users must approve each device (more secure)
   */
  REQUIRE_DEVICE_APPROVAL: false,

  /**
   * Hide QR codes after initial display for security
   * When false: QR code always visible
   * When true: QR code auto-hides and requires button click to show
   */
  AUTO_HIDE_QR_CODE: false,

  /**
   * Show "sync files" button for late joiners
   * When false: file metadata automatically syncs to all peers
   * When true: requires manual sync button click (more control)
   */
  MANUAL_FILE_SYNC: false,

  /**
   * Automatically accept incoming session offers
   * When false: incoming offers require manual accept/decline
   * When true: session offers are automatically accepted (convenience)
   */
  AUTO_ACCEPT_SESSION_OFFERS: true,

  /**
   * Automatically accept session merge redirects
   * When false: merge redirects require manual accept/decline
   * When true: merge redirects are automatically accepted (convenience)
   * This applies when another device in your session initiates a merge
   */
  AUTO_ACCEPT_SESSION_MERGES: true,
};
