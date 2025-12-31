import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileDebugPill } from './MobileDebugPill';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key, // Return the key as-is for testing
  }),
}));

describe('MobileDebugPill', () => {
  const defaultProps = {
    sessionId: 'test-session-123',
    sessionSeed: 'test-seed-abc',
    sessionKeyB64: 'dGVzdGtleQ==',
    encStatus: 'ready',
    offerStatus: null,
    qrStatus: null,
    onSeedChange: vi.fn(),
  };

  it('renders session ID', () => {
    render(<MobileDebugPill {...defaultProps} />);

    expect(screen.getByText(/mobile\.qr\.session/)).toBeInTheDocument();
    expect(screen.getByText(/test-session-123/)).toBeInTheDocument();
  });

  it('renders session ID as "n/a" when not provided', () => {
    render(<MobileDebugPill {...defaultProps} sessionId={null} />);

    expect(screen.getByText(/n\/a/)).toBeInTheDocument();
  });

  it('renders seed input with correct value', () => {
    render(<MobileDebugPill {...defaultProps} />);

    const seedInput = screen.getByPlaceholderText('seed');
    expect(seedInput).toBeInTheDocument();
    expect(seedInput).toHaveValue('test-seed-abc');
  });

  it('renders seed input as empty when not provided', () => {
    render(<MobileDebugPill {...defaultProps} sessionSeed={null} />);

    const seedInput = screen.getByPlaceholderText('seed');
    expect(seedInput).toHaveValue('');
  });

  it('calls onSeedChange when seed input changes', async () => {
    const user = userEvent.setup();
    const mockOnSeedChange = vi.fn();

    render(<MobileDebugPill {...defaultProps} onSeedChange={mockOnSeedChange} />);

    const seedInput = screen.getByPlaceholderText('seed');
    await user.type(seedInput, 'x');

    // Should be called once for typing 'x'
    expect(mockOnSeedChange).toHaveBeenCalled();
    // The value should now contain the original + 'x'
    expect(mockOnSeedChange).toHaveBeenCalledWith('test-seed-abcx');
  });

  it('renders session key', () => {
    render(<MobileDebugPill {...defaultProps} />);

    expect(screen.getByText(/Key:/)).toBeInTheDocument();
    expect(screen.getByText(/dGVzdGtleQ==/)).toBeInTheDocument();
  });

  it('renders session key as "n/a" when not provided', () => {
    render(<MobileDebugPill {...defaultProps} sessionKeyB64={null} />);

    expect(screen.getByText(/Key:.*n\/a/)).toBeInTheDocument();
  });

  it('renders encryption status', () => {
    render(<MobileDebugPill {...defaultProps} />);

    expect(screen.getByText(/ENC:/)).toBeInTheDocument();
    expect(screen.getByText(/ready/)).toBeInTheDocument();
  });

  it('renders different encryption statuses', () => {
    const { rerender } = render(<MobileDebugPill {...defaultProps} encStatus="connecting" />);
    expect(screen.getByText(/connecting/)).toBeInTheDocument();

    rerender(<MobileDebugPill {...defaultProps} encStatus="encrypted" />);
    expect(screen.getByText(/encrypted/)).toBeInTheDocument();
  });

  it('does not render offer status when not provided', () => {
    render(<MobileDebugPill {...defaultProps} offerStatus={null} />);

    expect(screen.queryByText(/Offer:/)).not.toBeInTheDocument();
  });

  it('renders offer status when provided', () => {
    render(<MobileDebugPill {...defaultProps} offerStatus="pending" />);

    expect(screen.getByText(/Offer:/)).toBeInTheDocument();
    expect(screen.getByText(/pending/)).toBeInTheDocument();
  });

  it('does not render QR status when not provided', () => {
    render(<MobileDebugPill {...defaultProps} qrStatus={null} />);

    // QR status should not render as a separate line
    // Note: "mobile.qr.seed" contains "QR" so we need to be specific
    expect(screen.queryByText(/QR code/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/QR ready/i)).not.toBeInTheDocument();
  });

  it('renders QR status when provided', () => {
    render(<MobileDebugPill {...defaultProps} qrStatus="QR code detected" />);

    expect(screen.getByText(/QR code detected/)).toBeInTheDocument();
  });

  it('renders all elements together', () => {
    render(
      <MobileDebugPill
        sessionId="full-test-session"
        sessionSeed="full-test-seed"
        sessionKeyB64="ZnVsbHRlc3RrZXk="
        encStatus="active"
        offerStatus="accepted"
        qrStatus="QR ready"
        onSeedChange={vi.fn()}
      />
    );

    expect(screen.getByText(/full-test-session/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('full-test-seed')).toBeInTheDocument();
    expect(screen.getByText(/ZnVsbHRlc3RrZXk=/)).toBeInTheDocument();
    expect(screen.getByText(/active/)).toBeInTheDocument();
    expect(screen.getByText(/accepted/)).toBeInTheDocument();
    expect(screen.getByText(/QR ready/)).toBeInTheDocument();
  });

  it('has correct CSS classes', () => {
    const { container } = render(<MobileDebugPill {...defaultProps} />);

    expect(container.querySelector('.mobileDebugPill')).toBeInTheDocument();
    expect(container.querySelectorAll('.pillLine').length).toBeGreaterThan(0);
    expect(container.querySelector('.pillInput')).toBeInTheDocument();
    expect(container.querySelector('.pillLabel')).toBeInTheDocument();
  });
});
