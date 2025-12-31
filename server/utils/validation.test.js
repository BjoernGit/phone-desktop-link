import { describe, it, expect } from 'vitest';
import {
  isValidSessionId,
  isValidRole,
  isValidUuid,
  isValidMime,
  isValidBase64Url,
  isValidEncPayload,
  hmacValid,
} from './validation.js';

describe('validation utilities', () => {
  describe('isValidSessionId', () => {
    it('accepts valid session IDs', () => {
      expect(isValidSessionId('test-session')).toBe(true);
      expect(isValidSessionId('abc12345')).toBe(true);
      expect(isValidSessionId('my_session-1')).toBe(true);
    });

    it('rejects too short session IDs', () => {
      expect(isValidSessionId('short')).toBe(false);
      expect(isValidSessionId('abc')).toBe(false);
    });

    it('rejects too long session IDs', () => {
      const tooLong = 'a'.repeat(33);
      expect(isValidSessionId(tooLong)).toBe(false);
    });

    it('rejects invalid characters', () => {
      expect(isValidSessionId('test session')).toBe(false);
      expect(isValidSessionId('test@session')).toBe(false);
      expect(isValidSessionId('test/session')).toBe(false);
    });

    it('rejects non-strings', () => {
      expect(isValidSessionId(null)).toBe(false);
      expect(isValidSessionId(undefined)).toBe(false);
      expect(isValidSessionId(123)).toBe(false);
    });
  });

  describe('isValidRole', () => {
    it('accepts valid roles', () => {
      expect(isValidRole('mobile')).toBe(true);
      expect(isValidRole('desktop')).toBe(true);
    });

    it('rejects invalid roles', () => {
      expect(isValidRole('admin')).toBe(false);
      expect(isValidRole('user')).toBe(false);
      expect(isValidRole('')).toBe(false);
    });
  });

  describe('isValidUuid', () => {
    it('accepts valid UUIDs', () => {
      expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUuid('abc123def456')).toBe(true);
    });

    it('rejects too short UUIDs', () => {
      expect(isValidUuid('short')).toBe(false);
    });

    it('rejects too long UUIDs', () => {
      const tooLong = 'a'.repeat(65);
      expect(isValidUuid(tooLong)).toBe(false);
    });
  });

  describe('isValidMime', () => {
    it('accepts valid image MIME types', () => {
      expect(isValidMime('image/png')).toBe(true);
      expect(isValidMime('image/jpeg')).toBe(true);
      expect(isValidMime('image/webp')).toBe(true);
    });

    it('rejects non-image MIME types', () => {
      expect(isValidMime('text/html')).toBe(false);
      expect(isValidMime('application/json')).toBe(false);
    });

    it('rejects invalid MIME formats', () => {
      expect(isValidMime('image')).toBe(false);
      expect(isValidMime('notamime')).toBe(false);
      expect(isValidMime('')).toBe(false);
    });
  });

  describe('isValidBase64Url', () => {
    it('accepts valid base64url strings', () => {
      expect(isValidBase64Url('abcDEF123_-', 8, 100)).toBe(true);
      expect(isValidBase64Url('test1234', 8, 100)).toBe(true);
      expect(isValidBase64Url('A1B2C3D4E5F6', 8, 100)).toBe(true);
    });

    it('rejects strings that are too short', () => {
      expect(isValidBase64Url('short', 10, 100)).toBe(false);
      expect(isValidBase64Url('abc', 8, 100)).toBe(false);
    });

    it('rejects strings that are too long', () => {
      const tooLong = 'a'.repeat(101);
      expect(isValidBase64Url(tooLong, 8, 100)).toBe(false);
    });

    it('rejects strings with invalid characters', () => {
      expect(isValidBase64Url('has+plus', 8, 100)).toBe(false);
      expect(isValidBase64Url('has/slash', 8, 100)).toBe(false);
      expect(isValidBase64Url('has=equals', 8, 100)).toBe(false);
      expect(isValidBase64Url('has space', 8, 100)).toBe(false);
    });

    it('rejects non-strings', () => {
      expect(isValidBase64Url(null, 8, 100)).toBe(false);
      expect(isValidBase64Url(undefined, 8, 100)).toBe(false);
      expect(isValidBase64Url(12345, 8, 100)).toBe(false);
    });

    it('uses default min and max values', () => {
      expect(isValidBase64Url('testvalue')).toBe(true);
      const veryLong = 'a'.repeat(9000);
      expect(isValidBase64Url(veryLong)).toBe(false);
    });
  });

  describe('isValidEncPayload', () => {
    it('accepts valid encrypted payloads', () => {
      const validPayload = {
        iv: 'abc123def456',
        ciphertext: 'encrypted_data_here',
      };
      expect(isValidEncPayload(validPayload)).toBe(true);
    });

    it('rejects payloads with missing iv', () => {
      const payload = { ciphertext: 'encrypted_data_here' };
      expect(isValidEncPayload(payload)).toBe(false);
    });

    it('rejects payloads with missing ciphertext', () => {
      const payload = { iv: 'abc123def456' };
      expect(isValidEncPayload(payload)).toBe(false);
    });

    it('rejects payloads with invalid iv', () => {
      const payload = {
        iv: 'short',
        ciphertext: 'encrypted_data_here',
      };
      expect(isValidEncPayload(payload)).toBe(false);
    });

    it('rejects payloads with invalid ciphertext', () => {
      const payload = {
        iv: 'abc123def456',
        ciphertext: 'short',
      };
      expect(isValidEncPayload(payload)).toBe(false);
    });

    it('rejects null or undefined', () => {
      expect(isValidEncPayload(null)).toBe(false);
      expect(isValidEncPayload(undefined)).toBe(false);
    });
  });

  describe('hmacValid', () => {
    it('validates correct HMAC signatures', () => {
      const seed = 'dGVzdHNlZWQxMjM0NTY3OA';
      const payload = 'test-payload-data';
      const signature = '9m-1yFKVdr4hQq8EN51zxIlPkpxQLdjICiZHQHD1wbk';

      expect(hmacValid(seed, payload, signature)).toBe(true);
    });

    it('rejects invalid signatures', () => {
      const seed = 'dGVzdHNlZWQxMjM0NTY3OA';
      const payload = 'test-payload-data';
      const wrongSignature = 'wrongsignature123';

      expect(hmacValid(seed, payload, wrongSignature)).toBe(false);
    });

    it('rejects signatures for different payloads', () => {
      const seed = 'dGVzdHNlZWQxMjM0NTY3OA';
      const payload1 = 'test-payload-data';
      const payload2 = 'different-payload';
      const signature = '9m-1yFKVdr4hQq8EN51zxIlPkpxQLdjICiZHQHD1wbk';

      expect(hmacValid(seed, payload1, signature)).toBe(true);
      expect(hmacValid(seed, payload2, signature)).toBe(false);
    });

    it('rejects missing seed', () => {
      expect(hmacValid(null, 'payload', 'signature')).toBe(false);
      expect(hmacValid('', 'payload', 'signature')).toBe(false);
    });

    it('rejects missing signature', () => {
      const seed = 'dGVzdHNlZWQxMjM0NTY3OA';
      expect(hmacValid(seed, 'payload', null)).toBe(false);
      expect(hmacValid(seed, 'payload', '')).toBe(false);
    });

    it('handles malformed base64url gracefully', () => {
      const invalidSeed = 'not!!!valid!!!base64url';
      expect(hmacValid(invalidSeed, 'payload', 'signature')).toBe(false);
    });
  });
});
