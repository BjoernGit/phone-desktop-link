import { describe, it, expect } from 'vitest';
import {
  isValidSessionId,
  isValidRole,
  isValidUuid,
  isValidMime,
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
});
