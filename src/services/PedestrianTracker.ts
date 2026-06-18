import {
  accelerometer,
  gyroscope,
  setUpdateIntervalForType,
  SensorTypes,
} from 'react-native-sensors';
import { type Subscription } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PDRState {
  x: number;
  y: number;
  heading: number;
  stepCount: number;
}

// Real adult step: 50-80cm. Default 65cm.
const STEP_LENGTH_CM = 65;

// Lowered threshold: The raw acceleration magnitude from the phone
// (including gravity) is about 9.8 at rest. Steps cause spikes to ~10.5-12.
// Setting threshold to 10.8 catches most steps on average phones.
const STEP_THRESHOLD = 10.8;

// Minimum 200ms between steps (max 5 steps/sec)
const STEP_COOLDOWN_MS = 200;

// ~30 Hz for both sensors
const SENSOR_INTERVAL_MS = 33;

export class PedestrianTracker {
  private accelSub: Subscription | null = null;
  private gyroSub: Subscription | null = null;
  private state: PDRState;
  private lastStepTime = 0;
  private listeners: Array<(state: PDRState) => void> = [];
  private started = false;

  constructor(initialX = 0, initialY = 0, initialHeading = 0) {
    this.state = {
      x: initialX,
      y: initialY,
      heading: initialHeading,
      stepCount: 0,
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    try {
      setUpdateIntervalForType(SensorTypes.accelerometer, SENSOR_INTERVAL_MS);
      setUpdateIntervalForType(SensorTypes.gyroscope, SENSOR_INTERVAL_MS);
    } catch (e) {
      // Ignore — default rate will be used
    }

    try {
      this.accelSub = accelerometer
        .pipe(
          map(({ x, y, z }: any) => ({
            ax: x,
            ay: y,
            az: z,
            timestamp: Date.now(),
          })),
        )
        .subscribe({
          next: (data) => this.processAccel(data),
          error: () => {
            // Sensor not available — silently degrade
          },
        });
    } catch (e) {
      // Sensor init failed
    }

    try {
      this.gyroSub = gyroscope
        .pipe(
          map(({ x, y, z }: any) => ({
            x,
            y,
            z,
            timestamp: Date.now(),
          })),
        )
        .subscribe({
          next: (gyro) => this.processGyro(gyro),
          error: () => {
            // Sensor not available — silently degrade
          },
        });
    } catch (e) {
      // Sensor init failed
    }
  }

  stop(): void {
    this.started = false;
    try {
      this.accelSub?.unsubscribe();
      this.gyroSub?.unsubscribe();
    } catch {}
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
    // Magnitude of raw accelerometer (includes gravity)
    const magnitude = Math.sqrt(
      data.ax * data.ax + data.ay * data.ay + data.az * data.az,
    );

    if (
      magnitude > STEP_THRESHOLD &&
      data.timestamp - this.lastStepTime > STEP_COOLDOWN_MS
    ) {
      this.lastStepTime = data.timestamp;
      this.state.stepCount += 1;

      const rad = this.state.heading;
      this.state.x += STEP_LENGTH_CM * Math.cos(rad);
      this.state.y += STEP_LENGTH_CM * Math.sin(rad);

      this.notify();
    }
  }

  private processGyro(data: { x: number; y: number; z: number; timestamp: number }): void {
    // Integrate Z-axis gyro for heading change
    // Use lower threshold (0.005 rad/s) so subtle turning is detected
    const threshold = 0.005;
    if (Math.abs(data.z) > threshold) {
      this.state.heading += data.z * (SENSOR_INTERVAL_MS / 1000);
      while (this.state.heading > Math.PI) this.state.heading -= 2 * Math.PI;
      while (this.state.heading < -Math.PI) this.state.heading += 2 * Math.PI;
    }
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((fn) => fn(state));
  }
}
