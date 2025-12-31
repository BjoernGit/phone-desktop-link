import { describe, it, expect } from 'vitest';
import { generateSeedBase64Url } from './crypto';

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
});
