import {
  buildGrid,
  interpolate,
  rssiToColor,
  rssiCategory,
} from '../src/services/HeatmapEngine';

describe('buildGrid', () => {
  const plan = {
    id: 'p1',
    name: 'test',
    rooms: [
      { id: 'r1', name: '卧室', type: 'bedroom' as const, x: 0, y: 0, width: 300, height: 400 },
    ],
    routerPosition: null,
    walls: [],
    createdAt: 0,
    updatedAt: 0,
  };

  it('generates cells only inside rooms', () => {
    const cells = buildGrid(plan);
    expect(cells.length).toBeGreaterThan(0);
    // All cells should be within the single room
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(300);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(400);
    }
  });

  it('returns empty for no rooms', () => {
    const empty = buildGrid({ ...plan, rooms: [] });
    expect(empty).toEqual([]);
  });
});

describe('interpolate', () => {
  const cells = [
    { x: 25, y: 25, rssi: -100, sampleCount: 0 },
    { x: 75, y: 75, rssi: -100, sampleCount: 0 },
    { x: 125, y: 125, rssi: -100, sampleCount: 0 },
  ];

  it('interpolates from nearby samples', () => {
    const samples = [
      { x: 25, y: 25, rssi: -40, timestamp: 0, ssid: 'wifi', bssid: 'aa', frequency: 2400, positionConfidence: 'manual' as const },
    ];
    const result = interpolate(cells, samples);
    // Exact match
    expect(result[0].rssi).toBe(-40);
    expect(result[0].sampleCount).toBe(1);
    // Nearby cells get interpolated values
    expect(result[1].rssi).toBeLessThan(-40);
  });

  it('returns original cells when no samples', () => {
    const result = interpolate(cells, []);
    expect(result).toEqual(cells);
  });

  it('IDW weights closer samples more heavily', () => {
    const samples = [
      { x: 25, y: 25, rssi: -30, timestamp: 0, ssid: 'w', bssid: 'b1', frequency: 2400, positionConfidence: 'manual' as const },
      { x: 5000, y: 5000, rssi: -90, timestamp: 0, ssid: 'w', bssid: 'b2', frequency: 2400, positionConfidence: 'manual' as const },
    ];
    const result = interpolate(cells, samples);
    // Cell at (25,25) should be very close to -30
    expect(result[0].rssi).toBeGreaterThan(-33);
  });
});

describe('rssiToColor', () => {
  it('maps strong signal to green (R=0, G=220, B=40)', () => {
    const [r, g, b] = rssiToColor(-30);
    expect(r).toBe(0);
    expect(g).toBe(220);
    expect(b).toBe(40);
  });

  it('maps weak signal to red (R=255, G=0, B=0)', () => {
    const [r, g, b] = rssiToColor(-90);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it('clamps out of range values', () => {
    const best = rssiToColor(-10); // should clamp to -30 → green
    const worst = rssiToColor(-100); // should clamp to -90 → red
    expect(best[1]).toBe(220); // green
    expect(worst[0]).toBe(255); // red
    expect(worst[1]).toBe(0);
  });
});

describe('rssiCategory', () => {
  it('classifies signal levels correctly', () => {
    expect(rssiCategory(-40)).toContain('极强');
    expect(rssiCategory(-60)).toContain('强');
    expect(rssiCategory(-70)).toContain('一般');
    expect(rssiCategory(-80)).toContain('弱');
  });
});
