import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileFilePanel } from './MobileFilePanel';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key, // Return the key as-is for testing
  }),
}));

const OWN_UUID = 'own-uuid-1234';
const PEER_UUID = 'peer-uuid-5678';

const ownFile = {
  id: 'file-own',
  name: 'notes.txt',
  size: 1024,
  type: 'text/plain',
  ownerUuid: OWN_UUID,
};

const peerFile = {
  id: 'file-peer',
  name: 'photo.jpg',
  size: 2048,
  type: 'image/jpeg',
  ownerUuid: PEER_UUID,
};

describe('MobileFilePanel', () => {
  const defaultProps = {
    files: [],
    sharedFiles: [],
    peers: [{ id: 's1', role: 'mobile', name: 'Pixel', clientUuid: PEER_UUID }],
    clientUuid: OWN_UUID,
    onDownload: vi.fn(),
    onRemoveFile: vi.fn(),
    onFilesChange: vi.fn(),
    transfers: new Map(),
  };

  it('renders empty state when no files are shared', () => {
    render(<MobileFilePanel {...defaultProps} />);

    expect(screen.getByText('mobile.files.empty')).toBeInTheDocument();
    expect(screen.getByText('mobile.files.select')).toBeInTheDocument();
  });

  it('renders own and peer files with names and owners', () => {
    render(<MobileFilePanel {...defaultProps} files={[ownFile, peerFile]} />);

    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getByText(/mobile\.files\.you/)).toBeInTheDocument();
    expect(screen.getByText(/Pixel/)).toBeInTheDocument();
  });

  it('shows download button for peer files and calls onDownload', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(<MobileFilePanel {...defaultProps} files={[peerFile]} onDownload={onDownload} />);

    const downloadBtn = screen.getByText('mobile.files.download');
    await user.click(downloadBtn);

    expect(onDownload).toHaveBeenCalledWith(peerFile);
  });

  it('shows remove button for own files and calls onRemoveFile', async () => {
    const user = userEvent.setup();
    const onRemoveFile = vi.fn();
    render(<MobileFilePanel {...defaultProps} files={[ownFile]} onRemoveFile={onRemoveFile} />);

    const removeBtn = screen.getByLabelText('mobile.files.remove');
    await user.click(removeBtn);

    expect(onRemoveFile).toHaveBeenCalledWith('file-own');
  });

  it('shows progress instead of download button during transfer', () => {
    const transfers = new Map([
      ['t1', { transferId: 't1', fileId: 'file-peer', progress: 42, status: 'receiving' }],
    ]);
    render(<MobileFilePanel {...defaultProps} files={[peerFile]} transfers={transfers} />);

    expect(screen.queryByText('mobile.files.download')).not.toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('shows checkmark when transfer is completed', () => {
    const transfers = new Map([
      ['t1', { transferId: 't1', fileId: 'file-peer', progress: 100, status: 'completed' }],
    ]);
    render(<MobileFilePanel {...defaultProps} files={[peerFile]} transfers={transfers} />);

    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('adds selected files via onFilesChange', async () => {
    const user = userEvent.setup();
    const onFilesChange = vi.fn();
    render(<MobileFilePanel {...defaultProps} onFilesChange={onFilesChange} />);

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, file);

    expect(onFilesChange).toHaveBeenCalledTimes(1);
    const newList = onFilesChange.mock.calls[0][0];
    expect(newList).toHaveLength(1);
    expect(newList[0].name).toBe('hello.txt');
    expect(newList[0].file).toBe(file);
  });
});
