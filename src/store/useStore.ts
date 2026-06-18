import { create } from 'zustand';
import type { Project, FloorPlan, WifiSample, HeatmapCell, ScanSession } from '../types';
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@wifi_heatmap_projects';

interface AppState {
  projects: Project[];
  activeProjectId: string | null;
  scanSession: ScanSession;
  isLoaded: boolean;

  // Actions
  loadProjects: () => Promise<void>;
  createProject: (name: string) => Project;
  deleteProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  updateFloorPlan: (projectId: string, plan: FloorPlan) => void;
  addSamples: (projectId: string, samples: WifiSample[]) => void;
  setHeatmap: (projectId: string, heatmap: HeatmapCell[]) => void;
  updateScanSession: (partial: Partial<ScanSession>) => void;
  resetScanSession: () => void;
}

function defaultScanSession(): ScanSession {
  return {
    status: 'idle',
    startTime: null,
    currentPosition: null,
    currentHeading: Math.PI / 2, // facing downward (positive Y)
    stepCount: 0,
    calibrationPoints: [],
    lastSampleTime: null,
  };
}

async function persist(projects: Project[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // silently fail
  }
}

export const useStore = create<AppState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  scanSession: defaultScanSession(),
  isLoaded: false,

  loadProjects: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const projects: Project[] = JSON.parse(raw);
        set({ projects, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  createProject: (name: string) => {
    const now = Date.now();
    const id = genId();
    const project: Project = {
      id,
      name,
      floorPlan: {
        id: genId(),
        name: `${name}-户型`,
        rooms: [],
        routerPosition: null,
        walls: [],
        createdAt: now,
        updatedAt: now,
      },
      samples: [],
      heatmap: [],
      createdAt: now,
      updatedAt: now,
    };

    set((s) => {
      const projects = [...s.projects, project];
      persist(projects);
      return { projects, activeProjectId: id };
    });
    return project;
  },

  deleteProject: (id: string) => {
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id);
      persist(projects);
      return {
        projects,
        activeProjectId:
          s.activeProjectId === id ? null : s.activeProjectId,
      };
    });
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  updateFloorPlan: (projectId, plan) => {
    set((s) => {
      const projects = s.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              floorPlan: { ...plan, updatedAt: Date.now() },
              updatedAt: Date.now(),
            }
          : p,
      );
      persist(projects);
      return { projects };
    });
  },

  addSamples: (projectId, samples) => {
    set((s) => {
      const projects = s.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              samples: [...p.samples, ...samples],
              updatedAt: Date.now(),
            }
          : p,
      );
      persist(projects);
      return { projects };
    });
  },

  setHeatmap: (projectId, heatmap) => {
    set((s) => {
      const projects = s.projects.map((p) =>
        p.id === projectId
          ? { ...p, heatmap, updatedAt: Date.now() }
          : p,
      );
      persist(projects);
      return { projects };
    });
  },

  updateScanSession: (partial) =>
    set((s) => ({
      scanSession: { ...s.scanSession, ...partial },
    })),

  resetScanSession: () => set({ scanSession: defaultScanSession() }),
}));
