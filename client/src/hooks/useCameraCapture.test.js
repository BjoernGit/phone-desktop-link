import { describe, it, expect } from 'vitest';
import { computeCaptureRect } from './useCameraCapture';

const M = { long: 1280, short: 720 };
const XL = { long: 2560, short: 1440 };

describe('computeCaptureRect', () => {
  it('portrait device + portrait source: fixed portrait format, no crop for 9:16', () => {
    const r = computeCaptureRect(1080, 1920, M, true);
    expect([r.outW, r.outH]).toEqual([720, 1280]);
    expect([r.sx, r.sy, r.sW, r.sH]).toEqual([0, 0, 1080, 1920]);
  });

  it('landscape device + landscape source: fixed landscape format, no crop for 16:9', () => {
    const r = computeCaptureRect(1920, 1080, M, false);
    expect([r.outW, r.outH]).toEqual([1280, 720]);
    expect([r.sx, r.sy, r.sW, r.sH]).toEqual([0, 0, 1920, 1080]);
  });

  it('portrait device + landscape source: crops the portrait format out of the frame', () => {
    // Stream liefert noch quer, Handy ist aufrecht -> mittiger 9:16-Ausschnitt
    const r = computeCaptureRect(1920, 1080, M, true);
    expect(r.sH).toBe(1080);
    expect(r.sW).toBe(Math.round(1080 * (720 / 1280)));
    expect(r.sx).toBe(Math.round((1920 - r.sW) / 2));
    expect(r.sy).toBe(0);
    // 9:16 Format, kein Upscale (Quelle ist kleiner als 720x1280)
    expect(r.outW / r.outH).toBeCloseTo(720 / 1280, 2);
    expect(r.outW).toBeLessThanOrEqual(720);
  });

  it('landscape device + portrait source: crops the landscape format out of the frame', () => {
    const r = computeCaptureRect(1080, 1920, M, false);
    expect(r.sW).toBe(1080);
    expect(r.sH).toBe(Math.round(1080 / (1280 / 720)));
    expect(r.sy).toBe(Math.round((1920 - r.sH) / 2));
    expect(r.sx).toBe(0);
    expect(r.outW / r.outH).toBeCloseTo(1280 / 720, 2);
    expect(r.outH).toBeLessThanOrEqual(720);
  });

  it('crops a 4:3 landscape source to the fixed 16:9 landscape format', () => {
    const r = computeCaptureRect(2048, 1536, M, false);
    expect([r.outW, r.outH]).toEqual([1280, 720]);
    expect(r.sH).toBe(Math.round(2048 / (16 / 9)));
    expect(r.sy).toBe(Math.round((1536 - r.sH) / 2));
  });

  it('never upscales small sources', () => {
    const r = computeCaptureRect(640, 360, XL, false);
    expect([r.outW, r.outH]).toEqual([640, 360]);
  });
});
