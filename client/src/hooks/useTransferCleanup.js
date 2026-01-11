import { useEffect } from "react";
import { deleteOldTransfers } from "../utils/transferDB";

/**
 * Hook to clean up old/abandoned transfers from IndexedDB
 * Runs on mount and periodically to free up disk space
 *
 * Abandoned transfers can happen when:
 * - Browser crashes during transfer
 * - User closes tab mid-transfer
 * - Network errors cause incomplete transfers
 */
export function useTransferCleanup() {
  useEffect(() => {
    const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
    const MAX_TRANSFER_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

    const runCleanup = async () => {
      const cutoffTime = Date.now() - MAX_TRANSFER_AGE_MS;
      try {
        const deletedCount = await deleteOldTransfers(cutoffTime);
        if (deletedCount > 0) {
          console.log(`[TransferCleanup] Cleaned up ${deletedCount} old transfer(s)`);
        }
      } catch (error) {
        console.error("[TransferCleanup] Failed to clean up old transfers:", error);
      }
    };

    // Run cleanup on mount
    runCleanup();

    // Schedule periodic cleanup
    const intervalId = setInterval(runCleanup, CLEANUP_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, []);
}
