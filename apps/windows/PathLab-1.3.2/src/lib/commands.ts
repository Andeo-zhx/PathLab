import { useUi } from '../store/uiStore';
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
  arrangeImages,
  importFromClipboard,
} from './actions';
import type { SelectionRef } from './types';

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
        if (!ok) ui.toast('剪贴板中没有图片，试试用 ⌘V 粘贴对象', 'info');
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
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pathlab,application/zip';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void openProjectFromFile(file);
  };
  input.click();
}

export function pickImageFiles(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    if (files.length) window.dispatchEvent(new CustomEvent('pathlab:import-files', { detail: files }));
  };
  input.click();
}
