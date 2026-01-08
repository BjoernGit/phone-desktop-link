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
};
