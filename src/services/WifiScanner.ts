import { Platform, PermissionsAndroid } from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import type { WifiSample } from '../types';

export interface WifiScanResult {
  ssid: string;
  bssid: string;
  rssi: number;
  frequency: number;
}

/** Debug log ring buffer — visible in UI when results aren't flowing */
export let debugLog: string[] = [];
function log(msg: string) {
  const line = `${new Date().toLocaleTimeString()} ${msg}`;
  debugLog.push(line);
  if (debugLog.length > 20) debugLog.shift();
  console.log('[WifiScanner]', line);
}

const FULL_SCAN_INTERVAL_MS = 30000;

export class WifiScanner {
  private lastFullScanTime = 0;
  private cachedFullResults: WifiScanResult[] = [];

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
        log(`location permission: ${granted}`);
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
      log(`location permission: ${granted}`);
      return granted === 'granted';
    } catch (err: any) {
      log(`permission error: ${err?.message || String(err)}`);
      return false;
    }
  }

  /**
   * Called every 2s by the scanner screen timer.
   * Returns zero or more WiFi scan results.
   */
  async scan(): Promise<WifiScanResult[]> {
    const now = Date.now();
    const results: WifiScanResult[] = [];

    // 1. Fast RSSI from current connection (works every call, no Android throttle)
    try {
      const conn = await this.getConnectedRssi();
      if (conn) {
        results.push(conn);
      }
    } catch (err: any) {
      log(`connected rssi error: ${err?.message || String(err)}`);
    }

    // 2. Full scan every 30s
    if (now - this.lastFullScanTime >= FULL_SCAN_INTERVAL_MS) {
      this.lastFullScanTime = now;
      try {
        const full = await this.doFullScan();
        if (full.length > 0) {
          this.cachedFullResults = full;
          log(`full scan: ${full.length} APs`);
        }
      } catch (err: any) {
        log(`full scan error: ${err?.message || String(err)}`);
      }
    }

    // 3. Merge: connection RSSI + cached full scan
    const merged = this.mergeResults(results, this.cachedFullResults);
    if (merged.length === 0) {
      log('scan: 0 results');
    }
    return merged;
  }

  private async getConnectedRssi(): Promise<WifiScanResult | null> {
    // try each call individually — Promise.all fails if any one throws
    let ssid = '';
    let rssiRaw: any = NaN;
    let bssid = '';
    let freqRaw: any = NaN;

    try { ssid = await WifiManager.getCurrentWifiSSID(); } catch (e) {}
    try { rssiRaw = await WifiManager.getCurrentSignalStrength(); } catch (e) {}
    try { bssid = await WifiManager.getBSSID(); } catch (e) {}
    try { freqRaw = await WifiManager.getFrequency(); } catch (e) {}

    const rssi = typeof rssiRaw === 'number' ? rssiRaw : Number(rssiRaw);
    const frequency = typeof freqRaw === 'number' ? freqRaw : Number(freqRaw) || 2400;

    // Huawei: getCurrentSignalStrength() can return RSSI as 0-4 bars, or level 0-100, or raw dBm.
    // Normalise: if value is 0-4 => map to dBm; if 0-100 => map; if negative => use as-is dBm.
    let rssiNorm = NaN;
    if (!isNaN(rssi)) {
      if (rssi >= -100 && rssi < 0) {
        rssiNorm = rssi; // already valid dBm
      } else if (rssi >= 0 && rssi <= 4) {
        // 0-4 bars → approximate dBm
        rssiNorm = [-90, -75, -60, -50, -35][Math.round(rssi)] ?? -75;
      } else if (rssi >= 0 && rssi <= 100) {
        // 0-100 RSSI level → map to dBm
        rssiNorm = -100 + rssi;
      }
    }

    log(`conn raw: ssid="${ssid}" rssi=${rssi}→${rssiNorm} bssid="${bssid}" freq=${frequency}`);

    if (!isNaN(rssiNorm) && rssiNorm < 0 && rssiNorm >= -100) {
      return {
        ssid: ssid || '(connected)',
        bssid: bssid || '',
        rssi: rssiNorm,
        frequency: frequency > 0 ? frequency : 2400,
      };
    }
    return null;
  }

  private async doFullScan(): Promise<WifiScanResult[]> {
    const parsed: WifiScanResult[] = [];
    let raw: any[] = [];

    try {
      raw = (await WifiManager.reScanAndLoadWifiList()) as any[];
    } catch {
      try {
        raw = (await WifiManager.loadWifiList()) as any[];
      } catch {
        return parsed;
      }
    }

    if (!Array.isArray(raw)) return parsed;

    for (const r of raw) {
      const level = (r as any).level;
      let rssi = typeof level === 'number' ? level : NaN;
      if (isNaN(rssi)) rssi = Number((r as any).rssi ?? NaN);
      if (isNaN(rssi) || rssi < -100 || rssi > -10) continue;

      const ssid = ((r as any).SSID ?? (r as any).ssid ?? '').trim();
      parsed.push({
        ssid: ssid || '(unknown)',
        bssid: (r as any).BSSID ?? (r as any).bssid ?? '',
        rssi,
        frequency: Number((r as any).frequency ?? 2400),
      });
    }

    parsed.sort((a, b) => b.rssi - a.rssi);
    return parsed;
  }

  private mergeResults(conn: WifiScanResult[], cached: WifiScanResult[]): WifiScanResult[] {
    const map = new Map<string, WifiScanResult>();
    for (const r of cached) map.set(r.bssid || r.ssid, r);
    for (const r of conn) map.set(r.bssid || r.ssid, r);
    const result = Array.from(map.values());
    result.sort((a, b) => b.rssi - a.rssi);
    return result;
  }

  createSamples(
    results: WifiScanResult[],
    x: number,
    y: number,
    confidence: WifiSample['positionConfidence'] = 'pdr_high',
  ): WifiSample[] {
    const now = Date.now();
    return results
      .filter((r) => !isNaN(r.rssi) && r.rssi > -100 && r.rssi <= -10)
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
