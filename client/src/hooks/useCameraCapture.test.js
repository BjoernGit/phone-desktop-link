import { describe, it, expect } from 'vitest';
import { computeCaptureRect, computeFrameRotation } from './useCameraCapture';

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

describe('computeFrameRotation', () => {
  it('no rotation when orientation is unchanged since stream start', () => {
    const r = computeFrameRotation({
      startAngle: 0, currentAngle: 0, srcW: 1080, srcH: 1920, devicePortrait: true,
    });
    expect(r).toBe(0);
  });

  it('no correction when the browser already adapted the stream', () => {
    // Geraet wurde gedreht, aber der Frame ist bereits quer -> Browser hat angepasst
    const r = computeFrameRotation({
      startAngle: 0, currentAngle: 90, srcW: 1920, srcH: 1080, devicePortrait: false,
    });
    expect(r).toBe(0);
  });

  it('corrects a frozen stream after rotating portrait -> landscape', () => {
    // Stream in Hochkant gestartet (liefert weiter 1080x1920), Geraet jetzt quer
    const r = computeFrameRotation({
      startAngle: 0, currentAngle: 90, srcW: 1080, srcH: 1920, devicePortrait: false,
    });
    expect(r).toBe(90);
  });

  it('corrects the opposite rotation direction with 270 degrees', () => {
    const r = computeFrameRotation({
      startAngle: 0, currentAngle: 270, srcW: 1080, srcH: 1920, devicePortrait: false,
    });
    expect(r).toBe(270);
  });

  it('corrects a frozen stream after rotating landscape -> portrait', () => {
    // Stream quer gestartet (Winkel 90), Geraet zurueck auf aufrecht (0)
    const r = computeFrameRotation({
      startAngle: 90, currentAngle: 0, srcW: 1920, srcH: 1080, devicePortrait: true,
    });
    expect(r).toBe(270);
  });

  it('ignores 180 degree flips (not detectable via dimensions)', () => {
    const r = computeFrameRotation({
      startAngle: 0, currentAngle: 180, srcW: 1080, srcH: 1920, devicePortrait: true,
    });
    expect(r).toBe(0);
  });

  it('applies the correction for square frames (orientation not decidable)', () => {
    const r = computeFrameRotation({
      startAngle: 0, currentAngle: 90, srcW: 1000, srcH: 1000, devicePortrait: false,
    });
    expect(r).toBe(90);
  });
});
