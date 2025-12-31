import { describe, it, expect } from 'vitest';
import {
  generateSeedBase64Url,
  base64UrlEncode,
  base64UrlDecode,
  deriveAesKeyFromSeed,
  exportAesKeyBase64Url,
  encryptDataUrl,
  decryptToDataUrl,
  encryptJsonWithSecret,
  decryptJsonWithSecret,
} from './crypto';

describe('crypto utilities', () => {
  describe('generateSeedBase64Url', () => {
    it('generates a non-empty seed', () => {
      const seed = generateSeedBase64Url();
      expect(seed).toBeTruthy();
      expect(seed.length).toBeGreaterThan(0);
    });

    it('generates base64url format (no + or /)', () => {
      const seed = generateSeedBase64Url();
      expect(seed).not.toContain('+');
      expect(seed).not.toContain('/');
      expect(seed).not.toContain('=');
    });

    it('generates different seeds each time', () => {
      const seed1 = generateSeedBase64Url();
      const seed2 = generateSeedBase64Url();
      expect(seed1).not.toBe(seed2);
    });

    it('generates seeds of reasonable length', () => {
      const seed = generateSeedBase64Url();
      expect(seed.length).toBeGreaterThan(20);
      expect(seed.length).toBeLessThan(100);
    });
  });

  describe('base64UrlEncode and base64UrlDecode', () => {
    it('encodes and decodes bytes correctly', () => {
      const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const encoded = base64UrlEncode(original);
      const decoded = base64UrlDecode(encoded);

      expect(decoded).toEqual(original);
    });

    it('produces base64url format without + / =', () => {
      const bytes = new Uint8Array(32).map((_, i) => i * 8);
      const encoded = base64UrlEncode(bytes);

      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });

    it('handles empty arrays', () => {
      const empty = new Uint8Array(0);
      const encoded = base64UrlEncode(empty);
      const decoded = base64UrlDecode(encoded);

      expect(decoded.length).toBe(0);
    });

    it('is reversible for random data', () => {
      const random = crypto.getRandomValues(new Uint8Array(64));
      const encoded = base64UrlEncode(random);
      const decoded = base64UrlDecode(encoded);

      expect(decoded).toEqual(random);
    });
  });

  describe('deriveAesKeyFromSeed', () => {
    it('derives a valid AES key from seed', async () => {
      const seed = generateSeedBase64Url();
      const key = await deriveAesKeyFromSeed(seed);

      expect(key).toBeTruthy();
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
    });

    it('derives the same key from the same seed', async () => {
      const seed = generateSeedBase64Url();
      const key1 = await deriveAesKeyFromSeed(seed);
      const key2 = await deriveAesKeyFromSeed(seed);

      const exported1 = await exportAesKeyBase64Url(key1);
      const exported2 = await exportAesKeyBase64Url(key2);

      expect(exported1).toBe(exported2);
    });

    it('derives different keys from different seeds', async () => {
      const seed1 = generateSeedBase64Url();
      const seed2 = generateSeedBase64Url();
      const key1 = await deriveAesKeyFromSeed(seed1);
      const key2 = await deriveAesKeyFromSeed(seed2);

      const exported1 = await exportAesKeyBase64Url(key1);
      const exported2 = await exportAesKeyBase64Url(key2);

      expect(exported1).not.toBe(exported2);
    });

    it('derives different keys with different session IDs', async () => {
      const seed = generateSeedBase64Url();
      const key1 = await deriveAesKeyFromSeed(seed, 'session1');
      const key2 = await deriveAesKeyFromSeed(seed, 'session2');

      const exported1 = await exportAesKeyBase64Url(key1);
      const exported2 = await exportAesKeyBase64Url(key2);

      expect(exported1).not.toBe(exported2);
    });
  });

  describe('encryptDataUrl and decryptToDataUrl', () => {
    it('encrypts and decrypts a data URL', async () => {
      const seed = generateSeedBase64Url();
      const key = await deriveAesKeyFromSeed(seed);
      const originalDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const encrypted = await encryptDataUrl(originalDataUrl, key);
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.mime).toBe('image/png');

      const decrypted = await decryptToDataUrl(encrypted, key);
      expect(decrypted).toBe(originalDataUrl);
    });

    it('throws error when encrypting without key', async () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
      await expect(encryptDataUrl(dataUrl, null)).rejects.toThrow('Missing key');
    });

    it('throws error when decrypting without key', async () => {
      const payload = { iv: 'test', ciphertext: 'test', mime: 'image/png' };
      await expect(decryptToDataUrl(payload, null)).rejects.toThrow('Missing key');
    });

    it('throws error when decrypting with wrong key', async () => {
      const seed1 = generateSeedBase64Url();
      const seed2 = generateSeedBase64Url();
      const key1 = await deriveAesKeyFromSeed(seed1);
      const key2 = await deriveAesKeyFromSeed(seed2);
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';

      const encrypted = await encryptDataUrl(dataUrl, key1);
      await expect(decryptToDataUrl(encrypted, key2)).rejects.toThrow();
    });

    it('produces different ciphertexts for same input', async () => {
      const seed = generateSeedBase64Url();
      const key = await deriveAesKeyFromSeed(seed);
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';

      const encrypted1 = await encryptDataUrl(dataUrl, key);
      const encrypted2 = await encryptDataUrl(dataUrl, key);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });
  });

  describe('encryptJsonWithSecret and decryptJsonWithSecret', () => {
    it('encrypts and decrypts a JSON object', async () => {
      const secret = generateSeedBase64Url();
      const payload = { sessionId: 'test-123', data: 'secret data' };

      const encrypted = await encryptJsonWithSecret(secret, payload);
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.ciphertext).toBeTruthy();

      const decrypted = await decryptJsonWithSecret(secret, encrypted);
      expect(decrypted).toEqual(payload);
    });

    it('throws error when encrypting without secret', async () => {
      await expect(encryptJsonWithSecret(null, { test: 'data' })).rejects.toThrow('Missing secret or payload');
    });

    it('throws error when encrypting without payload', async () => {
      const secret = generateSeedBase64Url();
      await expect(encryptJsonWithSecret(secret, null)).rejects.toThrow('Missing secret or payload');
    });

    it('throws error when decrypting without secret', async () => {
      await expect(decryptJsonWithSecret(null, { iv: 'test', ciphertext: 'test' })).rejects.toThrow('Missing secret or payload');
    });

    it('throws error when decrypting with wrong secret', async () => {
      const secret1 = generateSeedBase64Url();
      const secret2 = generateSeedBase64Url();
      const payload = { test: 'data' };

      const encrypted = await encryptJsonWithSecret(secret1, payload);
      await expect(decryptJsonWithSecret(secret2, encrypted)).rejects.toThrow();
    });

    it('handles complex JSON objects', async () => {
      const secret = generateSeedBase64Url();
      const payload = {
        sessionId: 'complex-session',
        nested: { data: [1, 2, 3] },
        boolean: true,
        number: 42,
        null: null,
      };

      const encrypted = await encryptJsonWithSecret(secret, payload);
      const decrypted = await decryptJsonWithSecret(secret, encrypted);

      expect(decrypted).toEqual(payload);
    });

    it('uses custom info parameter', async () => {
      const secret = generateSeedBase64Url();
      const payload = { test: 'data' };

      const encrypted1 = await encryptJsonWithSecret(secret, payload, 'info1');
      const encrypted2 = await encryptJsonWithSecret(secret, payload, 'info2');

      await expect(decryptJsonWithSecret(secret, encrypted1, 'info2')).rejects.toThrow();
      await expect(decryptJsonWithSecret(secret, encrypted2, 'info1')).rejects.toThrow();

      const decrypted1 = await decryptJsonWithSecret(secret, encrypted1, 'info1');
      const decrypted2 = await decryptJsonWithSecret(secret, encrypted2, 'info2');

      expect(decrypted1).toEqual(payload);
      expect(decrypted2).toEqual(payload);
    });
  });
});
