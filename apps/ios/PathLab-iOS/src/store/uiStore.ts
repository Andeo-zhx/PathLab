import { create } from 'zustand';
import type { Rect, SelectionRef, Tool } from '../lib/types';
import { categorizeNotification, emitDiagnosticNotification } from '../lib/diagnostics';
import { loadStylusModeEnabled, saveStylusModeEnabled } from '../lib/inputPreferences';

export type ExportMode = 'canvas' | 'page';
export type ExportPageSize = 'a4' | 'auto';

export interface ExportConfig {
  mode: ExportMode;
  scale: number;
  transparent: boolean;
  pageSize: ExportPageSize;
  includeText: boolean;
  running: boolean;
}

export interface ToastItem {
  id: string;
  message: string;
  tone: 'info' | 'error' | 'success';
}

export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  icon?: string;
}

interface UiState {
  tool: Tool;
  /** 上一次使用的绘制工具（切回选择后记住） */
  lastDrawTool: Tool;
  selection: SelectionRef[];
  editingTextId: string | null;
  textDraft: string | null;
  croppingImageId: string | null;
  cropDraft: Rect | null;
  pendingPolygon: { parentImageId: string | null; points: { x: number; y: number }[] } | null;
  spacePressed: boolean;
  annotationsGloballyVisible: boolean;
  exportConfig: ExportConfig | null;
  contextMenu: { x: number; y: number; items: ContextMenuItem[]; target?: SelectionRef } | null;
  toasts: ToastItem[];
  writingWidth: number;
  textSyncToken: number;
  translationAnnotationId: string | null;
  savedFlash: boolean;
  shortcutsOpen: boolean;
  moreMenuOpen: boolean;
  textSettingsOpen: boolean;
  stylusModeEnabled: boolean;

  setTool: (t: Tool) => void;
  setSelection: (s: SelectionRef[]) => void;
  toggleSelection: (ref: SelectionRef) => void;
  clearSelection: () => void;
  setEditingText: (id: string | null, draft?: string | null) => void;
  setCrop: (imageId: string | null, draft?: Rect | null) => void;
  setCropDraft: (draft: Rect | null) => void;
  setPendingPolygon: (p: { parentImageId: string | null; points: { x: number; y: number }[] } | null) => void;
  setSpace: (v: boolean) => void;
  setAnnotationsVisible: (v: boolean) => void;
  openExport: (mode?: 'canvas' | 'page') => void;
  patchExport: (patch: Partial<ExportConfig>) => void;
  closeExport: () => void;
  openContextMenu: (x: number, y: number, items: ContextMenuItem[], target?: SelectionRef) => void;
  closeContextMenu: () => void;
  toast: (message: string, tone?: ToastItem['tone']) => void;
  dismissToast: (id: string) => void;
  setWritingWidth: (w: number) => void;
  setTranslationAnnotation: (id: string | null) => void;
  bumpTextSync: () => void;
  flashSaved: () => void;
  setShortcutsOpen: (v: boolean) => void;
  setMoreMenuOpen: (v: boolean) => void;
  setTextSettingsOpen: (v: boolean) => void;
  setStylusModeEnabled: (v: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  tool: 'select',
  lastDrawTool: 'rect',
  selection: [],
  editingTextId: null,
  textDraft: null,
  croppingImageId: null,
  cropDraft: null,
  pendingPolygon: null,
  spacePressed: false,
  annotationsGloballyVisible: true,
  exportConfig: null,
  contextMenu: null,
  toasts: [],
  writingWidth: 460,
  textSyncToken: 0,
  translationAnnotationId: null,
  savedFlash: false,
  shortcutsOpen: false,
  moreMenuOpen: false,
  textSettingsOpen: false,
  stylusModeEnabled: loadStylusModeEnabled(),

  setTool: (t) =>
    set(
      (s) =>
        ({
          tool: t,
          lastDrawTool: t === 'select' || t === 'hand' ? s.lastDrawTool : t,
          // 切换工具时丢弃未闭合的套索，避免留下悬空预览
          pendingPolygon: t === 'polygon' ? s.pendingPolygon : null,
        }) as Partial<UiState>,
    ),
  setSelection: (s) => set({ selection: s }),
  toggleSelection: (ref) =>
    set((s) => {
      const exists = s.selection.some((x) => x.id === ref.id);
      return { selection: exists ? s.selection.filter((x) => x.id !== ref.id) : [...s.selection, ref] };
    }),
  clearSelection: () =>
    set({ selection: [], editingTextId: null, textDraft: null, pendingPolygon: null, contextMenu: null }),
  setEditingText: (id, draft = null) => set({ editingTextId: id, textDraft: draft }),
  setCrop: (imageId, draft = null) => set({ croppingImageId: imageId, cropDraft: draft }),
  setCropDraft: (draft) => set({ cropDraft: draft }),
  setPendingPolygon: (p) => set({ pendingPolygon: p }),
  setSpace: (v) => set({ spacePressed: v }),
  setAnnotationsVisible: (v) => set({ annotationsGloballyVisible: v }),
  openExport: (mode = 'canvas') =>
    set({
      exportConfig: {
        mode,
        scale: mode === 'page' ? 8 : 2,
        transparent: false,
        pageSize: 'a4',
        includeText: true,
        running: false,
      },
    }),
  patchExport: (patch) =>
    set((s) => (s.exportConfig ? { exportConfig: { ...s.exportConfig, ...patch } } : ({} as Partial<UiState>))),
  closeExport: () => set({ exportConfig: null }),
  openContextMenu: (x, y, items, target) => set({ contextMenu: { x, y, items, target } }),
  closeContextMenu: () => set({ contextMenu: null }),
  toast: (message, tone = 'info') => {
    emitDiagnosticNotification(tone, categorizeNotification(message));
    set((s) => ({
      toasts: [...s.toasts, { id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, message, tone }],
    }));
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setWritingWidth: (w) => set({ writingWidth: Math.min(760, Math.max(340, w)) }),
  setTranslationAnnotation: (id) => set({ translationAnnotationId: id }),
  bumpTextSync: () => set((s) => ({ textSyncToken: s.textSyncToken + 1 })),
  flashSaved: () => {
    set({ savedFlash: true });
    setTimeout(() => set({ savedFlash: false }), 1400);
  },
  setShortcutsOpen: (v) => set({ shortcutsOpen: v }),
  setMoreMenuOpen: (v) => set({ moreMenuOpen: v }),
  setTextSettingsOpen: (v) => set({ textSettingsOpen: v }),
  setStylusModeEnabled: (v) => {
    saveStylusModeEnabled(v);
    set({ stylusModeEnabled: v });
  },
}));
