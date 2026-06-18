import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
} from 'react-native';
import { Canvas, Path, Skia, Circle, Rect } from '@shopify/react-native-skia';
import { useStore } from '../store/useStore';
import { WifiScanner } from '../services/WifiScanner';
import { PedestrianTracker } from '../services/PedestrianTracker';
import { locateRouter } from '../services/RouterLocator';
import { rssiToColor } from '../services/HeatmapEngine';
import type { RouterPosition } from '../types';

const SCALE = 1.5;
const MAX_TRAIL = 500;

interface TrailPoint { x: number; y: number; rssi: number }

export default function WifiScannerScreen({ route, navigation }: any) {
  const { projectId } = route.params ?? {};
  const project = useStore(
    useCallback((s) => s.projects.find((p) => p.id === projectId) ?? null, [projectId]),
  );
  const updateFloorPlan = useStore((s) => s.updateFloorPlan);
  const scanSession = useStore((s) => s.scanSession);
  const updateScanSession = useStore((s) => s.updateScanSession);
  const resetScanSession = useStore((s) => s.resetScanSession);

  const [isScanning, setIsScanning] = useState(false);
  const [rssi, setRssi] = useState<number | null>(null);
  const [pdrPosition, setPdrPosition] = useState({ x: 0, y: 0, heading: 0, stepCount: 0 });
  const [estimatedRouter, setEstimatedRouter] = useState<{ x: number; y: number; confidence: string } | null>(null);
  const [trail, setTrail] = useState<TrailPoint[]>([]);

  const wifiRef = useRef(new WifiScanner());
  const pdrRef = useRef<PedestrianTracker | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const routerPos = project?.floorPlan.routerPosition;
  const plan = project?.floorPlan;
  const canvasW = Dimensions.get('window').width;
  const canvasH = Dimensions.get('window').height - 280;

  useEffect(() => {
    wifiRef.current.requestPermission().then((granted) => {
      if (granted) { doStartScan(); } else {
        Alert.alert('需要位置权限',
          'Android 系统要求获取位置权限才能扫描 WiFi 信号。\n\n请在系统设置中允许本应用获取「精确位置」。',
          [{ text: '稍后设置', onPress: () => navigation.goBack() }, { text: '重试', onPress: () => wifiRef.current.requestPermission() }]);
      }
    });
    return () => cleanup();
  }, []);

  useEffect(() => {
    if (isScanning && pdrRef.current) {
      return pdrRef.current.addListener((state) => {
        setPdrPosition({ x: state.x, y: state.y, heading: state.heading, stepCount: state.stepCount });
      });
    }
  }, [isScanning]);

  const doStartScan = useCallback(() => {
    const p = useStore.getState().projects.find((pr) => pr.id === projectId);
    if (!p) return;
    const rp = p.floorPlan.routerPosition;
    let startX = 200, startY = 200;
    if (rp) { startX = rp.x; startY = rp.y; }
    else if (p.floorPlan.rooms.length > 0) {
      startX = p.floorPlan.rooms[0].x + p.floorPlan.rooms[0].width / 2;
      startY = p.floorPlan.rooms[0].y + p.floorPlan.rooms[0].height / 2;
    }
    const tracker = pdrRef.current ?? new PedestrianTracker(startX, startY, 0);
    pdrRef.current = tracker;
    tracker.start();
    updateScanSession({ status: 'scanning', startTime: Date.now(), currentPosition: { x: startX, y: startY }, currentHeading: 0, stepCount: 0, lastSampleTime: null });
    setIsScanning(true);
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    scanTimerRef.current = setInterval(async () => {
      const results = await wifiRef.current.scan();
      const pdr = pdrRef.current?.getState();
      if (!pdr) return;
      const samples = wifiRef.current.createSamples(results, Math.round(pdr.x), Math.round(pdr.y), 'pdr_high');
      if (samples.length > 0) {
        const { addSamples: add, updateScanSession: upd } = useStore.getState();
        add(projectId, samples);
        const best = samples.reduce((a, b) => (a.rssi > b.rssi ? a : b));
        setRssi(best.rssi);
        // Append to trail — capped to MAX_TRAIL
        setTrail((prev) => {
          const next = [...prev, { x: pdr.x, y: pdr.y, rssi: best.rssi }];
          return next.length > MAX_TRAIL ? next.slice(-MAX_TRAIL) : next;
        });
        upd({ currentPosition: { x: pdr.x, y: pdr.y }, currentHeading: pdr.heading, stepCount: pdr.stepCount, lastSampleTime: Date.now() });
      }
    }, 2000);
  }, [projectId, updateScanSession]);

  const pauseScanning = useCallback(() => {
    pdrRef.current?.stop();
    if (scanTimerRef.current) { clearInterval(scanTimerRef.current); scanTimerRef.current = null; }
    setIsScanning(false);
    updateScanSession({ status: 'paused' });
  }, [updateScanSession]);

  const resumeScanning = useCallback(() => doStartScan(), [doStartScan]);

  const stopScanning = useCallback(() => {
    cleanup();
    resetScanSession();
    const p = useStore.getState().projects.find((pr) => pr.id === projectId);
    if (p && !p.floorPlan.routerPosition && p.samples.length >= 5) {
      const result = locateRouter(p.samples);
      if (result && plan) {
        let roomId = plan.rooms[0]?.id ?? '';
        for (const r of plan.rooms) {
          if (result.x >= r.x && result.x <= r.x + r.width && result.y >= r.y && result.y <= r.y + r.height) { roomId = r.id; break; }
        }
        updateFloorPlan(projectId, { ...plan, routerPosition: { x: result.x, y: result.y, roomId }, updatedAt: Date.now() });
      }
    }
    navigation.goBack();
  }, [projectId, plan, updateFloorPlan, resetScanSession, navigation]);

  const detectRouter = useCallback(() => {
    const p = useStore.getState().projects.find((pr) => pr.id === projectId);
    if (!p || !plan) return;
    if (p.samples.length < 5) { Alert.alert('采样点不足', `需要至少 5 个采样点，当前：${p.samples.length}。请先走一圈再试。`); return; }
    const result = locateRouter(p.samples);
    if (!result) { Alert.alert('无法定位', '信号数据不足以定位路由器，请在房间内多走几圈再试。'); return; }
    let roomId = plan.rooms[0]?.id ?? '';
    for (const r of plan.rooms) {
      if (result.x >= r.x && result.x <= r.x + r.width && result.y >= r.y && result.y <= r.y + r.height) { roomId = r.id; break; }
    }
    updateFloorPlan(projectId, { ...plan, routerPosition: { x: result.x, y: result.y, roomId } as RouterPosition, updatedAt: Date.now() });
    setEstimatedRouter({ x: result.x, y: result.y, confidence: result.confidence });
    Alert.alert('路由器已定位', `推测位置: (${Math.round(result.x)}, ${Math.round(result.y)}) cm\n置信度: ${result.confidence === 'high' ? '高' : result.confidence === 'medium' ? '中' : '低'}\n1m处RSSI: ${result.rssiAt1m} dBm\n覆盖半径: ${result.coverageRadius} cm`, [{ text: '确定' }]);
  }, [projectId, plan, updateFloorPlan]);

  const addCalibrationPoint = useCallback(() => {
    if (!pdrRef.current) return;
    const pdr = pdrRef.current.getState();
    updateScanSession({ calibrationPoints: [...scanSession.calibrationPoints, { x: pdr.x, y: pdr.y, heading: pdr.heading, timestamp: Date.now() }] });
    Alert.alert('校准点已记录', `位置: (${Math.round(pdr.x)}, ${Math.round(pdr.y)}) cm`);
  }, [scanSession.calibrationPoints, updateScanSession]);

  function cleanup() {
    pdrRef.current?.stop();
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    setIsScanning(false);
  }

  const toSX = (cm: number) => cm * SCALE;
  const toSY = (cm: number) => cm * SCALE;
  const rooms = project?.floorPlan.rooms ?? [];
  const sampleCount = trail.length;
  const calPoints = scanSession.calibrationPoints;

  // Trail path (Skia Path)
  const trailPath = useRef(Skia.Path.Make());
  const trailPathEl = useRef<React.ReactElement | null>(null);

  const buildTrail = () => {
    if (trail.length < 2) return null;
    const p = Skia.Path.Make();
    p.moveTo(toSX(trail[0].x), toSY(trail[0].y));
    for (let i = 1; i < trail.length; i++) {
      p.lineTo(toSX(trail[i].x), toSY(trail[i].y));
    }
    return (
      <Path path={p} color="rgba(52,199,89,0.6)" style="stroke" strokeWidth={3} strokeJoin="round" strokeCap="round" />
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={stopScanning} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>‹ 退出</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isScanning ? '扫描中...' : '已暂停'}</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Canvas */}
      <View style={styles.canvasWrap}>
        <Canvas style={{ width: canvasW, height: canvasH }}>
          {/* Room fills */}
          {rooms.map((r) => (
            <Rect key={r.id} x={toSX(r.x)} y={toSY(r.y)} width={toSX(r.width)} height={toSY(r.height)} color="#2A2A3E" />
          ))}
          {/* Room borders */}
          {rooms.map((r) => (
            <Rect key={`b${r.id}`} x={toSX(r.x)} y={toSY(r.y)} width={toSX(r.width)} height={toSY(r.height)} color="#555" style="stroke" strokeWidth={1} />
          ))}

          {/* RSSI-colored dots on trail */}
          {trail.map((tp, i) => {
            const [cr, cg, cb, ca] = rssiToColor(tp.rssi);
            return (
              <Circle
                key={`d${i}`}
                cx={toSX(tp.x)} cy={toSY(tp.y)} r={4}
                color={`rgba(${cr},${cg},${cb},${ca / 255})`}
              />
            );
          })}

          {/* Trail line */}
          {buildTrail()}

          {/* Router */}
          {routerPos && <Circle cx={toSX(routerPos.x)} cy={toSY(routerPos.y)} r={10} color="#FF5722" />}
          {estimatedRouter && !routerPos && <Circle cx={toSX(estimatedRouter.x)} cy={toSY(estimatedRouter.y)} r={10} color="#FFD600" />}

          {/* Calibration markers */}
          {calPoints.map((cp, i) => (
            <Circle key={`cal${i}`} cx={toSX(cp.x)} cy={toSY(cp.y)} r={6} color="#007AFF" />
          ))}

          {/* Current position */}
          {isScanning && (
            <Circle cx={toSX(pdrPosition.x)} cy={toSY(pdrPosition.y)} r={8} color="#34C759" />
          )}
        </Canvas>

        {/* Room name labels */}
        {rooms.map((r) => (
          <View key={`l${r.id}`} pointerEvents="none" style={[styles.roomLabel, { left: toSX(r.x) + 4, top: toSY(r.y) + 4 }]}>
            <Text style={styles.roomLabelText}>{r.name}</Text>
          </View>
        ))}

        {/* Legend */}
        <View style={styles.canvasLegend}>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#00C853' }]} /><Text style={styles.legendText}>强</Text></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#FFD600' }]} /><Text style={styles.legendText}>中</Text></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#D50000' }]} /><Text style={styles.legendText}>弱</Text></View>
          <Text style={styles.legendHint}>走一圈看覆盖</Text>
        </View>
      </View>

      {/* Stats panel */}
      <View style={styles.infoPanel}>
        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>信号强度</Text>
            <Text style={[styles.infoValue, getRssiStyle(rssi)]}>{rssi !== null ? `${rssi} dBm` : '--'}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>步数</Text>
            <Text style={styles.infoValue}>{pdrPosition.stepCount}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>采样点</Text>
            <Text style={styles.infoValue}>{sampleCount}</Text>
          </View>
        </View>

        {!routerPos && sampleCount >= 5 && (
          <TouchableOpacity style={styles.detectBtn} onPress={detectRouter} activeOpacity={0.7}>
            <Text style={styles.detectBtnText}>🔍 定位路由器（{sampleCount} 个采样点）</Text>
          </TouchableOpacity>
        )}
        {estimatedRouter && (
          <Text style={styles.estimateText}>已定位 · 置信度: {estimatedRouter.confidence}</Text>
        )}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnOutline]} onPress={addCalibrationPoint}>
          <Text style={styles.ctrlBtnOutlineText}>📍 校准点</Text>
        </TouchableOpacity>
        {isScanning ? (
          <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnPrimary]} onPress={pauseScanning}>
            <Text style={styles.ctrlBtnText}>⏸ 暂停</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnPrimary]} onPress={resumeScanning}>
            <Text style={styles.ctrlBtnText}>▶️ 继续</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnDanger]} onPress={stopScanning}>
          <Text style={styles.ctrlBtnText}>⏹ 完成</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function getRssiStyle(rssi: number | null) {
  if (rssi === null) return { color: '#999' };
  if (rssi >= -50) return { color: '#00C853' };
  if (rssi >= -65) return { color: '#FFD600' };
  if (rssi >= -75) return { color: '#FF9100' };
  return { color: '#D50000' };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1A1A2E' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 50, paddingBottom: 8 },
  headerBtn: { padding: 4 },
  headerBtnText: { fontSize: 17, color: '#007AFF' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#FFF' },
  headerRight: { width: 50 },
  canvasWrap: { flex: 1, position: 'relative' },
  roomLabel: { position: 'absolute', paddingVertical: 2 },
  roomLabelText: { fontSize: 10, fontWeight: '600', color: '#999' },
  canvasLegend: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: 6, flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: '#CCC' },
  legendHint: { fontSize: 9, color: '#888', marginLeft: 6 },
  infoPanel: { backgroundColor: 'rgba(26,26,46,0.95)', padding: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-around' },
  infoItem: { alignItems: 'center' },
  infoLabel: { fontSize: 12, color: '#999', marginBottom: 4 },
  infoValue: { fontSize: 24, fontWeight: '700', color: '#FFF' },
  controls: { flexDirection: 'row', padding: 12, paddingBottom: 36, gap: 10 },
  ctrlBtn: { flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  ctrlBtnPrimary: { backgroundColor: '#007AFF' },
  ctrlBtnOutline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#007AFF' },
  ctrlBtnOutlineText: { fontSize: 15, fontWeight: '600', color: '#007AFF' },
  ctrlBtnDanger: { backgroundColor: '#FF3B30' },
  ctrlBtnText: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  detectBtn: { marginTop: 12, backgroundColor: 'rgba(255,214,0,0.15)', borderWidth: 1, borderColor: '#FFD600', borderRadius: 8, padding: 10, alignItems: 'center' },
  detectBtnText: { fontSize: 14, fontWeight: '600', color: '#FFD600' },
  estimateText: { fontSize: 12, color: '#FFD600', textAlign: 'center', marginTop: 6 },
});
