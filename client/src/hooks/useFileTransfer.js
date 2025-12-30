import { useState, useCallback, useRef } from "react";
import { useFileSender } from "./useFileSender";
import { useFileReceiver } from "./useFileReceiver";

/**
 * File Transfer Hook for sending/receiving files via WebRTC DataChannel
 * Composes useFileSender and useFileReceiver for a unified API
 */
export function useFileTransfer() {
  const [transfers, setTransfers] = useState(new Map());

  // Shared refs for transfer state
  const transfersRef = useRef(new Map());
  const receiveBuffersRef = useRef(new Map());
  const transferTimeoutsRef = useRef(new Map());
  const cleanupTimeoutsRef = useRef(new Map());

  // Update transfers state from ref
  const updateTransfers = useCallback(() => {
    setTransfers(new Map(transfersRef.current));
  }, []);

  // Sender hook
  const { sendFile } = useFileSender({
    transfersRef,
    updateTransfers,
    transferTimeoutsRef,
    cleanupTimeoutsRef,
  });

  // Receiver hook
  const { createMessageHandler, setupReceiver } = useFileReceiver({
    transfersRef,
    updateTransfers,
    receiveBuffersRef,
    transferTimeoutsRef,
    cleanupTimeoutsRef,
  });

  // Clear transfer from state
  const clearTransfer = useCallback((transferId) => {
    transfersRef.current.delete(transferId);
    setTransfers(new Map(transfersRef.current));
    receiveBuffersRef.current.delete(transferId);

    const timeoutHandle = transferTimeoutsRef.current.get(transferId);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      transferTimeoutsRef.current.delete(transferId);
    }

    const cleanupHandle = cleanupTimeoutsRef.current.get(transferId);
    if (cleanupHandle) {
      clearTimeout(cleanupHandle);
      cleanupTimeoutsRef.current.delete(transferId);
    }
  }, []);

  // Clear all completed/failed transfers (manual cleanup)
  const clearCompletedTransfers = useCallback(() => {
    const toDelete = [];
    for (const [transferId, transfer] of transfersRef.current.entries()) {
      if (
        transfer.status === "completed" ||
        transfer.status === "failed" ||
        transfer.status === "timeout"
      ) {
        toDelete.push(transferId);
      }
    }
    for (const transferId of toDelete) {
      clearTransfer(transferId);
    }
  }, [clearTransfer]);

  return {
    transfers,
    sendFile,
    setupReceiver,
    createMessageHandler,
    clearTransfer,
    clearCompletedTransfers,
  };
}
