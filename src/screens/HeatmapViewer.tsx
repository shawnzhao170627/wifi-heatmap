import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ScrollView,
} from 'react-native';
import { Canvas, Rect, Circle, RoundedRect } from '@shopify/react-native-skia';
import { useStore } from '../store/useStore';
import {
  buildGrid,
  interpolate,
  rssiToColor,
  rssiCategoryColor,
  rssiCategory,
} from '../services/HeatmapEngine';
import type { HeatmapCell } from '../types';

const SCALE = 1.5;
const CELL = 25; // cm, must match GRID_SPACING_CM in HeatmapEngine
const OPACITY_MIN = 100;
const OPACITY_MAX = 200;

export default function HeatmapViewer({ route, navigation }: any) {
  const { projectId } = route.params ?? {};
  const project = useStore(
    useCallback((s) => s.projects.find((p) => p.id === projectId) ?? null, [projectId]),
  );
  const setHeatmap = useStore((s) => s.setHeatmap);

  const canvasW = Dimensions.get('window').width;
  const canvasH = Dimensions.get('window').height - 250;

  const heatmapCells = useMemo(() => {
    if (!project) return [];
    const samples = project.samples;
    if (samples.length === 0) return [];

    const grid = buildGrid(project.floorPlan);
    const cells = interpolate(grid, samples);
    setHeatmap(projectId, cells);
    return cells;
  }, [project, projectId, setHeatmap]);

  if (!project) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>项目未找到</Text>
      </View>
    );
  }

  const { floorPlan, samples } = project;
  const routerPos = floorPlan.routerPosition;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>热力图</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('WifiScanner', { projectId })}
          style={styles.headerRight}>
          <Text style={styles.headerActionText}>+ 补采样</Text>
        </TouchableOpacity>
      </View>

      {/* Canvas */}
      <View style={styles.canvasWrap}>
        <Canvas style={{ width: canvasW, height: canvasH }}>
          {/* Heatmap cells */}
          {heatmapCells.map((cell) => {
            const [r, g, b, a] = rssiToColor(cell.rssi);
            if (cell.sampleCount === 0) return null;
            return (
              <Rect
                key={`${cell.x}-${cell.y}`}
                x={cell.x * SCALE - (CELL * SCALE) / 2}
                y={cell.y * SCALE - (CELL * SCALE) / 2}
                width={CELL * SCALE}
                height={CELL * SCALE}
                color={`rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a / 255})`}
              />
            );
          })}

          {/* Room borders on top */}
          {floorPlan.rooms.map((r) => (
            <Rect
              key={r.id}
              x={r.x * SCALE}
              y={r.y * SCALE}
              width={r.width * SCALE}
              height={r.height * SCALE}
              color="#333"
              style="stroke"
              strokeWidth={1.5}
            />
          ))}

          {/* Router */}
          {routerPos && (
            <React.Fragment>
              <Circle
                cx={routerPos.x * SCALE}
                cy={routerPos.y * SCALE}
                r={10}
                color="#FF5722"
              />
              <Circle
                cx={routerPos.x * SCALE}
                cy={routerPos.y * SCALE}
                r={4}
                color="#FFF"
              />
            </React.Fragment>
          )}
        </Canvas>
      </View>

      {/* Legend */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.legendScroll}
        contentContainerStyle={styles.legendContent}>
        {[
          { label: '极强', range: '> -50 dBm', color: '#00C853' },
          { label: '强', range: '-50 ~ -65', color: '#FFD600' },
          { label: '一般', range: '-65 ~ -75', color: '#FF9100' },
          { label: '弱', range: '< -75 dBm', color: '#D50000' },
        ].map((item) => (
          <View key={item.label} style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: item.color }]} />
            <View>
              <Text style={styles.legendLabel}>{item.label}</Text>
              <Text style={styles.legendRange}>{item.range}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{samples.length}</Text>
          <Text style={styles.statLabel}>采样点</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{heatmapCells.filter((c) => c.sampleCount > 0).length}</Text>
          <Text style={styles.statLabel}>热力图格</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>
            {heatmapCells.length > 0
              ? Math.round(
                  heatmapCells.reduce((sum, c) => sum + c.rssi, 0) /
                    heatmapCells.filter((c) => c.sampleCount > 0).length || heatmapCells.length,
                )
              : '--'}
          </Text>
          <Text style={styles.statLabel}>平均 RSSI (dBm)</Text>
        </View>
      </View>

      {/* Bottom actions */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.bottomBtn}
          onPress={() => navigation.navigate('WifiScanner', { projectId })}>
          <Text style={styles.bottomBtnText}>再扫一次</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.bottomBtnExport}
          onPress={() => {
            // Export placeholder — in real app, use react-native-view-shot
            Alert.exportMessage?.();
          }}>
          <Text style={styles.bottomBtnExportText}>导出截图</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Need Alert replacement for non-export scenario
const Alert = {
  exportMessage: () => {
    // Will be implemented with react-native-view-shot
  },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  error: { fontSize: 16, color: '#F00', textAlign: 'center', marginTop: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 8,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  headerBtn: { padding: 4 },
  headerBtnText: { fontSize: 17, color: '#007AFF' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#1A1A2E' },
  headerRight: { padding: 4 },
  headerActionText: { fontSize: 15, color: '#007AFF', fontWeight: '500' },
  canvasWrap: { flex: 1, backgroundColor: '#FFF' },
  legendScroll: { maxHeight: 60, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#EEE' },
  legendContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 20 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendColor: { width: 16, height: 16, borderRadius: 4 },
  legendLabel: { fontSize: 13, fontWeight: '600', color: '#333' },
  legendRange: { fontSize: 11, color: '#999' },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: '#EEE',
  },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#1A1A2E' },
  statLabel: { fontSize: 11, color: '#999', marginTop: 2 },
  bottomBar: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: 36,
    gap: 10,
  },
  bottomBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  bottomBtnText: { fontSize: 16, fontWeight: '600', color: '#FFF' },
  bottomBtnExport: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
  },
  bottomBtnExportText: { fontSize: 16, fontWeight: '600', color: '#333' },
});
