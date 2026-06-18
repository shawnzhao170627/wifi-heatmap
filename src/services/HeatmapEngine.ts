import type { WifiSample, HeatmapCell, FloorPlan, Room } from '../types';

const GRID_SPACING_CM = 25; // 25cm per cell
const IDW_POWER = 2; // inverse distance squared
const MAX_SEARCH_RADIUS_CM = 500; // max distance to consider a sample
const MIN_SAMPLES_FOR_VALID_CELL = 2;

/**
 * Build a grid of HeatmapCells covering all rooms in the floor plan.
 */
export function buildGrid(plan: FloorPlan): HeatmapCell[] {
  if (plan.rooms.length === 0) return [];

  const bounds = getBoundingBox(plan.rooms);
  const cells: HeatmapCell[] = [];

  for (
    let cx = bounds.minX + GRID_SPACING_CM / 2;
    cx <= bounds.maxX;
    cx += GRID_SPACING_CM
  ) {
    for (
      let cy = bounds.minY + GRID_SPACING_CM / 2;
      cy <= bounds.maxY;
      cy += GRID_SPACING_CM
    ) {
      // Only include cells that fall within a room
      if (isInAnyRoom(cx, cy, plan.rooms)) {
        cells.push({
          x: cx,
          y: cy,
          rssi: -100,
          sampleCount: 0,
        });
      }
    }
  }

  return cells;
}

/**
 * Compute interpolated RSSI for each cell using IDW.
 * Optionally apply wall attenuation for each sample.
 */
export function interpolate(
  cells: HeatmapCell[],
  samples: WifiSample[],
): HeatmapCell[] {
  if (samples.length === 0) return cells;

  return cells.map((cell) => {
    let weightedSum = 0;
    let weightSum = 0;
    let count = 0;

    for (const s of samples) {
      const dist = distance(cell.x, cell.y, s.x, s.y);
      if (dist < 1) {
        // Exact match — sample is at this cell
        return { ...cell, rssi: s.rssi, sampleCount: 1 };
      }
      if (dist > MAX_SEARCH_RADIUS_CM) continue;

      const w = 1 / Math.pow(dist, IDW_POWER);
      weightedSum += w * s.rssi;
      weightSum += w;
      count++;
    }

    if (count < MIN_SAMPLES_FOR_VALID_CELL) {
      return cell; // keep default
    }

    return {
      ...cell,
      rssi: Math.round(weightedSum / weightSum),
      sampleCount: count,
    };
  });
}

/**
 * Map RSSI value to an RGBA color for heatmap rendering.
 * -30 dBm (best) → Green; -90 dBm (worst) → Red
 */
export function rssiToColor(rssi: number): [number, number, number, number] {
  const clamped = Math.max(-90, Math.min(-30, rssi));
  const t = (-clamped - 30) / 60; // 0 = best (-30dBm, green), 1 = worst (-90dBm, red)

  if (t < 0.5) {
    // Green → Yellow
    const s = t * 2;
    return [Math.round(s * 255), 220, 40, 180];
  } else {
    // Yellow → Red
    const s = (t - 0.5) * 2;
    return [255, Math.round(220 * (1 - s)), Math.round(40 * (1 - s)), 180];
  }
}

/**
 * Rssi category for legend display.
 */
export function rssiCategory(rssi: number): string {
  if (rssi >= -50) return '极强 (> -50 dBm)';
  if (rssi >= -65) return '强 (-50 ～ -65 dBm)';
  if (rssi >= -75) return '一般 (-65 ～ -75 dBm)';
  return '弱 (< -75 dBm)';
}

export function rssiCategoryColor(rssi: number): string {
  if (rssi >= -50) return '#00C853';
  if (rssi >= -65) return '#FFD600';
  if (rssi >= -75) return '#FF9100';
  return '#D50000';
}

// --- Helpers ---

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function isInAnyRoom(x: number, y: number, rooms: Room[]): boolean {
  return rooms.some(
    (r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height,
  );
}

function getBoundingBox(rooms: Room[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const r of rooms) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }

  return { minX, minY, maxX, maxY };
}
