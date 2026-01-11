/**
 * IndexedDB wrapper for file transfer chunk storage
 * Replaces RAM-based Map storage to prevent memory issues on mobile devices
 */

const DB_NAME = "FileBeaconTransfers";
const DB_VERSION = 1;
const CHUNKS_STORE = "chunks";
const METADATA_STORE = "metadata";

// Keep a single DB connection open for performance
let dbInstance = null;
let dbPromise = null;

/**
 * Open or create the IndexedDB database
 * Reuses existing connection if available
 * @returns {Promise<IDBDatabase>}
 */
export function openTransferDB() {
  // Return existing instance if available
  if (dbInstance && !dbInstance.oldVersion) {
    return Promise.resolve(dbInstance);
  }

  // Return pending promise if already opening
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("[TransferDB] Failed to open database:", request.error);
      dbPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbPromise = null;

      // Handle database close/error events
      dbInstance.onclose = () => {
        console.log("[TransferDB] Database connection closed");
        dbInstance = null;
      };
      dbInstance.onerror = (event) => {
        console.error("[TransferDB] Database error:", event.target.error);
      };

      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Chunks store: stores individual chunks for ongoing transfers
      // Key: [transferId, chunkIndex]
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const chunksStore = db.createObjectStore(CHUNKS_STORE, {
          keyPath: ["transferId", "chunkIndex"],
        });
        chunksStore.createIndex("transferId", "transferId", { unique: false });
      }

      // Metadata store: stores transfer metadata (fileName, fileSize, etc.)
      // Key: transferId
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE, { keyPath: "transferId" });
      }

      console.log("[TransferDB] Database initialized");
    };
  });

  return dbPromise;
}

/**
 * Store a chunk in IndexedDB
 * Each call creates its own transaction (IndexedDB best practice for streaming)
 * Using "relaxed" durability for better performance on Chrome
 *
 * @param {string} transferId - Unique transfer identifier
 * @param {number} chunkIndex - Index of this chunk
 * @param {ArrayBuffer} data - Chunk data
 * @returns {Promise<void>}
 */
export async function storeChunk(transferId, chunkIndex, data) {
  const db = await openTransferDB();

  return new Promise((resolve, reject) => {
    // Create a fresh transaction for each chunk
    // Use "relaxed" durability for better performance (Chrome specific)
    const transactionOptions = { durability: "relaxed" };
    let transaction;

    try {
      transaction = db.transaction([CHUNKS_STORE], "readwrite", transactionOptions);
    } catch (e) {
      // Fallback for browsers that don't support durability option
      transaction = db.transaction([CHUNKS_STORE], "readwrite");
    }

    const store = transaction.objectStore(CHUNKS_STORE);

    const request = store.put({
      transferId,
      chunkIndex,
      data,
      timestamp: Date.now(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error(`[TransferDB] Failed to store chunk ${chunkIndex}:`, request.error);
      reject(request.error);
    };

    transaction.onerror = () => {
      console.error(`[TransferDB] Transaction error for chunk ${chunkIndex}:`, transaction.error);
      reject(transaction.error);
    };
  });
}

/**
 * Get all chunks for a transfer, sorted by chunkIndex
 * WARNING: This loads ALL chunks into RAM at once - only use for small files!
 * For large files, use assembleChunksToBlob() instead.
 * @param {string} transferId - Unique transfer identifier
 * @returns {Promise<ArrayBuffer[]>} Array of chunk data in correct order
 */
export async function getAllChunks(transferId) {
  const db = await openTransferDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHUNKS_STORE], "readonly");
    const store = transaction.objectStore(CHUNKS_STORE);
    const index = store.index("transferId");

    const request = index.getAll(IDBKeyRange.only(transferId));

    request.onsuccess = () => {
      const chunks = request.result;
      // Sort by chunkIndex to ensure correct order
      chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      resolve(chunks.map((chunk) => chunk.data));
    };

    request.onerror = () => {
      console.error(`[TransferDB] Failed to get chunks for ${transferId}:`, request.error);
      reject(request.error);
    };

    // Don't close DB - keep connection open for performance
  });
}

/**
 * Assemble chunks into a Blob by streaming from IndexedDB in batches
 * This is memory-efficient for large files - only keeps one batch in RAM at a time
 * @param {string} transferId - Unique transfer identifier
 * @param {number} totalChunks - Total number of chunks expected
 * @param {string} mimeType - MIME type for the resulting Blob
 * @param {number} batchSize - Number of chunks to load per batch (default: 500 = ~8MB)
 * @returns {Promise<Blob>} The assembled file as a Blob
 */
export async function assembleChunksToBlob(transferId, totalChunks, mimeType, batchSize = 500) {
  const db = await openTransferDB();
  const blobParts = [];

  // Process chunks in batches to limit RAM usage
  for (let startIndex = 0; startIndex < totalChunks; startIndex += batchSize) {
    const endIndex = Math.min(startIndex + batchSize, totalChunks);

    // Load this batch of chunks
    const batchChunks = await new Promise((resolve, reject) => {
      const transaction = db.transaction([CHUNKS_STORE], "readonly");
      const store = transaction.objectStore(CHUNKS_STORE);
      const chunks = [];

      // Get chunks one by one by their key (transferId, chunkIndex)
      let pending = endIndex - startIndex;
      let hasError = false;

      for (let i = startIndex; i < endIndex; i++) {
        const request = store.get([transferId, i]);

        request.onsuccess = () => {
          if (hasError) return;

          if (request.result) {
            chunks.push({ index: i, data: request.result.data });
          } else {
            hasError = true;
            reject(new Error(`Missing chunk ${i} for transfer ${transferId}`));
            return;
          }

          pending--;
          if (pending === 0) {
            // Sort by index and extract data
            chunks.sort((a, b) => a.index - b.index);
            resolve(chunks.map((c) => c.data));
          }
        };

        request.onerror = () => {
          if (hasError) return;
          hasError = true;
          reject(request.error);
        };
      }
    });

    // Create intermediate Blob from this batch to release ArrayBuffer references
    const batchBlob = new Blob(batchChunks, { type: "application/octet-stream" });
    blobParts.push(batchBlob);

    // Log progress for large files
    if (totalChunks > 1000) {
      console.log(`[TransferDB] Assembled chunks ${startIndex}-${endIndex - 1} of ${totalChunks}`);
    }
  }

  // Combine all batch Blobs into final Blob
  return new Blob(blobParts, { type: mimeType });
}

/**
 * Get chunk count for a transfer
 * @param {string} transferId - Unique transfer identifier
 * @returns {Promise<number>} Number of chunks stored
 */
export async function getChunkCount(transferId) {
  const db = await openTransferDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHUNKS_STORE], "readonly");
    const store = transaction.objectStore(CHUNKS_STORE);
    const index = store.index("transferId");

    const request = index.count(IDBKeyRange.only(transferId));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.error(`[TransferDB] Failed to count chunks for ${transferId}:`, request.error);
      reject(request.error);
    };

    // Don't close DB - keep connection open for performance
  });
}

/**
 * Check if a specific chunk exists
 * @param {string} transferId - Unique transfer identifier
 * @param {number} chunkIndex - Index of the chunk
 * @returns {Promise<boolean>}
 */
export async function hasChunk(transferId, chunkIndex) {
  const db = await openTransferDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHUNKS_STORE], "readonly");
    const store = transaction.objectStore(CHUNKS_STORE);

    const request = store.get([transferId, chunkIndex]);

    request.onsuccess = () => resolve(!!request.result);
    request.onerror = () => {
      console.error(`[TransferDB] Failed to check chunk ${chunkIndex}:`, request.error);
      reject(request.error);
    };

    // Don't close DB - keep connection open for performance
  });
}

/**
 * Store transfer metadata
 * @param {string} transferId - Unique transfer identifier
 * @param {Object} metadata - Transfer metadata (fileName, fileSize, etc.)
 * @returns {Promise<void>}
 */
export async function storeMetadata(transferId, metadata) {
  const db = await openTransferDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([METADATA_STORE], "readwrite");
    const store = transaction.objectStore(METADATA_STORE);

    const request = store.put({
      transferId,
      ...metadata,
      timestamp: Date.now(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error(`[TransferDB] Failed to store metadata:`, request.error);
      reject(request.error);
    };

    // Don't close DB - keep connection open for performance
  });
}

/**
 * Get transfer metadata
 * @param {string} transferId - Unique transfer identifier
 * @returns {Promise<Object|null>}
 */
export async function getMetadata(transferId) {
  const db = await openTransferDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([METADATA_STORE], "readonly");
    const store = transaction.objectStore(METADATA_STORE);

    const request = store.get(transferId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error(`[TransferDB] Failed to get metadata:`, request.error);
      reject(request.error);
    };

    // Don't close DB - keep connection open for performance
  });
}

/**
 * Delete all data for a transfer (chunks + metadata)
 * @param {string} transferId - Unique transfer identifier
 * @returns {Promise<void>}
 */
export async function deleteTransfer(transferId) {
  const db = await openTransferDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHUNKS_STORE, METADATA_STORE], "readwrite");

    // Delete all chunks
    const chunksStore = transaction.objectStore(CHUNKS_STORE);
    const chunksIndex = chunksStore.index("transferId");
    const chunksRequest = chunksIndex.openCursor(IDBKeyRange.only(transferId));

    chunksRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    // Delete metadata
    const metadataStore = transaction.objectStore(METADATA_STORE);
    metadataStore.delete(transferId);

    transaction.oncomplete = () => {
      // Don't close DB - keep connection open for reuse
      resolve();
    };

    transaction.onerror = () => {
      console.error(`[TransferDB] Failed to delete transfer ${transferId}:`, transaction.error);
      reject(transaction.error);
    };
  });
}

/**
 * Delete all transfers older than a specific timestamp
 * Useful for cleanup of abandoned/incomplete transfers
 * @param {number} olderThanTimestamp - Unix timestamp in milliseconds
 * @returns {Promise<number>} Number of transfers deleted
 */
export async function deleteOldTransfers(olderThanTimestamp) {
  const db = await openTransferDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([METADATA_STORE, CHUNKS_STORE], "readwrite");
    const metadataStore = transaction.objectStore(METADATA_STORE);

    let deletedCount = 0;
    const transferIdsToDelete = [];

    // Find old transfers
    const cursorRequest = metadataStore.openCursor();
    cursorRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.timestamp < olderThanTimestamp) {
          transferIdsToDelete.push(cursor.value.transferId);
          cursor.delete();
          deletedCount++;
        }
        cursor.continue();
      } else {
        // Delete associated chunks
        const chunksStore = transaction.objectStore(CHUNKS_STORE);
        const chunksIndex = chunksStore.index("transferId");

        transferIdsToDelete.forEach((transferId) => {
          const deleteRequest = chunksIndex.openCursor(IDBKeyRange.only(transferId));
          deleteRequest.onsuccess = (e) => {
            const chunkCursor = e.target.result;
            if (chunkCursor) {
              chunkCursor.delete();
              chunkCursor.continue();
            }
          };
        });
      }
    };

    transaction.oncomplete = () => {
      // Don't close DB - keep connection open for reuse
      console.log(`[TransferDB] Deleted ${deletedCount} old transfer(s)`);
      resolve(deletedCount);
    };

    transaction.onerror = () => {
      console.error(`[TransferDB] Failed to delete old transfers:`, transaction.error);
      reject(transaction.error);
    };
  });
}

/**
 * Clear all transfer data (for testing or manual cleanup)
 * @returns {Promise<void>}
 */
export async function clearAllTransfers() {
  const db = await openTransferDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHUNKS_STORE, METADATA_STORE], "readwrite");

    transaction.objectStore(CHUNKS_STORE).clear();
    transaction.objectStore(METADATA_STORE).clear();

    transaction.oncomplete = () => {
      // Don't close DB - keep connection open for reuse
      console.log("[TransferDB] All transfers cleared");
      resolve();
    };

    transaction.onerror = () => {
      console.error("[TransferDB] Failed to clear transfers:", transaction.error);
      reject(transaction.error);
    };
  });
}
