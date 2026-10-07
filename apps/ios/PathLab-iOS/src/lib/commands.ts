import { useUi } from '../store/uiStore';
import { isNativeApp } from './native';
import { pickPathLabProjectFromNative } from './nativeFiles';
import { useProject, changeZ } from '../store/projectStore';
import { viewCommands } from './viewport';
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  pasteObjects,
  rotateImage,
  saveProjectToFile,
  selectAll,
  startNewProject,
  toggleAnnotationsVisible,
  toggleConnector,
  toggleLock,
  openProjectFromFile,
  requestProjectOpenIntent,
  arrangeImages,
  importFromClipboard,
  importFiles,
  requestImageImportIntent,
} from './actions';
import type { SelectionRef } from './types';
import { createDiagnosticOperationId, emitDiagnosticResponse } from './diagnostics';

export type CommandId =
  | 'fit'
  | 'zoom100'
  | 'zoomIn'
  | 'zoomOut'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'delete'
  | 'selectAll'
  | 'crop'
  | 'rotate'
  | 'front'
  | 'back'
  | 'toggleAnn'
  | 'lock'
  | 'connector'
  | 'save'
  | 'open'
  | 'new'
  | 'exportCanvas'
  | 'exportPage'
  | 'shortcuts'
  | 'toggleAllAnnotations'
  | 'arrangeVertical'
  | 'arrangeHorizontal'
  | 'arrangeGrid'
  | 'finishPolygon'
  | 'cancelPolygon'
  | 'pasteImage'
  | 'importImages';

export function runCommand(id: CommandId, target?: SelectionRef | null): void {
  const ui = useUi.getState();
  const st = useProject.getState();
  const ref = target ?? ui.selection[0] ?? null;

  switch (id) {
    case 'fit':
      viewCommands.fit();
      break;
    case 'zoom100':
      viewCommands.zoom100();
      break;
    case 'zoomIn': {
      const v = st.project.canvas;
      viewCommands.zoomTo(Math.min(8, v.zoom * 1.25));
      break;
    }
    case 'zoomOut': {
      const v = st.project.canvas;
      viewCommands.zoomTo(Math.max(0.1, v.zoom / 1.25));
      break;
    }
    case 'copy':
      copySelection();
      break;
    case 'paste':
      pasteObjects();
      break;
    case 'duplicate':
      duplicateSelection();
      break;
    case 'delete':
      deleteSelection();
      break;
    case 'selectAll':
      selectAll();
      break;
    case 'crop':
      if (ref?.kind === 'image') {
        const img = st.project.images.find((i) => i.id === ref.id);
        if (img) {
          ui.setSelection([ref]);
          ui.setCrop(img.id, { ...img.crop });
        }
      }
      break;
    case 'rotate':
      if (ref?.kind === 'image') rotateImage(ref.id);
      break;
    case 'front':
      if (ref) changeZ(ref.kind, ref.id, 'front');
      break;
    case 'back':
      if (ref) changeZ(ref.kind, ref.id, 'back');
      break;
    case 'toggleAnn':
      if (ref) toggleAnnotationsVisible(ref);
      break;
    case 'lock':
      if (ref) toggleLock(ref);
      break;
    case 'connector':
      if (ref?.kind === 'magnifier') toggleConnector(ref.id);
      break;
    case 'save':
      void saveProjectToFile();
      break;
    case 'open':
      pickProjectFile();
      break;
    case 'new':
      startNewProject();
      break;
    case 'exportCanvas':
      ui.openExport('canvas');
      break;
    case 'exportPage':
      ui.openExport('page');
      break;
    case 'shortcuts':
      ui.setShortcutsOpen(true);
      break;
    case 'toggleAllAnnotations':
      ui.setAnnotationsVisible(!ui.annotationsGloballyVisible);
      break;
    case 'arrangeVertical':
      arrangeImages('vertical');
      break;
    case 'arrangeHorizontal':
      arrangeImages('horizontal');
      break;
    case 'arrangeGrid':
      arrangeImages('grid');
      break;
    case 'finishPolygon':
      window.dispatchEvent(new CustomEvent('pathlab:finish-polygon'));
      break;
    case 'cancelPolygon':
      ui.setPendingPolygon(null);
      break;
    case 'pasteImage':
      void importFromClipboard().then((ok) => {
        if (!ok) ui.toast('剪贴板图片未导入，请确认剪贴板包含图片后重试', 'info');
      });
      break;
    case 'importImages':
      pickImageFiles();
      break;
    default:
      break;
  }
}

export function pickProjectFile(): void {
  const openIntent = requestProjectOpenIntent();
  const operationId = createDiagnosticOperationId('project-picker');
  const startedAt = Date.now();
  const source = isNativeApp() ? 'native-files' : 'picker';
  emitDiagnosticResponse({ operationId, operation: 'project-picker', phase: 'start', source });
  if (isNativeApp()) {
    void pickPathLabProjectFromNative()
      .then((file) => {
        if (file) {
          emitDiagnosticResponse({
            operationId,
            operation: 'project-picker',
            phase: 'selected',
            source,
            durationMs: Date.now() - startedAt,
            selectedCount: 1,
            bytes: file.size,
            mimeType: file.type || undefined,
          });
          void openProjectFromFile(file, openIntent, operationId);
        } else {
          emitDiagnosticResponse({ operationId, operation: 'project-picker', phase: 'cancelled', source, durationMs: Date.now() - startedAt });
        }
      })
      .catch((error: unknown) => {
        emitDiagnosticResponse({ operationId, operation: 'project-picker', phase: 'failure', source, durationMs: Date.now() - startedAt, reason: 'picker-failed' });
        useUi.getState().toast(error instanceof Error ? error.message : '无法访问所选 .pathlab 工程文件。', 'error');
      });
    return;
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pathlab,application/zip';
  let settled = false;
  let focusTimeout = 0;
  const cleanup = () => {
    window.removeEventListener('focus', onWindowFocus);
    window.clearTimeout(focusTimeout);
    input.remove();
  };
  const onWindowFocus = () => {
    focusTimeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        emitDiagnosticResponse({ operationId, operation: 'project-picker', phase: 'cancelled', source, durationMs: Date.now() - startedAt });
      }
      cleanup();
    }, 5000);
  };
  input.onchange = () => {
    if (settled) return;
    settled = true;
    const file = input.files?.[0];
    cleanup();
    if (file) {
      emitDiagnosticResponse({ operationId, operation: 'project-picker', phase: 'selected', source, durationMs: Date.now() - startedAt, selectedCount: 1, bytes: file.size, mimeType: file.type || undefined });
      void openProjectFromFile(file, openIntent, operationId);
    } else {
      emitDiagnosticResponse({ operationId, operation: 'project-picker', phase: 'cancelled', source, durationMs: Date.now() - startedAt });
    }
  };
  window.addEventListener('focus', onWindowFocus, { once: true });
  try {
    input.click();
  } catch {
    settled = true;
    cleanup();
    emitDiagnosticResponse({ operationId, operation: 'project-picker', phase: 'failure', source, durationMs: Date.now() - startedAt, reason: 'picker-failed' });
  }
}

export function pickImageFiles(): void {
  const importIntent = requestImageImportIntent();
  const operationId = createDiagnosticOperationId('image-picker');
  const startedAt = Date.now();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  Object.assign(input.style, { position: 'fixed', left: '-10000px', width: '1px', height: '1px', opacity: '0' });

  let focusTimeout = 0;
  let settled = false;
  emitDiagnosticResponse({ operationId, operation: 'image-picker', phase: 'start', source: 'picker' });
  const cleanup = () => {
    window.removeEventListener('focus', onWindowFocus);
    window.clearTimeout(focusTimeout);
    input.remove();
  };
  const onWindowFocus = () => {
    focusTimeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        emitDiagnosticResponse({ operationId, operation: 'image-picker', phase: 'cancelled', source: 'picker', durationMs: Date.now() - startedAt });
      }
      cleanup();
    }, 5000);
  };

  input.onchange = () => {
    if (settled) return;
    settled = true;
    const files = Array.from(input.files ?? []);
    cleanup();
    if (!files.length) {
      emitDiagnosticResponse({ operationId, operation: 'image-picker', phase: 'cancelled', source: 'picker', durationMs: Date.now() - startedAt });
      return;
    }
    emitDiagnosticResponse({ operationId, operation: 'image-picker', phase: 'selected', source: 'picker', durationMs: Date.now() - startedAt, selectedCount: files.length });
    useUi.getState().toast(`正在导入 ${files.length} 张图片…`, 'info');
    void importFiles(files, importIntent, 'picker', operationId);
  };

  window.addEventListener('focus', onWindowFocus, { once: true });
  document.body.appendChild(input);
  try {
    input.click();
  } catch {
    settled = true;
    cleanup();
    emitDiagnosticResponse({ operationId, operation: 'image-picker', phase: 'failure', source: 'picker', durationMs: Date.now() - startedAt, reason: 'picker-failed' });
  }
}
