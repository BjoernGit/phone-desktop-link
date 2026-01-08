/**
 * Feature Flags Configuration (Server)
 * Centralized control for optional features and security behaviors
 *
 * These flags allow you to enable/disable features without deleting code.
 * Future: Can be moved to user config or paid plan features
 */

const FEATURE_FLAGS = {
  /**
   * Require manual approval for devices joining a session
   * When false: devices automatically join without approval prompt
   * When true: desktop users must approve each device (more secure)
   */
  REQUIRE_DEVICE_APPROVAL: false,
};

module.exports = { FEATURE_FLAGS };
