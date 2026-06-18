import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { useStore } from '../store/useStore';
import type { Project } from '../types';

export default function HomeScreen({ navigation }: any) {
  const {
    projects,
    isLoaded,
    loadProjects,
    createProject,
    deleteProject,
    setActiveProject,
  } = useStore();

  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');

  React.useEffect(() => {
    if (!isLoaded) loadProjects();
  }, [isLoaded, loadProjects]);

  const handleCreate = useCallback(() => {
    const name = newName.trim() || `家-${projects.length + 1}`;
    const project = createProject(name);
    setShowNewModal(false);
    setNewName('');
    setActiveProject(project.id);
    navigation.navigate('FloorPlanEditor', { projectId: project.id });
  }, [newName, projects.length, createProject, setActiveProject, navigation]);

  const handleDelete = useCallback(
    (project: Project) => {
      Alert.alert('删除项目', `确定删除「${project.name}」吗？此操作不可撤销。`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => deleteProject(project.id),
        },
      ]);
    },
    [deleteProject],
  );

  const handleOpen = useCallback(
    (project: Project) => {
      setActiveProject(project.id);
      navigation.navigate('FloorPlanEditor', { projectId: project.id });
    },
    [setActiveProject, navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: Project }) => (
      <TouchableOpacity
        style={styles.card}
        onPress={() => handleOpen(item)}
        onLongPress={() => handleDelete(item)}
        activeOpacity={0.7}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.cardArrow}>›</Text>
        </View>
        <View style={styles.cardMeta}>
          <Text style={styles.metaText}>
            {item.floorPlan.rooms.length} 个房间
          </Text>
          <Text style={styles.metaText}>
            {item.samples.length} 个采样点
          </Text>
        </View>
        <Text style={styles.cardDate}>
          {new Date(item.updatedAt).toLocaleString('zh-CN')}
        </Text>
      </TouchableOpacity>
    ),
    [handleOpen, handleDelete],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>WiFi 热力图</Text>
      <Text style={styles.subtitle}>信号覆盖可视化工具</Text>

      {projects.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>还没有项目</Text>
          <Text style={styles.emptyHint}>点击下方按钮创建第一个项目</Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowNewModal(true)}
        activeOpacity={0.8}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal visible={showNewModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>新建项目</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={`家-${projects.length + 1}`}
              placeholderTextColor="#999"
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => {
                  setShowNewModal(false);
                  setNewName('');
                }}>
                <Text style={styles.modalButtonCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButtonConfirm}
                onPress={handleCreate}>
                <Text style={styles.modalButtonConfirmText}>创建</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA', paddingTop: 60 },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center', color: '#1A1A2E' },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginTop: 4, marginBottom: 24 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 18, color: '#999' },
  emptyHint: { fontSize: 13, color: '#BBB', marginTop: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 100 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 18, fontWeight: '600', color: '#1A1A2E' },
  cardArrow: { fontSize: 24, color: '#CCC' },
  cardMeta: { flexDirection: 'row', marginTop: 8, gap: 16 },
  metaText: { fontSize: 13, color: '#888' },
  cardDate: { fontSize: 12, color: '#BBB', marginTop: 8 },
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  fabText: { color: '#FFF', fontSize: 28, lineHeight: 30 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 24,
    width: '80%',
    maxWidth: 320,
  },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 16, textAlign: 'center' },
  modalInput: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalButtonCancel: { paddingVertical: 8, paddingHorizontal: 16 },
  modalButtonCancelText: { fontSize: 16, color: '#999' },
  modalButtonConfirm: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  modalButtonConfirmText: { fontSize: 16, color: '#FFF', fontWeight: '600' },
});
