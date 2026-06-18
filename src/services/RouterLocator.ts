import type { WifiSample } from '../types';

export interface RouterEstimate {
  x: number; // cm, estimated router position
  y: number;
  confidence: 'high' | 'medium' | 'low';
  rssiAt1m: number; // estimated RSSI at 1 meter (dBm)
  pathLossExponent: number; // environmental path loss exponent
  coverageRadius: number; // cm, estimated coverage radius (RSSI >= -75 dBm)
}

/**
 * Estimate router position from walking samples.
 *
 * Algorithm:
 *  1. Weighted centroid of top-30% strongest RSSI points → initial guess
 *  2. Classic path loss model: RSSI = RSSI_0 - 10*n*log10(d/d0)
 *     where d0 = 1m (100cm), RSSI_0 ≈ -30 dBm (typical at 1m)
 *  3. For each sample: d_estimated = 10^((RSSI_0 - RSSI) / (10*n))
 *  4. Weighted centroid of samples within reasonable range → final position
 *  5. Fit n from the data, estimate coverage radius
 */
export function locateRouter(samples: WifiSample[]): RouterEstimate | null {
  if (samples.length < 5) return null;

  const valid = samples.filter((s) => s.rssi >= -90 && s.rssi <= -10);
  if (valid.length < 5) return null;

  // --- Step 1: Top-K weighted centroid ---
  const sorted = [...valid].sort((a, b) => b.rssi - a.rssi);
  const topK = sorted.slice(0, Math.max(5, Math.ceil(sorted.length * 0.3)));

  // Weight each point by exp((rssi - minRssi) / 10) — stronger signal = more weight
  const minRssi = topK[topK.length - 1].rssi;
  let weightSum = 0;
  let cx = 0;
  let cy = 0;

  for (const s of topK) {
    // Ensure non-negative weight
    const w = Math.exp((s.rssi - minRssi) / 10);
    cx += s.x * w;
    cy += s.y * w;
    weightSum += w;
  }

  const initialX = cx / weightSum;
  const initialY = cy / weightSum;

  // --- Step 2: Estimate RSSI at 1m (RSSI_0) ---
  // Compute distances from initial guess
  const distances = valid.map((s) => ({
    d: Math.max(50, Math.sqrt((s.x - initialX) ** 2 + (s.y - initialY) ** 2)), // min 50cm
    rssi: s.rssi,
  }));

  // Linear regression: RSSI = RSSI_0 - 10*n*log10(d/100)
  // Let y = RSSI, x = 10*log10(d/100)
  // y = RSSI_0 - n*x
  // We need pairs where we can fit

  const pairs = distances.map(({ d, rssi }) => ({
    x: 10 * Math.log10(d / 100), // normalized to 1m reference
    y: rssi,
  }));

  const n = pairs.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of pairs) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (Math.abs(denominator) < 1e-6) {
    // Degenerate — fallback to simple centroid
    return {
      x: Math.round(initialX),
      y: Math.round(initialY),
      confidence: 'low',
      rssiAt1m: -35,
      pathLossExponent: 2.5,
      coverageRadius: estimateCoverageRadius(initialX, initialY, valid),
    };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  const pathLossExponent = Math.max(1.5, Math.min(5, -slope)); // clamp to reasonable range
  const rssiAt1m = Math.max(-50, Math.min(-20, intercept)); // clamp typical router range

  // --- Step 3: Refined position using fitted model ---
  // For each sample, compute estimated distance from fitted model
  // Then find the point that best satisfies all distance constraints

  const estimates: { x: number; y: number; weight: number }[] = [];
  for (const s of valid) {
    // Estimated distance from sample to router
    const dEst = 100 * Math.pow(10, (rssiAt1m - s.rssi) / (10 * pathLossExponent));
    // Clamp to reasonable range (0.5m to 20m)
    const dClamped = Math.max(50, Math.min(2000, dEst));

    // This sample says: router is likely within a circle of radius dClamped around (s.x, s.y)
    // Weight by signal strength confidence
    const w = Math.exp((s.rssi - minRssi) / 15);
    estimates.push({
      x: s.x,
      y: s.y,
      weight: w / dClamped, // closer samples with stronger signal get more weight
    });
  }

  // Weighted median-like: redo centroid of estimates
  let w2 = 0, rx = 0, ry = 0;
  for (const e of estimates) {
    rx += e.x * e.weight;
    ry += e.y * e.weight;
    w2 += e.weight;
  }

  const finalX = w2 > 0 ? rx / w2 : initialX;
  const finalY = w2 > 0 ? ry / w2 : initialY;

  // --- Step 4: Confidence ---
  const topRssi = topK[0].rssi;
  let confidence: RouterEstimate['confidence'] = 'medium';
  if (topRssi >= -40 && topK.length >= 8 &&
      pathLossExponent >= 1.8 && pathLossExponent <= 4) {
    confidence = 'high';
  } else if (topK.length < 6 || pathLossExponent < 1.5 || pathLossExponent > 4.5) {
    confidence = 'low';
  }

  const coverageRadius = estimateCoverageRadius(finalX, finalY, valid);

  return {
    x: Math.round(finalX),
    y: Math.round(finalY),
    confidence,
    rssiAt1m: Math.round(rssiAt1m),
    pathLossExponent: Math.round(pathLossExponent * 10) / 10,
    coverageRadius,
  };
}

/**
 * Estimate coverage radius: the max distance where RSSI >= -75 dBm.
 * Uses a simple exponential fit on RSSI vs distance.
 */
function estimateCoverageRadius(
  rx: number, ry: number, samples: WifiSample[],
): number {
  if (samples.length < 5) return 500;

  // Find max distance from estimated router where RSSI is still >= -75
  let maxGood = 0;
  let maxAny = 0;
  for (const s of samples) {
    const d = Math.sqrt((s.x - rx) ** 2 + (s.y - ry) ** 2);
    if (d > maxAny) maxAny = d;
    if (s.rssi >= -75 && d > maxGood) maxGood = d;
  }

  // If we covered very little area, extrapolate based on farest sample
  if (maxGood < 100 && maxAny > 0) {
    // Use simple interpolation: RSSI drops ~20dB per distance doubling
    // from strongest sample to -75 threshold
    const strongest = samples.reduce((a, b) => (a.rssi > b.rssi ? a : b));
    const dStrong = Math.max(
      50,
      Math.sqrt((strongest.x - rx) ** 2 + (strongest.y - ry) ** 2),
    );
    // Estimate: RSSI(x) ≈ RSSI_strong - 20*log2(d/d_strong)
    // -75 = RSSI_strong - 20*log2(dmax/d_strong)
    const ratio = Math.pow(2, (strongest.rssi + 75) / 20);
    maxGood = Math.round(dStrong * ratio);
  }

  return Math.max(100, Math.round(maxGood));
}
