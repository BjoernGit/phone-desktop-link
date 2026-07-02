import { describe, it, expect } from 'vitest';
import { computeCaptureRect } from './useCameraCapture';

const M = { long: 1280, short: 720 };
const S = { long: 640, short: 360 };
const XL = { long: 2560, short: 1440 };

describe('computeCaptureRect', () => {
  it('produces the fixed landscape format for a landscape source', () => {
    const r = computeCaptureRect(1920, 1080, M);
    expect([r.outW, r.outH]).toEqual([1280, 720]);
    // 16:9 source matches the target aspect - no crop
    expect([r.sx, r.sy, r.sW, r.sH]).toEqual([0, 0, 1920, 1080]);
  });

  it('produces the fixed portrait format for a portrait source', () => {
    const r = computeCaptureRect(1080, 1920, M);
    expect([r.outW, r.outH]).toEqual([720, 1280]);
    expect([r.sx, r.sy]).toEqual([0, 0]);
  });

  it('center-crops a wider-than-16:9 source in landscape', () => {
    // 2:1 source -> crop left/right to 16:9
    const r = computeCaptureRect(2560, 1280, M);
    expect([r.outW, r.outH]).toEqual([1280, 720]);
    expect(r.sW).toBe(Math.round(1280 * (16 / 9)));
    expect(r.sx).toBe(Math.round((2560 - r.sW) / 2));
    expect(r.sy).toBe(0);
  });

  it('center-crops a 4:3 source to the fixed landscape format', () => {
    const r = computeCaptureRect(2048, 1536, M);
    expect([r.outW, r.outH]).toEqual([1280, 720]);
    // crop top/bottom: source height reduced to match 16:9
    expect(r.sH).toBe(Math.round(2048 / (16 / 9)));
    expect(r.sy).toBe(Math.round((1536 - r.sH) / 2));
  });

  it('never upscales small sources', () => {
    const r = computeCaptureRect(640, 360, XL);
    expect([r.outW, r.outH]).toEqual([640, 360]);
  });

  it('treats a square source as landscape and crops to 16:9', () => {
    const r = computeCaptureRect(1000, 1000, S);
    expect(r.outW / r.outH).toBeCloseTo(16 / 9, 1);
    expect(r.outW).toBeLessThanOrEqual(640);
  });
});
