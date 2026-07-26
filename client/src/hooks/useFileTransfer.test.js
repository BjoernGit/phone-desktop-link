import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { FILE_TRANSFER_CONFIG } from '../config/fileTransfer';

// Chunks live in IndexedDB in production - stub the storage layer
vi.mock('../utils/transferDB', () => ({
  storeChunk: vi.fn(async () => {}),
  assembleChunksToBlob: vi.fn(async () => new Blob()),
  deleteTransfer: vi.fn(async () => {}),
  getChunkCount: vi.fn(async () => 0),
}));

const { useFileTransfer } = await import('./useFileTransfer');

const { STALL_DETECT_MS, TRANSFER_TIMEOUT_MS } = FILE_TRANSFER_CONFIG;

function fileStart(transferId, totalChunks) {
  return {
    data: JSON.stringify({
      type: 'file-start',
      transferId,
      fileId: 'file-1',
      fileName: 'big.bin',
      fileSize: totalChunks * 16384,
      fileType: 'application/octet-stream',
      totalChunks,
    }),
  };
}

async function receiveChunk(handler, transferId, chunkIndex) {
  await handler({
    data: JSON.stringify({ type: 'file-chunk', transferId, chunkIndex }),
  });
  await handler({ data: new ArrayBuffer(16384) });
}

describe('useFileTransfer receiver watchdogs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setupReceivingTransfer(totalChunks = 8) {
    const hook = renderHook(() => useFileTransfer());
    let handler;
    act(() => {
      handler = hook.result.current.createMessageHandler(vi.fn(), vi.fn(), vi.fn(), vi.fn());
    });
    await act(async () => {
      await handler(fileStart('t1', totalChunks));
    });
    return { hook, handler };
  }

  it('flags a transfer as stalled when no data arrives, and recovers on the next chunk', async () => {
    const { hook, handler } = await setupReceivingTransfer();

    await act(async () => {
      await receiveChunk(handler, 't1', 0);
    });
    expect(hook.result.current.transfers.get('t1').status).toBe('receiving');

    // Silence: the local watchdog flips the status without any network event
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALL_DETECT_MS + 100);
    });
    expect(hook.result.current.transfers.get('t1').status).toBe('stalled');
    // Progress reached so far stays visible
    expect(hook.result.current.transfers.get('t1').progress).toBe(13);

    // Data resumes: back to receiving
    await act(async () => {
      await receiveChunk(handler, 't1', 1);
    });
    expect(hook.result.current.transfers.get('t1').status).toBe('receiving');
  });

  it('treats the transfer timeout as inactivity, not total duration', async () => {
    const { hook, handler } = await setupReceivingTransfer();

    // Chunks keep arriving with long gaps: total time far exceeds the
    // timeout, but no single gap does - the transfer must survive
    const gap = TRANSFER_TIMEOUT_MS - 60 * 1000;
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await receiveChunk(handler, 't1', i);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(gap);
      });
    }
    const status = hook.result.current.transfers.get('t1').status;
    expect(status === 'receiving' || status === 'stalled').toBe(true);

    // A full timeout window with no data at all finally kills it
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSFER_TIMEOUT_MS + 100);
    });
    expect(hook.result.current.transfers.get('t1').status).toBe('timeout');
  });
});
