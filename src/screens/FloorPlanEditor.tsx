import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  Dimensions,
} from 'react-native';
import { Canvas, Rect, Circle, Line } from '@shopify/react-native-skia';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useStore } from '../store/useStore';
import type { Room, RoomType } from '../types';

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const BASE_SCALE = 2;        // px per cm at zoom=1
const GRID_SPACING = 50;     // cm
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const TOUCH_HIT_SLOP = 20;

const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  bedroom: '卧室', living: '客厅', kitchen: '厨房', bathroom: '卫生间',
  corridor: '走廊', study: '书房', balcony: '阳台', other: '其他',
};

const ROOM_COLORS: Record<RoomType, string> = {
  bedroom: '#E3F2FD', living: '#FFF3E0', kitchen: '#E8F5E9', bathroom: '#F3E5F5',
  corridor: '#ECEFF1', study: '#E0F7FA', balcony: '#F1F8E9', other: '#FAFAFA',
};

interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export default function FloorPlanEditor({ route, navigation }: any) {
  const { projectId } = route.params ?? {};
  const project = useStore((s) =>
    s.projects.find((p) => p.id === projectId) ?? null,
  );
  const updateFloorPlan = useStore((s) => s.updateFloorPlan);

  const [selectedRoomId, setSelectedRoomId] = React.useState<string | null>(null);
  const [showRoomModal, setShowRoomModal] = React.useState(false);
  const [showRouterModal, setShowRouterModal] = React.useState(false);

  // Canvas transform as React state (not shared value) so Canvas reads it safely
  const [view, setView] = React.useState<ViewTransform>({
    scale: 1, offsetX: 0, offsetY: 0,
  });
  // Gesture tracking refs (used only inside gesture callbacks, not render)
  const panStart = React.useRef({ x: 0, y: 0 });
  const pinchStart = React.useRef({ scale: 1, focalX: 0, focalY: 0, offX: 0, offY: 0 });

  const plan = project?.floorPlan;
  if (!plan) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>项目未找到</Text>
      </View>
    );
  }

  const canvasW = Dimensions.get('window').width;
  const canvasH = Dimensions.get('window').height - 180;
  const rooms = plan.rooms;
  const routerPos = plan.routerPosition;

  const { scale, offsetX, offsetY } = view;

  // --- Gestures (run on UI thread, update React state via runOnJS) ---
  // Gesture tracking ref (updated via useEffect whenever view changes)
  const viewRef = React.useRef(view);
  viewRef.current = view;

  const updateTransform = useCallback((patch: Partial<ViewTransform>) => {
    setView((prev) => ({ ...prev, ...patch }));
  }, []);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      const v = viewRef.current;
      panStart.current = { x: v.offsetX, y: v.offsetY };
    })
    .onUpdate((e) => {
      runOnJS(updateTransform)({
        offsetX: panStart.current.x + e.translationX,
        offsetY: panStart.current.y + e.translationY,
      });
    })
    .minPointers(1)
    .maxPointers(2);

  const pinchGesture = Gesture.Pinch()
    .onStart((e) => {
      const v = viewRef.current;
      pinchStart.current = { scale: v.scale, focalX: e.focalX, focalY: e.focalY, offX: v.offsetX, offY: v.offsetY };
    })
    .onUpdate((e) => {
      const ps = pinchStart.current;
      const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, ps.scale * e.scale));
      const dx = (newScale - ps.scale) * (ps.focalX - ps.offX) / ps.scale;
      const dy = (newScale - ps.scale) * (ps.focalY - ps.offY) / ps.scale;
      runOnJS(updateTransform)({
        scale: newScale,
        offsetX: ps.offX - dx,
        offsetY: ps.offY - dy,
      });
    });

  const composed = Gesture.Simultaneous(panGesture, pinchGesture);

  // --- Tap detection ---
  const handleCanvasTap = useCallback((evt: any) => {
    const touchX = evt.nativeEvent?.locationX ?? evt.nativeEvent?.x ?? 0;
    const touchY = evt.nativeEvent?.locationY ?? evt.nativeEvent?.y ?? 0;
    // Use closure-captured view (fine for tap — not high frequency)
    const v = view;
    for (const r of rooms) {
      const sx = r.x * BASE_SCALE * v.scale + v.offsetX;
      const sy = r.y * BASE_SCALE * v.scale + v.offsetY;
      const sw = r.width * BASE_SCALE * v.scale;
      const sh = r.height * BASE_SCALE * v.scale;
      if (
        touchX >= sx - TOUCH_HIT_SLOP && touchX <= sx + sw + TOUCH_HIT_SLOP &&
        touchY >= sy - TOUCH_HIT_SLOP && touchY <= sy + sh + TOUCH_HIT_SLOP
      ) {
        setSelectedRoomId(r.id);
        setShowRoomModal(true);
        return;
      }
    }
    setSelectedRoomId(null);
    setShowRoomModal(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, view.scale, view.offsetX, view.offsetY]);

  // --- Screen-space helpers ---
  const toScreen = (dim: number) => dim * BASE_SCALE * scale;
  const toScreenX = (cm: number) => cm * BASE_SCALE * scale + offsetX;
  const toScreenY = (cm: number) => cm * BASE_SCALE * scale + offsetY;

  // --- Grid (viewport-culled) ---
  const gridLines = useMemo(() => {
    const lines: React.ReactElement[] = [];
    const maxCm = 2000;
    for (let cm = GRID_SPACING; cm < maxCm; cm += GRID_SPACING) {
      const sx = cm * BASE_SCALE * scale + offsetX;
      const sy = cm * BASE_SCALE * scale + offsetY;
      if (sx >= -100 && sx <= canvasW + 100) {
        lines.push(
          <Line key={`gv${cm}`} p1={{ x: sx, y: 0 }} p2={{ x: sx, y: canvasH }}
            color="#E8E8E8" style="stroke" strokeWidth={0.5} />,
        );
      }
      if (sy >= -100 && sy <= canvasH + 100) {
        lines.push(
          <Line key={`gh${cm}`} p1={{ x: 0, y: sy }} p2={{ x: canvasW, y: sy }}
            color="#E8E8E8" style="stroke" strokeWidth={0.5} />,
        );
      }
    }
    return lines;
  }, [scale, offsetX, offsetY, canvasW, canvasH]);

  // --- Room actions ---
  const addRoom = () => {
    const centerCmX = (-offsetX + canvasW / 2) / (BASE_SCALE * scale);
    const centerCmY = (-offsetY + canvasH / 2) / (BASE_SCALE * scale);
    const r: Room = {
      id: genId(), name: '新房间', type: 'other',
      x: Math.round(centerCmX - 150), y: Math.round(centerCmY - 200),
      width: 300, height: 400,
    };
    updateFloorPlan(projectId, { ...plan, rooms: [...rooms, r], updatedAt: Date.now() });
    setSelectedRoomId(r.id);
    setShowRoomModal(true);
  };

  const updateRoom = (id: string, patch: Partial<Room>) => {
    updateFloorPlan(projectId, {
      ...plan, rooms: rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)), updatedAt: Date.now(),
    });
  };

  const deleteRoom = (id: string) => {
    updateFloorPlan(projectId, { ...plan, rooms: rooms.filter((r) => r.id !== id), updatedAt: Date.now() });
    setSelectedRoomId(null);
    setShowRoomModal(false);
  };

  const setRouter = (roomId: string) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    updateFloorPlan(projectId, {
      ...plan, routerPosition: { x: room.x + room.width / 2, y: room.y + room.height / 2, roomId }, updatedAt: Date.now(),
    });
    setShowRouterModal(false);
  };

  const goToScan = () => {
    if (rooms.length === 0) { Alert.alert('提示', '请先添加至少一个房间'); return; }
    navigation.navigate('WifiScanner', { projectId });
  };

  const goToHeatmap = () => navigation.navigate('HeatmapViewer', { projectId });

  const zoomIn = () => updateTransform({ scale: Math.min(MAX_ZOOM, scale * 1.25) });
  const zoomOut = () => updateTransform({ scale: Math.max(MIN_ZOOM, scale / 1.25) });
  const resetView = () => updateTransform({ scale: 1, offsetX: 0, offsetY: 0 });

  // Fit all rooms in viewport
  const fitToRooms = () => {
    if (rooms.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rooms) {
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    }
    const contentW = (maxX - minX + 100) * BASE_SCALE; // +100cm padding
    const contentH = (maxY - minY + 100) * BASE_SCALE;
    const fitScale = Math.min(canvasW / contentW, canvasH / contentH, 2);
    const offX = canvasW / 2 - ((minX + maxX) / 2) * BASE_SCALE * fitScale;
    const offY = canvasH / 2 - ((minY + maxY) / 2) * BASE_SCALE * fitScale;
    updateTransform({ scale: fitScale, offsetX: offX, offsetY: offY });
  };

  return (
    <View style={styles.container}>
      {/* Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.toolBtn}>
          <Text style={styles.toolBtnText}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.toolTitle}>{plan.name}</Text>
        <View style={styles.toolRight}>
          <TouchableOpacity onPress={resetView} style={styles.zoomBtn}>
            <Text style={styles.zoomBtnText}>⛶</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={zoomOut} style={styles.zoomBtn}>
            <Text style={styles.zoomBtnText}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={zoomIn} style={styles.zoomBtn}>
            <Text style={styles.zoomBtnText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={fitToRooms} style={styles.zoomBtn}>
            <Text style={styles.zoomBtnText}>⊡</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={addRoom} style={styles.toolAction}>
            <Text style={styles.toolActionText}>+ 房间</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Canvas */}
      <GestureDetector gesture={composed}>
        <View
          style={styles.canvasContainer}
          onStartShouldSetResponder={() => true}
          onResponderRelease={handleCanvasTap}>
          <Canvas style={{ width: canvasW, height: canvasH }}>
            {gridLines}
            {rooms.map((r) => {
              const sx = toScreenX(r.x), sy = toScreenY(r.y);
              const sw = toScreen(r.width), sh = toScreen(r.height);
              const isSel = selectedRoomId === r.id;
              return (
                <React.Fragment key={r.id}>
                  <Rect x={sx} y={sy} width={sw} height={sh} color={ROOM_COLORS[r.type]} />
                  <Rect x={sx} y={sy} width={sw} height={sh}
                    color={isSel ? '#007AFF' : '#CCC'} style="stroke"
                    strokeWidth={isSel ? 2 : 1} />
                </React.Fragment>
              );
            })}
            {routerPos && (
              <React.Fragment>
                <Circle cx={toScreenX(routerPos.x)} cy={toScreenY(routerPos.y)} r={12} color="#FF5722" />
                <Circle cx={toScreenX(routerPos.x)} cy={toScreenY(routerPos.y)} r={4} color="#FFF" />
              </React.Fragment>
            )}
          </Canvas>

          {rooms.map((r) => (
            <View key={`label-${r.id}`} pointerEvents="none"
              style={[styles.roomLabel, {
                left: toScreenX(r.x) + 4, top: toScreenY(r.y) + 4,
                width: Math.max(20, toScreen(r.width) - 8),
              }]}>
              <Text style={[styles.roomLabelText, {
                fontSize: Math.min(14, Math.max(8, 10 * scale)),
              }]}>{r.name}</Text>
            </View>
          ))}
          {routerPos && (
            <View pointerEvents="none" style={[styles.routerLabel, {
              left: toScreenX(routerPos.x) - 16, top: toScreenY(routerPos.y) + 14,
            }]}>
              <Text style={styles.routerLabelText}>路由</Text>
            </View>
          )}
        </View>
      </GestureDetector>

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={[styles.bottomBtn, styles.bottomBtnSecondary]}
          onPress={() => setShowRouterModal(true)}>
          <Text style={styles.bottomBtnText2}>📍 标记路由器</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.bottomBtn, styles.bottomBtnPrimary]}
          onPress={goToScan}>
          <Text style={styles.bottomBtnText1}>开始扫描</Text>
        </TouchableOpacity>
        {project && project.samples.length > 0 && (
          <TouchableOpacity style={[styles.bottomBtn, styles.bottomBtnAccent]}
            onPress={goToHeatmap}>
            <Text style={styles.bottomBtnText1}>查看热力图</Text>
          </TouchableOpacity>
        )}
      </View>

      <RoomEditModal
        visible={showRoomModal}
        room={rooms.find((r) => r.id === selectedRoomId) ?? null}
        onClose={() => setShowRoomModal(false)}
        onSave={(patch) => { if (selectedRoomId) updateRoom(selectedRoomId, patch); }}
        onDelete={() => { if (selectedRoomId) deleteRoom(selectedRoomId); }}
      />

      <Modal visible={showRouterModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>选择路由器所在房间</Text>
            {rooms.map((r) => (
              <TouchableOpacity key={r.id} style={styles.roomOption}
                onPress={() => setRouter(r.id)}>
                <Text style={styles.roomOptionText}>{ROOM_TYPE_LABELS[r.type]} — {r.name}</Text>
                {routerPos?.roomId === r.id && <Text style={styles.roomOptionCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel}
              onPress={() => setShowRouterModal(false)}>
              <Text style={styles.modalCancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// --- Room edit modal ---
function RoomEditModal({
  visible, room, onClose, onSave, onDelete,
}: {
  visible: boolean; room: Room | null; onClose: () => void;
  onSave: (patch: Partial<Room>) => void; onDelete: () => void;
}) {
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<RoomType>('other');
  const [width, setWidth] = React.useState('300');
  const [height, setHeight] = React.useState('400');

  React.useEffect(() => {
    if (room) { setName(room.name); setType(room.type); setWidth(String(room.width)); setHeight(String(room.height)); }
  }, [room]);

  if (!room) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>编辑房间</Text>
          <Text style={styles.inputLabel}>名称</Text>
          <TextInput style={styles.modalInput} value={name} onChangeText={setName} />
          <Text style={styles.inputLabel}>类型</Text>
          <View style={styles.typeGrid}>
            {(Object.keys(ROOM_TYPE_LABELS) as RoomType[]).map((t) => (
              <TouchableOpacity key={t}
                style={[styles.typeChip, type === t && styles.typeChipActive]}
                onPress={() => setType(t)}>
                <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>
                  {ROOM_TYPE_LABELS[t]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.sizeRow}>
            <View style={styles.sizeField}>
              <Text style={styles.inputLabel}>宽 (cm)</Text>
              <TextInput style={styles.modalInput} value={width} onChangeText={setWidth} keyboardType="numeric" />
            </View>
            <View style={styles.sizeField}>
              <Text style={styles.inputLabel}>深 (cm)</Text>
              <TextInput style={styles.modalInput} value={height} onChangeText={setHeight} keyboardType="numeric" />
            </View>
          </View>
          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
              <Text style={styles.deleteBtnText}>删除</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn}
              onPress={() => {
                onSave({ name: name.trim() || '房间', type,
                  width: Math.max(50, Number(width) || 300), height: Math.max(50, Number(height) || 400) });
                onClose();
              }}>
              <Text style={styles.confirmBtnText}>保存</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  error: { fontSize: 16, color: '#F00', textAlign: 'center', marginTop: 40 },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8,
    paddingTop: 50, paddingBottom: 8, backgroundColor: '#FFF',
    borderBottomWidth: 1, borderBottomColor: '#EEE',
  },
  toolBtn: { padding: 4 },
  toolBtnText: { fontSize: 17, color: '#007AFF' },
  toolTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#1A1A2E' },
  toolRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toolAction: { paddingVertical: 4, paddingHorizontal: 8 },
  toolActionText: { fontSize: 16, color: '#007AFF', fontWeight: '600' },
  zoomBtn: { width: 32, height: 32, borderRadius: 6, backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center' },
  zoomBtnText: { fontSize: 18, color: '#333', fontWeight: '600' },
  canvasContainer: { flex: 1, position: 'relative', overflow: 'hidden' },
  roomLabel: { position: 'absolute', paddingVertical: 2 },
  roomLabelText: { fontWeight: '600', color: '#555' },
  routerLabel: { position: 'absolute' },
  routerLabelText: { fontSize: 9, color: '#FF5722', fontWeight: '700' },
  bottomBar: {
    flexDirection: 'row', padding: 12, paddingBottom: 36,
    backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#EEE', gap: 10,
  },
  bottomBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  bottomBtnPrimary: { backgroundColor: '#007AFF' },
  bottomBtnSecondary: { backgroundColor: '#F0F0F0' },
  bottomBtnAccent: { backgroundColor: '#34C759' },
  bottomBtnText1: { fontSize: 16, fontWeight: '600', color: '#FFF' },
  bottomBtnText2: { fontSize: 16, fontWeight: '600', color: '#333' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, width: '88%', maxWidth: 360 },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 16, textAlign: 'center', color: '#1A1A2E' },
  inputLabel: { fontSize: 13, color: '#888', marginBottom: 4, marginTop: 8 },
  modalInput: { borderWidth: 1, borderColor: '#DDD', borderRadius: 8, padding: 10, fontSize: 15 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F0F0F0' },
  typeChipActive: { backgroundColor: '#007AFF' },
  typeChipText: { fontSize: 13, color: '#666' },
  typeChipTextActive: { fontSize: 13, color: '#FFF', fontWeight: '500' },
  sizeRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  sizeField: { flex: 1 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  deleteBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  deleteBtnText: { fontSize: 15, color: '#FF3B30' },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  cancelBtnText: { fontSize: 15, color: '#999' },
  confirmBtn: { paddingVertical: 8, paddingHorizontal: 20, backgroundColor: '#007AFF', borderRadius: 8 },
  confirmBtnText: { fontSize: 15, color: '#FFF', fontWeight: '600' },
  roomOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#EEE',
  },
  roomOptionText: { fontSize: 16, color: '#333' },
  roomOptionCheck: { fontSize: 18, color: '#007AFF', fontWeight: '600' },
  modalCancel: { paddingTop: 16, alignItems: 'center' },
  modalCancelText: { fontSize: 15, color: '#999' },
});
