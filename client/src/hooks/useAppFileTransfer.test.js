import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// The hook orchestrates WebRTC and the transfer engine - both are stubbed so
// the tests can drive the peer file list directly.
const webRTCStub = {
  dataChannels: new Map(),
  connectionStates: new Map(),
  createOffer: vi.fn(),
  registerMessageCallback: vi.fn(() => () => {}),
  closeConnection: vi.fn(),
};

const fileTransferStub = {
  transfers: new Map(),
  sendFile: vi.fn(),
  setupReceiver: vi.fn(),
  createMessageHandler: vi.fn(() => () => {}),
  clearTransfer: vi.fn(),
  clearCompletedTransfers: vi.fn(),
  cancelTransfersForFile: vi.fn(() => 0),
  hasActiveTransfers: vi.fn(() => false),
};

vi.mock('./useWebRTC', () => ({
  useWebRTC: () => webRTCStub,
  DEBUG_WEBRTC: false,
}));

vi.mock('./useFileTransfer', () => ({
  useFileTransfer: () => fileTransferStub,
}));

const { useAppFileTransfer } = await import('./useAppFileTransfer');

const OWN_UUID = 'own-uuid';
const PEER_UUID = 'peer-uuid';

const peerFile = {
  id: 'file-1',
  name: 'movie.mp4',
  size: 200 * 1024 * 1024,
  type: 'video/mp4',
  ownerUuid: PEER_UUID,
};

// 200 MB exceeds the Socket.io fallback limit, so a download of `peerFile`
// would bail out early - use a small file when the request must go through.
const smallPeerFile = { ...peerFile, id: 'file-small', size: 1024 };

function makeSocket() {
  return { connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() };
}

function renderTransferHook(socket, peers = [{ clientUuid: PEER_UUID }]) {
  return renderHook(() =>
    useAppFileTransfer({ socket, clientUuid: OWN_UUID, peers })
  );
}

describe('useAppFileTransfer download notices', () => {
  beforeEach(() => {
    webRTCStub.createOffer.mockReset().mockResolvedValue(null);
    fileTransferStub.transfers = new Map();
  });

  it('marks a download as pending until data flows', async () => {
    const { result } = renderTransferHook(makeSocket());

    await act(async () => {
      result.current.handlePeerFileList({ fromUuid: PEER_UUID, files: [smallPeerFile] });
    });
    await act(async () => {
      await result.current.handleFileDownload(smallPeerFile);
    });

    expect(result.current.pendingDownloads.has(smallPeerFile.id)).toBe(true);
  });

  it('tombstones a download the moment the file leaves the peer list', async () => {
    const { result } = renderTransferHook(makeSocket());

    await act(async () => {
      result.current.handlePeerFileList({ fromUuid: PEER_UUID, files: [smallPeerFile] });
    });
    await act(async () => {
      await result.current.handleFileDownload(smallPeerFile);
    });

    // Sender removed the file: the list update arrives long before the
    // FILE_REVOKED handshake crawls through the congested data channel
    await act(async () => {
      result.current.handlePeerFileList({ fromUuid: PEER_UUID, files: [] });
    });

    const notice = result.current.fileNotices.get(smallPeerFile.id);
    expect(notice).toBeDefined();
    expect(notice.reason).toBe('revoked');
    expect(notice.name).toBe('movie.mp4');
    expect(result.current.pendingDownloads.has(smallPeerFile.id)).toBe(false);
  });

  it('never renders a frame where the row is neither listed nor tombstoned', async () => {
    const socket = makeSocket();
    // A row is on screen when the file is still listed OR a notice exists.
    // If both are false in any single render, the row blinks out.
    const observed = [];
    const { result } = renderHook(() => {
      const api = useAppFileTransfer({
        socket,
        clientUuid: OWN_UUID,
        peers: [{ clientUuid: PEER_UUID }],
      });
      const listed = [...api.peerFiles.values()]
        .flat()
        .some((f) => f.id === smallPeerFile.id);
      observed.push(listed || api.fileNotices.has(smallPeerFile.id));
      return api;
    });

    await act(async () => {
      result.current.handlePeerFileList({ fromUuid: PEER_UUID, files: [smallPeerFile] });
    });
    await act(async () => {
      await result.current.handleFileDownload(smallPeerFile);
    });

    const firstVisible = observed.indexOf(true);
    expect(firstVisible).toBeGreaterThanOrEqual(0);

    await act(async () => {
      result.current.handlePeerFileList({ fromUuid: PEER_UUID, files: [] });
    });

    // Every render from the moment the row appeared must keep it on screen
    expect(observed.slice(firstVisible)).not.toContain(false);
  });

  it('leaves files alone that were never requested', async () => {
    const { result } = renderTransferHook(makeSocket());

    await act(async () => {
      result.current.handlePeerFileList({ fromUuid: PEER_UUID, files: [smallPeerFile] });
    });
    await act(async () => {
      result.current.handlePeerFileList({ fromUuid: PEER_UUID, files: [] });
    });

    expect(result.current.fileNotices.size).toBe(0);
  });

  it('reports a peer that left rather than a withdrawal', async () => {
    const socket = makeSocket();
    const { result, rerender } = renderHook(
      ({ peers }) => useAppFileTransfer({ socket, clientUuid: OWN_UUID, peers }),
      { initialProps: { peers: [{ clientUuid: PEER_UUID }] } }
    );

    await act(async () => {
      result.current.handlePeerFileList({ fromUuid: PEER_UUID, files: [smallPeerFile] });
    });
    await act(async () => {
      await result.current.handleFileDownload(smallPeerFile);
    });

    await act(async () => {
      rerender({ peers: [] });
    });

    expect(result.current.fileNotices.get(smallPeerFile.id)?.reason).toBe('peerGone');
  });

  it('drops the notice when the same download is started again', async () => {
    const { result } = renderTransferHook(makeSocket());

    await act(async () => {
      result.current.handlePeerFileList({ fromUuid: PEER_UUID, files: [smallPeerFile] });
    });
    await act(async () => {
      await result.current.handleFileDownload(smallPeerFile);
    });
    await act(async () => {
      result.current.handlePeerFileList({ fromUuid: PEER_UUID, files: [] });
    });
    expect(result.current.fileNotices.size).toBe(1);

    await act(async () => {
      await result.current.handleFileDownload(smallPeerFile);
    });

    expect(result.current.fileNotices.size).toBe(0);
  });
});
