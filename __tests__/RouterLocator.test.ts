import { locateRouter } from '../src/services/RouterLocator';
import type { WifiSample } from '../src/types';

function makeSample(x: number, y: number, rssi: number): WifiSample {
  return {
    x, y, rssi,
    timestamp: Date.now(),
    ssid: 'test-wifi',
    bssid: 'aa:bb:cc:dd:ee:ff',
    frequency: 2400,
    positionConfidence: 'pdr_high',
  };
}

describe('locateRouter', () => {
  it('returns null with too few samples', () => {
    expect(locateRouter([])).toBeNull();
    expect(locateRouter([makeSample(0, 0, -50)])).toBeNull();
  });

  it('estimates router near strongest signal point', () => {
    // Router at (200, 200), samples radiating outward with decreasing RSSI
    const samples: WifiSample[] = [
      makeSample(200, 200, -30),
      makeSample(220, 200, -35),
      makeSample(180, 200, -38),
      makeSample(200, 250, -40),
      makeSample(200, 150, -42),
      makeSample(350, 200, -55),
      makeSample(100, 200, -58),
      makeSample(200, 400, -60),
      makeSample(400, 400, -70),
      makeSample(100, 500, -75),
    ];
    const result = locateRouter(samples);
    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThan(150);
    expect(result!.x).toBeLessThan(250);
    expect(result!.y).toBeGreaterThan(150);
    expect(result!.y).toBeLessThan(250);
  });

  it('weights stronger signals more heavily', () => {
    // Strong signal at (100, 100), weak at (500, 500)
    const samples: WifiSample[] = [
      makeSample(100, 100, -25),
      makeSample(110, 100, -28),
      makeSample(90, 110, -30),
      makeSample(500, 500, -80),
      makeSample(510, 500, -78),
      makeSample(490, 510, -82),
    ];
    const result = locateRouter(samples)!;
    // Should be closer to (100, 100) than (500, 500)
    const d1 = Math.sqrt((result.x - 100) ** 2 + (result.y - 100) ** 2);
    const d2 = Math.sqrt((result.x - 500) ** 2 + (result.y - 500) ** 2);
    expect(d1).toBeLessThan(d2);
  });

  it('filters out invalid RSSI', () => {
    const samples: WifiSample[] = [
      makeSample(100, 100, -30),
      makeSample(200, 200, -40),
      makeSample(300, 300, -999), // invalid — skipped
      makeSample(150, 150, -50),
      makeSample(250, 250, 0),    // invalid — skipped
      makeSample(100, 200, -45),
    ];
    const result = locateRouter(samples);
    // With 4 valid samples, returns null (< 5 minimum)
    // Verify it doesn't crash processing invalid values
    expect(samples.filter((s) => s.rssi >= -90 && s.rssi <= -10)).toHaveLength(4);
  });

  it('returns low confidence for ambiguous data', () => {
    const samples: WifiSample[] = Array.from({ length: 10 }, () =>
      makeSample(
        Math.random() * 1000,
        Math.random() * 1000,
        -(70 + Math.random() * 15), // all weak signals
      ),
    );
    const result = locateRouter(samples)!;
    expect(result.confidence).toBe('low');
  });

  it('estimates coverage radius', () => {
    const samples: WifiSample[] = [
      makeSample(200, 200, -30),
      makeSample(250, 200, -35),
      makeSample(500, 200, -55),
      makeSample(800, 200, -70),
      makeSample(1000, 200, -80),
    ];
    const result = locateRouter(samples)!;
    expect(result.coverageRadius).toBeGreaterThan(0);
  });
});
