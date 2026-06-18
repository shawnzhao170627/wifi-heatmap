import { Platform, PermissionsAndroid } from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import type { WifiSample } from '../types';

export interface WifiScanResult {
  ssid: string;
  bssid: string;
  rssi: number; // dBm
  frequency: number; // MHz
}

const MIN_SCAN_INTERVAL_MS = 1500;
const RSSI_JUMP_THRESHOLD_DB = 20;

export class WifiScanner {
  private lastScanTime = 0;
  private lastRssi: Map<string, number> = new Map();

  async requestPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;

    try {
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

  async scan(): Promise<WifiScanResult[]> {
    const now = Date.now();
    if (now - this.lastScanTime < MIN_SCAN_INTERVAL_MS) {
      return [];
    }
    this.lastScanTime = now;

    try {
      // reScanAndLoadWifiList forces a fresh system-level scan, then returns results.
      // On Huawei (EMUI), loadWifiList() alone returns stale cache.
      let results: any[] = [];
      try {
        results = await WifiManager.reScanAndLoadWifiList();
      } catch {
        // Fallback: some devices don't support reScan
        results = await WifiManager.loadWifiList();
      }

      return this.parseResults(results);
    } catch (err) {
      console.warn('WiFi scan failed:', err);
      return [];
    }
  }

  /**
   * Also get current connected WiFi info for additional context.
   */
  async getCurrentConnection(): Promise<{ ssid: string; bssid: string; rssi: number; frequency: number } | null> {
    try {
      const ssid = await WifiManager.getCurrentWifiSSID();
      const rssi = await WifiManager.getCurrentSignalStrength();
      const bssid = '';
      return { ssid: ssid || '', bssid, rssi: typeof rssi === 'number' ? rssi : -50, frequency: 2400 };
    } catch {
      return null;
    }
  }

  private parseResults(results: any[]): WifiScanResult[] {
    const parsed: WifiScanResult[] = [];

    if (!Array.isArray(results) || results.length === 0) return parsed;

    for (const r of results) {
      const level = (r as any).level;
      const rssi = typeof level === 'number' ? level : Number(level ?? -100);
      const bssid = (r as any).BSSID ?? (r as any).bssid ?? '';
      const ssid = (r as any).SSID ?? (r as any).ssid ?? '';
      const frequency = Number((r as any).frequency ?? 2400);

      if (isNaN(rssi) || rssi < -100 || rssi > 0) continue;

      // Check for sudden unrealistic jumps (outlier detection)
      const prev = this.lastRssi.get(bssid);
      if (prev !== undefined && Math.abs(rssi - prev) > RSSI_JUMP_THRESHOLD_DB) {
        console.log(`RSSI jump for ${ssid}: ${prev} → ${rssi} dBm`);
      }
      this.lastRssi.set(bssid, rssi);

      parsed.push({ ssid: ssid || '(hidden)', bssid, rssi, frequency });
    }

    // Sort by signal strength descending
    parsed.sort((a, b) => b.rssi - a.rssi);
    return parsed;
  }

  createSamples(
    scanResults: WifiScanResult[],
    x: number,
    y: number,
    confidence: WifiSample['positionConfidence'] = 'pdr_high',
  ): WifiSample[] {
    const now = Date.now();
    return scanResults
      .filter((r) => r.ssid && r.ssid !== '(hidden)')
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
