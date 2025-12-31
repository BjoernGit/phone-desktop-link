import { describe, it, expect } from 'vitest';
import { parseQrUrl } from './qrParser';

describe('parseQrUrl', () => {
  it('parses valid QR URL with all parameters', () => {
    const url = 'https://example.com/join?session=test-session&uid=user-123#seed=abc123&ok=secret456&t=1234567890';
    const result = parseQrUrl(url);

    expect(result.session).toBe('test-session');
    expect(result.targetUuid).toBe('user-123');
    expect(result.seed).toBe('abc123');
    expect(result.offerSecret).toBe('secret456');
    expect(result.timestamp).toBe('1234567890');
    expect(result.raw).toBe(url);
  });

  it('parses URL with only session parameter', () => {
    const url = 'https://example.com/join?session=minimal-session';
    const result = parseQrUrl(url);

    expect(result.session).toBe('minimal-session');
    expect(result.targetUuid).toBe('');
    expect(result.seed).toBe('');
    expect(result.offerSecret).toBe('');
    expect(result.timestamp).toBe('');
  });

  it('parses URL with hash parameters only', () => {
    const url = 'https://example.com/join#seed=hash-seed&ok=hash-secret';
    const result = parseQrUrl(url);

    expect(result.session).toBe('');
    expect(result.seed).toBe('hash-seed');
    expect(result.offerSecret).toBe('hash-secret');
  });

  it('parses URL with special characters in parameters', () => {
    const url = 'https://example.com/join?session=test_session-123&uid=user.uuid#seed=abc-DEF_123';
    const result = parseQrUrl(url);

    expect(result.session).toBe('test_session-123');
    expect(result.targetUuid).toBe('user.uuid');
    expect(result.seed).toBe('abc-DEF_123');
  });

  it('returns empty values for invalid URL', () => {
    const result = parseQrUrl('not-a-valid-url');

    expect(result.session).toBe('');
    expect(result.targetUuid).toBe('');
    expect(result.seed).toBe('');
    expect(result.offerSecret).toBe('');
    expect(result.timestamp).toBe('');
    expect(result.raw).toBe('not-a-valid-url');
  });

  it('returns empty values for empty string', () => {
    const result = parseQrUrl('');

    expect(result.session).toBe('');
    expect(result.targetUuid).toBe('');
    expect(result.seed).toBe('');
    expect(result.offerSecret).toBe('');
    expect(result.timestamp).toBe('');
    expect(result.raw).toBe('');
  });

  it('handles URL without query parameters', () => {
    const url = 'https://example.com/join';
    const result = parseQrUrl(url);

    expect(result.session).toBe('');
    expect(result.targetUuid).toBe('');
  });

  it('handles URL without hash parameters', () => {
    const url = 'https://example.com/join?session=test';
    const result = parseQrUrl(url);

    expect(result.session).toBe('test');
    expect(result.seed).toBe('');
    expect(result.offerSecret).toBe('');
  });

  it('handles URL with empty parameter values', () => {
    const url = 'https://example.com/join?session=&uid=#seed=&ok=';
    const result = parseQrUrl(url);

    expect(result.session).toBe('');
    expect(result.targetUuid).toBe('');
    expect(result.seed).toBe('');
    expect(result.offerSecret).toBe('');
  });

  it('parses real-world QR URL format', () => {
    const url = 'https://qr-share.com/connect?session=abc123xyz#seed=dGVzdHNlZWQ&ok=b2ZmZXJrZXk&t=1704067200';
    const result = parseQrUrl(url);

    expect(result.session).toBe('abc123xyz');
    expect(result.seed).toBe('dGVzdHNlZWQ');
    expect(result.offerSecret).toBe('b2ZmZXJrZXk');
    expect(result.timestamp).toBe('1704067200');
  });

  it('preserves original raw URL', () => {
    const url = 'https://example.com/join?session=test#seed=abc';
    const result = parseQrUrl(url);

    expect(result.raw).toBe(url);
  });

  it('handles URL with port number', () => {
    const url = 'https://localhost:3000/join?session=local-test#seed=localseed';
    const result = parseQrUrl(url);

    expect(result.session).toBe('local-test');
    expect(result.seed).toBe('localseed');
  });

  it('handles URL with path segments', () => {
    const url = 'https://example.com/app/v1/join?session=path-test#seed=pathseed';
    const result = parseQrUrl(url);

    expect(result.session).toBe('path-test');
    expect(result.seed).toBe('pathseed');
  });
});
