import { Platform, PermissionsAndroid } from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import type { WifiSample } from '../types';

export interface WifiScanResult {
  ssid: string;
  bssid: string;
  rssi: number;
  frequency: number;
}

const SCAN_INTERVAL_MS = 30000; // Full scan only every 30s (Android throttle: 4 per 2 min)
const RSSI_REFRESH_MS = 2000; // Connected RSSI refresh interval

/**
 * WiFi 信号采集器。
 *
 * Android 9+ 限制前台 App 每 2 分钟只能发起 4 次系统级扫描。
 * 因此设计为：每 2 秒用 getCurrentSignalStrength() 获取当前连接 WiFi 的 RSSI（无限制），
 * 每 30 秒进行一次完整周边 AP 扫描。
 */
export class WifiScanner {
  private lastScanTime = 0;
  private lastRssiRefreshTime = 0;
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

  /**
   * 主扫描方法。返回当前可获取的所有 WiFi AP 信息。
   * 高频调用时有智能节流：短间隔用当前连接 RSSI，长间隔做完整扫描。
   */
  async scan(): Promise<WifiScanResult[]> {
    const now = Date.now();

    // Every 2s: fast refresh from current connection (no throttle)
    if (now - this.lastRssiRefreshTime >= RSSI_REFRESH_MS) {
      const fastRssi = await this.getConnectedRssi();
      this.lastRssiRefreshTime = now;

      // Full scan every 30s (within Android throttle limit)
      if (now - this.lastScanTime >= SCAN_INTERVAL_MS) {
        this.lastScanTime = now;
        const full = await this.doFullScan();
        if (full.length > 0) {
          this.cachedFullResults = full;
        }
      }

      // Merge: connected RSSI + cached full scan results
      return this.mergeResults(fastRssi, this.cachedFullResults);
    }

    return [];
  }

  /**
   * 从当前连接的 WiFi 获取 RSSI（不受 Android 扫描频率限制）。
   */
  private async getConnectedRssi(): Promise<WifiScanResult | null> {
    try {
      const [ssid, rssi, bssid, freq] = await Promise.all([
        WifiManager.getCurrentWifiSSID().catch(() => ''),
        WifiManager.getCurrentSignalStrength().catch(() => NaN),
        WifiManager.getBSSID().catch(() => ''),
        WifiManager.getFrequency().catch(() => 2400),
      ]);
      if (ssid && !isNaN(rssi) && rssi > -100 && rssi < 0) {
        return {
          ssid,
          bssid,
          rssi: typeof rssi === 'number' ? rssi : Number(rssi),
          frequency: typeof freq === 'number' ? freq : Number(freq) || 2400,
        };
      }
    } catch {}
    return null;
  }

  /**
   * 完整周边 AP 扫描。注意 Android 频率限制（4次/2分钟）。
   */
  private async doFullScan(): Promise<WifiScanResult[]> {
    const parsed: WifiScanResult[] = [];

    try {
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
        if (isNaN(rssi)) {
          rssi = Number((r as any).rssi ?? NaN);
        }
        if (isNaN(rssi) || rssi < -100 || rssi > -10) continue;

        const ssid = ((r as any).SSID ?? (r as any).ssid ?? '').trim();
        const bssid = (r as any).BSSID ?? (r as any).bssid ?? '';
        const frequency = Number((r as any).frequency ?? 2400);

        parsed.push({ ssid: ssid || '(unknown)', bssid, rssi, frequency });
      }
    } catch (err) {
      console.warn('Full scan failed:', String(err));
    }

    parsed.sort((a, b) => b.rssi - a.rssi);
    return parsed;
  }

  /**
   * 合并 fast RSSI 和缓存的全扫描结果。
   * 当前连接的 AP 项会被 fast RSSI 的值覆盖（更实时）。
   */
  private mergeResults(
    current: WifiScanResult | null,
    cached: WifiScanResult[],
  ): WifiScanResult[] {
    const merged = new Map<string, WifiScanResult>();

    // Add cached full scan results
    for (const r of cached) {
      merged.set(r.bssid || r.ssid, r);
    }

    // Override with current connection
    if (current) {
      const key = current.bssid || current.ssid;
      merged.set(key, current);
    }

    const result = Array.from(merged.values());
    result.sort((a, b) => b.rssi - a.rssi);
    return result;
  }

  createSamples(
    scanResults: WifiScanResult[],
    x: number,
    y: number,
    confidence: WifiSample['positionConfidence'] = 'pdr_high',
  ): WifiSample[] {
    const now = Date.now();
    return scanResults
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
