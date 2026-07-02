import { describe, it, expect } from 'vitest';
import { computeCaptureSize } from './useCameraCapture';

const M = { long: 1280, short: 720 };
const S = { long: 640, short: 360 };
const XL = { long: 2560, short: 1440 };

describe('computeCaptureSize', () => {
  it('keeps landscape orientation for a landscape source', () => {
    const out = computeCaptureSize(1920, 1080, M);
    expect(out).toEqual({ width: 1280, height: 720 });
  });

  it('keeps portrait orientation for a portrait source', () => {
    const out = computeCaptureSize(1080, 1920, M);
    expect(out).toEqual({ width: 720, height: 1280 });
  });

  it('preserves non-16:9 aspect ratios instead of cropping', () => {
    // 4:3 sensor frame - short edge binds, aspect stays 4:3
    const out = computeCaptureSize(2048, 1536, M);
    expect(out).toEqual({ width: 960, height: 720 });
    expect(out.width / out.height).toBeCloseTo(2048 / 1536, 5);
  });

  it('never upscales small sources', () => {
    expect(computeCaptureSize(640, 480, XL)).toEqual({ width: 640, height: 480 });
  });

  it('handles square sources via the short-edge bound', () => {
    expect(computeCaptureSize(1000, 1000, S)).toEqual({ width: 360, height: 360 });
  });
});
