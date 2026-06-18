export interface Room {
  id: string;
  name: string;
  type: RoomType;
  x: number; // cm from origin
  y: number; // cm from origin
  width: number; // cm
  height: number; // cm
}

export type RoomType =
  | 'bedroom'
  | 'living'
  | 'kitchen'
  | 'bathroom'
  | 'corridor'
  | 'study'
  | 'balcony'
  | 'other';

export interface RouterPosition {
  x: number; // cm
  y: number; // cm
  roomId: string;
}

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  material: 'brick' | 'concrete' | 'drywall' | 'glass' | 'wood';
  attenuation: number; // dB loss
}

export interface FloorPlan {
  id: string;
  name: string;
  rooms: Room[];
  routerPosition: RouterPosition | null;
  walls: WallSegment[];
  createdAt: number;
  updatedAt: number;
}

export interface WifiSample {
  timestamp: number;
  x: number; // cm, from PDR or manual input
  y: number;
  ssid: string;
  bssid: string;
  rssi: number; // dBm
  frequency: number; // MHz, 2400 or 5000
  positionConfidence: 'manual' | 'pdr_high' | 'pdr_low' | 'auto_calibrated';
}

export interface HeatmapCell {
  x: number; // cm, center of cell
  y: number;
  rssi: number; // interpolated dBm
  sampleCount: number; // nearby samples used for interpolation
}

export interface Project {
  id: string;
  name: string;
  floorPlan: FloorPlan;
  samples: WifiSample[];
  heatmap: HeatmapCell[];
  createdAt: number;
  updatedAt: number;
}

export type ScanStatus = 'idle' | 'scanning' | 'paused';

export interface CalibrationPoint {
  x: number;
  y: number;
  heading: number; // radians, 0 = right
  timestamp: number;
}

export interface ScanSession {
  status: ScanStatus;
  startTime: number | null;
  currentPosition: { x: number; y: number } | null;
  currentHeading: number; // radians
  stepCount: number;
  calibrationPoints: CalibrationPoint[];
  lastSampleTime: number | null;
}
