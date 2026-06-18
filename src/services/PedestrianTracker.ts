import {
  accelerometer,
  gyroscope,
  setUpdateIntervalForType,
  SensorTypes,
} from 'react-native-sensors';
import { type Observable, Subscription } from 'rxjs';
import { map, filter } from 'rxjs/operators';

export interface IMUData {
  ax: number; // m/s²
  ay: number;
  az: number;
  gx: number; // rad/s
  gy: number;
  gz: number;
  timestamp: number;
}

export interface StepEvent {
  timestamp: number;
}

export interface PDRState {
  x: number; // cm, current position
  y: number;
  heading: number; // radians, 0 = right/positive X
  stepCount: number;
}

const STEP_LENGTH_CM = 65; // average adult step length
const STEP_THRESHOLD = 11.5; // acceleration magnitude threshold for step detection (m/s²)
const STEP_COOLDOWN_MS = 250; // minimum time between steps
const ACCEL_UPDATE_INTERVAL = 20; // ms, ~50Hz
const GYRO_UPDATE_INTERVAL = 20; // ms

export class PedestrianTracker {
  private accelSub: Subscription | null = null;
  private gyroSub: Subscription | null = null;
  private state: PDRState;
  private lastStepTime = 0;
  private listeners: Array<(state: PDRState) => void> = [];

  constructor(initialX = 0, initialY = 0, initialHeading = 0) {
    this.state = {
      x: initialX,
      y: initialY,
      heading: initialHeading,
      stepCount: 0,
    };
  }

  start(): void {
    setUpdateIntervalForType(SensorTypes.accelerometer, ACCEL_UPDATE_INTERVAL);
    setUpdateIntervalForType(SensorTypes.gyroscope, GYRO_UPDATE_INTERVAL);

    this.accelSub = accelerometer
      .pipe(
        map(({ x, y, z }) => ({
          ax: x,
          ay: y,
          az: z,
          timestamp: Date.now(),
        })),
      )
      .subscribe((data) => this.processAccel(data));

    this.gyroSub = gyroscope
      .pipe(
        map(({ x, y, z }) => ({
          x,
          y,
          z,
          timestamp: Date.now(),
        })),
      )
      .subscribe((gyro) => this.processGyro(gyro));
  }

  stop(): void {
    this.accelSub?.unsubscribe();
    this.gyroSub?.unsubscribe();
    this.accelSub = null;
    this.gyroSub = null;
  }

  getState(): PDRState {
    return { ...this.state };
  }

  setPosition(x: number, y: number, heading?: number): void {
    this.state.x = x;
    this.state.y = y;
    if (heading !== undefined) {
      this.state.heading = heading;
    }
    this.notify();
  }

  calibrate(x: number, y: number, heading: number): void {
    this.state.x = x;
    this.state.y = y;
    this.state.heading = heading;
    this.notify();
  }

  addListener(fn: (state: PDRState) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private processAccel(data: { ax: number; ay: number; az: number; timestamp: number }): void {
    const magnitude = Math.sqrt(
      data.ax * data.ax + data.ay * data.ay + data.az * data.az,
    );

    if (
      magnitude > STEP_THRESHOLD &&
      data.timestamp - this.lastStepTime > STEP_COOLDOWN_MS
    ) {
      this.lastStepTime = data.timestamp;
      this.state.stepCount += 1;

      // Update position based on heading
      const rad = this.state.heading;
      this.state.x += STEP_LENGTH_CM * Math.cos(rad);
      this.state.y += STEP_LENGTH_CM * Math.sin(rad);

      this.notify();
    }
  }

  private processGyro(data: { x: number; y: number; z: number; timestamp: number }): void {
    // Integrate Z-axis gyro for heading change
    // Apply high-pass filter: ignore very small rotations to reduce drift
    const threshold = 0.01; // rad/s
    if (Math.abs(data.z) > threshold) {
      this.state.heading += data.z * (GYRO_UPDATE_INTERVAL / 1000);
      // Normalize to [-π, π]
      while (this.state.heading > Math.PI) this.state.heading -= 2 * Math.PI;
      while (this.state.heading < -Math.PI) this.state.heading += 2 * Math.PI;
    }
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((fn) => fn(state));
  }
}
