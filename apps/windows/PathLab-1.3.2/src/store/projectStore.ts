import { create } from 'zustand';
import { produce } from 'immer';
import type {
  AnnotationObject,
  CanvasView,
  ImageObject,
  MagnifierObject,
  ProjectDoc,
} from '../lib/types';
import { createEmptyProject } from '../lib/types';
import { uid } from '../lib/id';
import { normalizeMagnifierRadii } from '../lib/magnifier';
import { migrateProject } from '../lib/migrate';

const HISTORY_LIMIT = 150;

export interface Scene {
  images: ImageObject[];
  annotations: AnnotationObject[];
  magnifiers: MagnifierObject[];
}

interface HistoryEntry {
  scene: Scene;
  label: string;
}

interface PendingEntry {
  scene: Scene;
  label: string;
}

function sceneOf(p: ProjectDoc): Scene {
  return { images: p.images, annotations: p.annotations, magnifiers: p.magnifiers };
}

function sceneWith(p: ProjectDoc, scene: Scene): ProjectDoc {
  return produce(p, (d) => {
    d.images = scene.images;
    d.annotations = scene.annotations;
    d.magnifiers = scene.magnifiers;
  });
}

interface ProjectState {
  project: ProjectDoc;
  projectTransition: number;
  past: HistoryEntry[];
  future: HistoryEntry[];
  pending: PendingEntry | null;

  /** 无历史记录的变更（手势进行中、平移缩放等） */
  apply: (fn: (draft: ProjectDoc) => void) => void;
  /** 记录历史的变更 */
  applyWithHistory: (label: string, fn: (draft: ProjectDoc) => void) => void;
  /** 手势开始：暂存一份快照，首次 apply 时入栈 */
  begin: (label: string) => void;
  /** 手势结束 */
  end: () => void;

  setView: (view: Partial<CanvasView>) => void;
  setTitle: (title: string) => void;
  setTextDocument: (doc: unknown) => void;

  loadProject: (p: ProjectDoc) => void;
  newProject: () => void;
  beginProjectTransition: () => number;
  commitProjectTransition: (p: ProjectDoc, transition: number) => boolean;
  commitNewProjectTransition: (transition: number) => boolean;
  isProjectTransitionCurrent: (transition: number) => boolean;

  undo: () => void;
  redo: () => void;
}

export const useProject = create<ProjectState>((set, get) => ({
  project: createEmptyProject(),
  projectTransition: 0,
  past: [],
  future: [],
  pending: null,

  apply: (fn) =>
    set((s) => {
      const next = produce(s.project, (d) => {
        fn(d);
        normalizeMagnifierRadii(d);
      });
      if (next === s.project) return s as Partial<ProjectState>;
      let past = s.past;
      let future = s.future;
      if (s.pending) {
        past = [...s.past, { scene: s.pending.scene, label: s.pending.label }].slice(-HISTORY_LIMIT);
        future = [];
      }
      return {
        project: { ...next, updatedAt: new Date().toISOString() },
        past,
        future,
        pending: null,
      } as Partial<ProjectState>;
    }),

  applyWithHistory: (label, fn) => {
    const { project, past } = get();
    const snapshot: PendingEntry = { scene: sceneOf(project), label };
    set((s) => {
      const next = produce(s.project, (d) => {
        fn(d);
        normalizeMagnifierRadii(d);
      });
      if (next === s.project) return s as Partial<ProjectState>;
      return {
        project: { ...next, updatedAt: new Date().toISOString() },
        past: [...past, snapshot].slice(-HISTORY_LIMIT),
        future: [],
        pending: null,
      } as Partial<ProjectState>;
    });
  },

  begin: (label) =>
    set((s) => (s.pending ? s : { pending: { scene: sceneOf(s.project), label } }) as Partial<ProjectState>),

  end: () => set((s) => (s.pending ? ({ pending: null } as Partial<ProjectState>) : (s as Partial<ProjectState>))),

  setView: (view) =>
    set((s) => ({
      project: produce(s.project, (d) => {
        Object.assign(d.canvas, view);
      }),
    })),

  setTitle: (title) =>
    set((s) => ({ project: produce(s.project, (d) => void (d.title = title)) })),

  setTextDocument: (doc) =>
    set((s) => ({ project: produce(s.project, (d) => void (d.textDocument = doc)) })),

  loadProject: (p) => set((s) => ({
    project: migrateProject(p),
    projectTransition: s.projectTransition + 1,
    past: [],
    future: [],
    pending: null,
  })),

  newProject: () => set((s) => ({
    project: createEmptyProject(),
    projectTransition: s.projectTransition + 1,
    past: [],
    future: [],
    pending: null,
  })),

  beginProjectTransition: () => {
    let transition = 0;
    set((s) => {
      transition = s.projectTransition + 1;
      return { projectTransition: transition } as Partial<ProjectState>;
    });
    return transition;
  },

  commitProjectTransition: (p, transition) => {
    if (get().projectTransition !== transition) return false;
    set((s) => {
      if (s.projectTransition !== transition) return s as Partial<ProjectState>;
      return {
        project: migrateProject(p),
        projectTransition: transition + 1,
        past: [],
        future: [],
        pending: null,
      } as Partial<ProjectState>;
    });
    return get().projectTransition === transition + 1;
  },

  commitNewProjectTransition: (transition) => {
    if (get().projectTransition !== transition) return false;
    set((s) => {
      if (s.projectTransition !== transition) return s as Partial<ProjectState>;
      return {
        project: createEmptyProject(),
        projectTransition: transition + 1,
        past: [],
        future: [],
        pending: null,
      } as Partial<ProjectState>;
    });
    return get().projectTransition === transition + 1;
  },

  isProjectTransitionCurrent: (transition) => get().projectTransition === transition,

  undo: () =>
    set((s) => {
      if (!s.past.length) return s as Partial<ProjectState>;
      const entry = s.past[s.past.length - 1];
      const cur: HistoryEntry = { scene: sceneOf(s.project), label: entry.label };
      return {
        project: { ...sceneWith(s.project, entry.scene), updatedAt: new Date().toISOString() },
        past: s.past.slice(0, -1),
        future: [cur, ...s.future].slice(0, HISTORY_LIMIT),
        pending: null,
      } as Partial<ProjectState>;
    }),

  redo: () =>
    set((s) => {
      if (!s.future.length) return s as Partial<ProjectState>;
      const entry = s.future[0];
      const cur: HistoryEntry = { scene: sceneOf(s.project), label: entry.label };
      return {
        project: { ...sceneWith(s.project, entry.scene), updatedAt: new Date().toISOString() },
        past: [...s.past, cur].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
        pending: null,
      } as Partial<ProjectState>;
    }),
}));

/* ---------------- 便捷选择器 ---------------- */

export const selectImage = (id: string) => (s: ProjectState) =>
  s.project.images.find((i) => i.id === id);
export const selectAnnotation = (id: string) => (s: ProjectState) =>
  s.project.annotations.find((a) => a.id === id);
export const selectMagnifier = (id: string) => (s: ProjectState) =>
  s.project.magnifiers.find((m) => m.id === id);

/* ---------------- 层级操作 ---------------- */

type ZKind = 'image' | 'annotation' | 'magnifier';

export function changeZ(kind: ZKind, id: string, action: 'front' | 'back' | 'forward' | 'backward'): void {
  const { applyWithHistory, project } = useProject.getState();
  const list: { id: string; zIndex: number }[] =
    kind === 'image' ? project.images : kind === 'annotation' ? project.annotations : project.magnifiers;
  const sorted = [...list].sort((a, b) => a.zIndex - b.zIndex);
  const idx = sorted.findIndex((o) => o.id === id);
  if (idx < 0) return;
  const target = action === 'front' ? sorted.length - 1 : action === 'back' ? 0 : action === 'forward' ? Math.min(sorted.length - 1, idx + 1) : Math.max(0, idx - 1);
  if (target === idx) return;
  const [item] = sorted.splice(idx, 1);
  sorted.splice(target, 0, item);
  const labels: Record<string, string> = { image: '图片', annotation: '标注', magnifier: '放大引用' };
  applyWithHistory(`调整${labels[kind]}层级`, (d) => {
    const key = kind === 'image' ? 'images' : kind === 'annotation' ? 'annotations' : 'magnifiers';
    sorted.forEach((o, i) => {
      const t = (d[key] as { id: string; zIndex: number }[]).find((x) => x.id === o.id);
      if (t) t.zIndex = i;
    });
  });
}

export function nextZIndex(kind: ZKind): number {
  const { project } = useProject.getState();
  const list = kind === 'image' ? project.images : kind === 'annotation' ? project.annotations : project.magnifiers;
  return list.reduce((m, o) => Math.max(m, o.zIndex), -1) + 1;
}

export function newId(prefix: string): string {
  return uid(prefix);
}
