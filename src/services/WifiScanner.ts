import { Platform, PermissionsAndroid, Alert } from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import type { WifiSample } from '../types';

export interface WifiScanResult {
  ssid: string;
  bssid: string;
  rssi: number; // dBm
  frequency: number; // MHz
}

const MIN_SCAN_INTERVAL_MS = 2000;
const RSSI_JUMP_THRESHOLD_DB = 20; // flag outliers that jump too much from previous

export class WifiScanner {
  private lastScanTime = 0;
  private lastRssi: Map<string, number> = new Map(); // BSSID -> last RSSI

  async requestPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;

    try {
      // Android 9+ requires fine location for WiFi scanning
      const apiLevel = Platform.Version;
      if (typeof apiLevel === 'number' && apiLevel >= 29) {
        const granted = await PermissionsAndroid.request(
          'android.permission.ACCESS_FINE_LOCATION' as any,
          {
            title: '位置权限',
            message: 'WiFi信号扫描需要获取位置权限（Android系统要求）',
            buttonPositive: '允许',
            buttonNegative: '拒绝',
          },
        );
        return granted === 'granted';
      }

      // Older Android: coarse location may suffice
      const granted = await PermissionsAndroid.request(
        'android.permission.ACCESS_COARSE_LOCATION' as any,
        {
          title: '位置权限',
          message: 'WiFi信号扫描需要获取位置权限',
          buttonPositive: '允许',
          buttonNegative: '拒绝',
        },
      );
      return granted === 'granted';
    } catch (err) {
      console.warn('Permission request failed:', err);
      return false;
    }
  }

  /**
   * Perform a single WiFi scan. Returns nearby AP info.
   */
  async scan(): Promise<WifiScanResult[]> {
    const now = Date.now();
    if (now - this.lastScanTime < MIN_SCAN_INTERVAL_MS) {
      return []; // throttle
    }
    this.lastScanTime = now;

    try {
      const results = await WifiManager.loadWifiList();
      const parsed: WifiScanResult[] = [];

      if (Array.isArray(results)) {
        for (const r of results) {
          const rssi = Number((r as any).level ?? (r as any).rssi ?? -100);
          const bssid = (r as any).BSSID ?? (r as any).bssid ?? 'unknown';
          const ssid = (r as any).SSID ?? (r as any).ssid ?? 'hidden';
          const frequency = Number(r.frequency ?? 2400);

          // Outlier detection
          const prev = this.lastRssi.get(bssid);
          if (prev !== undefined && Math.abs(rssi - prev) > RSSI_JUMP_THRESHOLD_DB) {
            // Mark as lower confidence but still include
            console.log(
              `RSSI jump detected for ${ssid}: ${prev} → ${rssi} dBm`,
            );
          }
          this.lastRssi.set(bssid, rssi);

          if (!isNaN(rssi)) {
            parsed.push({
              ssid,
              bssid,
              rssi,
              frequency,
            });
          }
        }
      }

      return parsed;
    } catch (err) {
      console.warn('WiFi scan failed:', err);
      return [];
    }
  }

  /**
   * Create a WifiSample at the given position using scan results.
   * Focuses on the connected/strongest network.
   */
  createSamples(
    scanResults: WifiScanResult[],
    x: number,
    y: number,
    confidence: WifiSample['positionConfidence'] = 'manual',
  ): WifiSample[] {
    const now = Date.now();
    return scanResults
      .filter((r) => r.ssid && r.ssid !== 'hidden')
      .map((r) => ({
        timestamp: now,
        x,
        y,
        ssid: r.ssid,
        bssid: r.bssid,
        rssi: r.rssi,
        frequency: r.frequency,
        positionConfidence: confidence,
      }));
  }
}
