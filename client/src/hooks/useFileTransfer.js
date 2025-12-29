import { useState, useCallback, useRef } from "react";

const CHUNK_SIZE = 16384; // 16 KB (recommended for WebRTC)

/**
 * File Transfer Hook for sending/receiving files via WebRTC DataChannel
 */
export function useFileTransfer() {
  const [transfers, setTransfers] = useState(new Map()); // transferId -> transfer state
  const transfersRef = useRef(new Map());
  const receiveBuffersRef = useRef(new Map()); // transferId -> chunks array

  // Generate unique transfer ID
  const generateTransferId = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  // Send file through data channel
  const sendFile = useCallback(async (file, dataChannel, peerUuid, onProgress) => {
    if (!dataChannel || dataChannel.readyState !== "open") {
      throw new Error("Data channel is not open");
    }

    const transferId = generateTransferId();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // Send file metadata first
    const metadata = {
      type: "file-start",
      transferId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      totalChunks,
    };
    dataChannel.send(JSON.stringify(metadata));

    // Initialize transfer state
    const transferState = {
      transferId,
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      sentChunks: 0,
      progress: 0,
      status: "sending",
    };
    transfersRef.current.set(transferId, transferState);
    setTransfers(new Map(transfersRef.current));

    // Send file in chunks
    let offset = 0;
    let chunkIndex = 0;

    const sendNextChunk = async () => {
      if (offset >= file.size) {
        // Transfer complete
        const completeMsg = {
          type: "file-complete",
          transferId,
        };
        dataChannel.send(JSON.stringify(completeMsg));

        transferState.status = "completed";
        transferState.progress = 100;
        transfersRef.current.set(transferId, transferState);
        setTransfers(new Map(transfersRef.current));

        if (onProgress) onProgress(transferState);
        return;
      }

      const chunk = file.slice(offset, offset + CHUNK_SIZE);
      const arrayBuffer = await chunk.arrayBuffer();

      // Send chunk header
      const header = {
        type: "file-chunk",
        transferId,
        chunkIndex,
      };
      dataChannel.send(JSON.stringify(header));

      // Send chunk data
      dataChannel.send(arrayBuffer);

      offset += CHUNK_SIZE;
      chunkIndex++;

      // Update progress
      transferState.sentChunks = chunkIndex;
      transferState.progress = Math.round((offset / file.size) * 100);
      transfersRef.current.set(transferId, transferState);
      setTransfers(new Map(transfersRef.current));

      if (onProgress) onProgress(transferState);

      // Schedule next chunk (avoid overwhelming the channel)
      setTimeout(sendNextChunk, 0);
    };

    await sendNextChunk();
    return transferId;
  }, []);

  // Setup data channel for receiving files
  const setupReceiver = useCallback((dataChannel, onFileReceived) => {
    let currentTransfer = null;
    let receivedChunks = [];

    dataChannel.onmessage = async (event) => {
      if (typeof event.data === "string") {
        // Control message
        const msg = JSON.parse(event.data);

        if (msg.type === "file-start") {
          // New file transfer starting
          currentTransfer = {
            transferId: msg.transferId,
            fileName: msg.fileName,
            fileSize: msg.fileSize,
            fileType: msg.fileType,
            totalChunks: msg.totalChunks,
            receivedChunks: 0,
            progress: 0,
            status: "receiving",
          };
          receivedChunks = [];
          receiveBuffersRef.current.set(msg.transferId, receivedChunks);

          transfersRef.current.set(msg.transferId, currentTransfer);
          setTransfers(new Map(transfersRef.current));
        } else if (msg.type === "file-chunk") {
          // Chunk header received, next message will be the data
          // Nothing to do here, just wait for the data
        } else if (msg.type === "file-complete") {
          // File transfer complete, assemble the file
          if (currentTransfer && currentTransfer.transferId === msg.transferId) {
            const chunks = receiveBuffersRef.current.get(msg.transferId) || [];
            const blob = new Blob(chunks, { type: currentTransfer.fileType });

            currentTransfer.status = "completed";
            currentTransfer.progress = 100;
            transfersRef.current.set(msg.transferId, currentTransfer);
            setTransfers(new Map(transfersRef.current));

            if (onFileReceived) {
              onFileReceived({
                fileName: currentTransfer.fileName,
                blob,
                transferId: currentTransfer.transferId,
              });
            }

            receiveBuffersRef.current.delete(msg.transferId);
            receivedChunks = [];
            currentTransfer = null;
          }
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Chunk data received
        if (currentTransfer) {
          receivedChunks.push(event.data);
          currentTransfer.receivedChunks = receivedChunks.length;
          currentTransfer.progress = Math.round(
            (receivedChunks.length / currentTransfer.totalChunks) * 100
          );

          transfersRef.current.set(currentTransfer.transferId, currentTransfer);
          setTransfers(new Map(transfersRef.current));
        }
      }
    };
  }, []);

  // Clear transfer from state
  const clearTransfer = useCallback((transferId) => {
    transfersRef.current.delete(transferId);
    setTransfers(new Map(transfersRef.current));
    receiveBuffersRef.current.delete(transferId);
  }, []);

  return {
    transfers,
    sendFile,
    setupReceiver,
    clearTransfer,
  };
}
