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
import type { WifiSample, CalibrationPoint, RouterPosition } from '../types';

const SCALE = 1.5;

export default function WifiScannerScreen({ route, navigation }: any) {
  const { projectId } = route.params ?? {};
  const project = useStore(
    useCallback((s) => s.projects.find((p) => p.id === projectId) ?? null, [projectId]),
  );
  const addSamples = useStore((s) => s.addSamples);
  const updateFloorPlan = useStore((s) => s.updateFloorPlan);
  const scanSession = useStore((s) => s.scanSession);
  const updateScanSession = useStore((s) => s.updateScanSession);
  const resetScanSession = useStore((s) => s.resetScanSession);

  const [isScanning, setIsScanning] = useState(false);
  const [rssi, setRssi] = useState<number | null>(null);
  const [pdrPosition, setPdrPosition] = useState({ x: 0, y: 0, heading: 0, stepCount: 0 });
  const [estimatedRouter, setEstimatedRouter] = useState<{ x: number; y: number; confidence: string } | null>(null);

  const wifiRef = useRef(new WifiScanner());
  const pdrRef = useRef<PedestrianTracker | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const routerPos = project?.floorPlan.routerPosition;
  const plan = project?.floorPlan;
  const canvasW = Dimensions.get('window').width;
  const canvasH = Dimensions.get('window').height - 280;

  // Permission check on mount
  useEffect(() => {
    wifiRef.current.requestPermission().then((granted) => {
      if (!granted) {
        Alert.alert(
          '需要位置权限',
          'Android 系统要求获取位置权限才能扫描 WiFi 信号。\n\n请在系统设置中允许本应用获取「精确位置」。',
          [
            { text: '稍后设置', onPress: () => navigation.goBack() },
            { text: '重试', onPress: () => wifiRef.current.requestPermission() },
          ],
        );
      }
    });
    return () => cleanup();
  }, []);

  // PDR position update
  useEffect(() => {
    if (isScanning && pdrRef.current) {
      const unsub = pdrRef.current.addListener((state) => {
        setPdrPosition({
          x: state.x,
          y: state.y,
          heading: state.heading,
          stepCount: state.stepCount,
        });
      });
      return unsub;
    }
  }, [isScanning]);

  const detectRouter = useCallback(() => {
    if (!plan || !project) return;
    const allSamples = project.samples;
    if (allSamples.length < 5) {
      Alert.alert('采样点不足', `需要至少 5 个采样点才能定位路由器，当前：${allSamples.length}。请先走一圈再试。`);
      return;
    }
    const result = locateRouter(allSamples);
    if (!result) {
      Alert.alert('无法定位', '信号数据不足以定位路由器，请在房间内多走几圈再试。');
      return;
    }

    // Find which room the estimated position falls in
    let roomId = plan.rooms[0]?.id ?? '';
    for (const r of plan.rooms) {
      if (
        result.x >= r.x && result.x <= r.x + r.width &&
        result.y >= r.y && result.y <= r.y + r.height
      ) {
        roomId = r.id;
        break;
      }
    }

    const newRouter: RouterPosition = { x: result.x, y: result.y, roomId };
    updateFloorPlan(projectId, {
      ...plan,
      routerPosition: newRouter,
      updatedAt: Date.now(),
    });

    setEstimatedRouter({
      x: result.x, y: result.y,
      confidence: result.confidence,
    });

    Alert.alert(
      '路由器已定位',
      `推测位置: (${result.x}, ${result.y}) cm\n置信度: ${result.confidence === 'high' ? '高' : result.confidence === 'medium' ? '中' : '低'}\n1m处RSSI: ${result.rssiAt1m} dBm\n路径损耗指数: ${result.pathLossExponent}\n覆盖半径: ${result.coverageRadius} cm`,
      [{ text: '确定' }],
    );
  }, [plan, project, projectId, updateFloorPlan]);

  const startScanning = useCallback(() => {
    if (!project) return;

    // Initialize PDR: use router position if known, otherwise room center
    let startX = 200;
    let startY = 200;
    if (routerPos) {
      startX = routerPos.x;
      startY = routerPos.y;
    } else if (plan && plan.rooms.length > 0) {
      const firstRoom = plan.rooms[0];
      startX = firstRoom.x + firstRoom.width / 2;
      startY = firstRoom.y + firstRoom.height / 2;
    }

    pdrRef.current = new PedestrianTracker(startX, startY, 0);
    pdrRef.current.start();

    updateScanSession({
      status: 'scanning',
      startTime: Date.now(),
      currentPosition: { x: startX, y: startY },
      currentHeading: 0,
      stepCount: 0,
      lastSampleTime: null,
    });

    setIsScanning(true);

    // Periodic WiFi scan
    scanTimerRef.current = setInterval(async () => {
      const results = await wifiRef.current.scan();
      const pdr = pdrRef.current?.getState();
      if (!pdr) return;

      const samples = wifiRef.current.createSamples(
        results,
        Math.round(pdr.x),
        Math.round(pdr.y),
        'pdr_high',
      );

      if (samples.length > 0) {
        addSamples(projectId, samples);
        const strongest = samples.reduce((a, b) => (a.rssi > b.rssi ? a : b));
        setRssi(strongest.rssi);
        updateScanSession({
          currentPosition: { x: pdr.x, y: pdr.y },
          currentHeading: pdr.heading,
          stepCount: pdr.stepCount,
          lastSampleTime: Date.now(),
        });
      }
    }, 2000);
  }, [project, projectId, routerPos, addSamples, updateScanSession]);

  const pauseScanning = useCallback(() => {
    pdrRef.current?.stop();
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    setIsScanning(false);
    updateScanSession({ status: 'paused' });
  }, [updateScanSession]);

  const resumeScanning = useCallback(() => {
    pdrRef.current?.start();
    setIsScanning(true);
    updateScanSession({ status: 'scanning' });
    // Re-create scan timer
    scanTimerRef.current = setInterval(async () => {
      const results = await wifiRef.current.scan();
      const pdr = pdrRef.current?.getState();
      if (!pdr) return;
      const samples = wifiRef.current.createSamples(
        results,
        Math.round(pdr.x),
        Math.round(pdr.y),
        'pdr_high',
      );
      if (samples.length > 0) {
        addSamples(projectId, samples);
        updateScanSession({
          currentPosition: { x: pdr.x, y: pdr.y },
          lastSampleTime: Date.now(),
        });
      }
    }, 2000);
  }, [projectId, addSamples, updateScanSession]);

  const stopScanning = useCallback(() => {
    cleanup();
    resetScanSession();

    // Auto-detect router if not already set
    if (project && !project.floorPlan.routerPosition && project.samples.length >= 5) {
      const result = locateRouter(project.samples);
      if (result && plan) {
        let roomId = plan.rooms[0]?.id ?? '';
        for (const r of plan.rooms) {
          if (result.x >= r.x && result.x <= r.x + r.width && result.y >= r.y && result.y <= r.y + r.height) {
            roomId = r.id; break;
          }
        }
        updateFloorPlan(projectId, {
          ...plan,
          routerPosition: { x: result.x, y: result.y, roomId },
          updatedAt: Date.now(),
        });
      }
    }

    navigation.goBack();
  }, [project, projectId, plan, updateFloorPlan, resetScanSession, navigation]);

  const addCalibrationPoint = useCallback(() => {
    if (!pdrRef.current) return;
    // On calibration, we don't move position — just register a calibration marker
    const pdr = pdrRef.current.getState();
    updateScanSession({
      calibrationPoints: [
        ...scanSession.calibrationPoints,
        {
          x: pdr.x,
          y: pdr.y,
          heading: pdr.heading,
          timestamp: Date.now(),
        },
      ],
    });
    Alert.alert('校准点已记录', `位置: (${Math.round(pdr.x)}, ${Math.round(pdr.y)}) cm`);
  }, [scanSession.calibrationPoints, updateScanSession]);

  function cleanup() {
    pdrRef.current?.stop();
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    setIsScanning(false);
  }

  // Build sample path for rendering
  const samplePath = project?.samples ?? [];
  const pathPoints = samplePath.slice(-200).map((s) => ({
    x: s.x * SCALE,
    y: s.y * SCALE,
  }));

  const currentPos = pdrPosition;
  const calPoints = scanSession.calibrationPoints;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={stopScanning} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>‹ 退出</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isScanning ? '扫描中...' : '已暂停'}
        </Text>
        <View style={styles.headerRight} />
      </View>

      {/* Canvas */}
      <View style={styles.canvasWrap}>
        <Canvas style={{ width: canvasW, height: canvasH }}>
          {/* Rooms */}
          {project?.floorPlan.rooms.map((r) => {
            const sx = r.x * SCALE;
            const sy = r.y * SCALE;
            const sw = r.width * SCALE;
            const sh = r.height * SCALE;
            return (
              <Rect
                key={r.id}
                x={sx}
                y={sy}
                width={sw}
                height={sh}
                color="#F5F5F5"
              />
            );
          })}

          {/* Router (from floor plan) */}
          {routerPos && (
            <Circle
              cx={routerPos.x * SCALE}
              cy={routerPos.y * SCALE}
              r={10}
              color="#FF5722"
            />
          )}

          {/* Estimated router (auto-detected) */}
          {estimatedRouter && !routerPos && (
            <Circle
              cx={estimatedRouter.x * SCALE}
              cy={estimatedRouter.y * SCALE}
              r={10}
              color="#FFD600"
            />
          )}

          {/* Calibration markers */}
          {calPoints.map((cp, i) => (
            <Circle
              key={`cal${i}`}
              cx={cp.x * SCALE}
              cy={cp.y * SCALE}
              r={6}
              color="#007AFF"
            />
          ))}

          {/* Sample trail */}
          {pathPoints.length > 1 && (
            <CustomPath points={pathPoints} />
          )}

          {/* Current position */}
          {isScanning && (
            <Circle
              cx={pdrPosition.x * SCALE}
              cy={pdrPosition.y * SCALE}
              r={8}
              color="#34C759"
            />
          )}
        </Canvas>
      </View>

      {/* Info panel */}
      <View style={styles.infoPanel}>
        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>信号强度</Text>
            <Text style={[styles.infoValue, getRssiStyle(rssi)]}>
              {rssi !== null ? `${rssi} dBm` : '--'}
            </Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>步数</Text>
            <Text style={styles.infoValue}>{pdrPosition.stepCount}</Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>采样点</Text>
            <Text style={styles.infoValue}>{samplePath.length}</Text>
          </View>
        </View>

        {!routerPos && (samplePath.length >= 5) && (
          <TouchableOpacity
            style={styles.detectBtn}
            onPress={detectRouter}
            activeOpacity={0.7}>
            <Text style={styles.detectBtnText}>
              🔍 定位路由器（{samplePath.length} 个采样点）
            </Text>
          </TouchableOpacity>
        )}

        {estimatedRouter && (
          <Text style={styles.estimateText}>
            已定位 · 置信度: {estimatedRouter.confidence}
          </Text>
        )}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.ctrlBtn, styles.ctrlBtnOutline]}
          onPress={addCalibrationPoint}>
          <Text style={styles.ctrlBtnOutlineText}>📍 校准点</Text>
        </TouchableOpacity>

        {isScanning ? (
          <TouchableOpacity
            style={[styles.ctrlBtn, styles.ctrlBtnPrimary]}
            onPress={pauseScanning}>
            <Text style={styles.ctrlBtnText}>⏸ 暂停</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.ctrlBtn, styles.ctrlBtnPrimary]}
            onPress={resumeScanning}>
            <Text style={styles.ctrlBtnText}>▶️ 继续</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.ctrlBtn, styles.ctrlBtnDanger]}
          onPress={stopScanning}>
          <Text style={styles.ctrlBtnText}>⏹ 完成</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CustomPath({ points }: { points: { x: number; y: number }[] }) {
  if (points.length < 2) return null;
  const path = Skia.Path.Make();
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    path.lineTo(points[i].x, points[i].y);
  }
  return (
    <Path
      path={path}
      color="rgba(52, 199, 89, 0.6)"
      style="stroke"
      strokeWidth={3}
      strokeJoin="round"
      strokeCap="round"
    />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 8,
  },
  headerBtn: { padding: 4 },
  headerBtnText: { fontSize: 17, color: '#007AFF' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#FFF' },
  headerRight: { width: 50 },
  canvasWrap: { flex: 1 },
  infoPanel: {
    backgroundColor: 'rgba(26,26,46,0.95)',
    padding: 16,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-around' },
  infoItem: { alignItems: 'center' },
  infoLabel: { fontSize: 12, color: '#999', marginBottom: 4 },
  infoValue: { fontSize: 24, fontWeight: '700', color: '#FFF' },
  controls: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: 36,
    gap: 10,
  },
  ctrlBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctrlBtnPrimary: { backgroundColor: '#007AFF' },
  ctrlBtnOutline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#007AFF' },
  ctrlBtnOutlineText: { fontSize: 15, fontWeight: '600', color: '#007AFF' },
  ctrlBtnDanger: { backgroundColor: '#FF3B30' },
  ctrlBtnText: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  detectBtn: {
    marginTop: 12,
    backgroundColor: 'rgba(255, 214, 0, 0.15)',
    borderWidth: 1, borderColor: '#FFD600',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  detectBtnText: { fontSize: 14, fontWeight: '600', color: '#FFD600' },
  estimateText: { fontSize: 12, color: '#FFD600', textAlign: 'center', marginTop: 6 },
});
