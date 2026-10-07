import { useProject, changeZ } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import type {
  AnnotationObject,
  ImageObject,
  MagnifierObject,
  ProjectDoc,
  Rect,
  SelectionRef,
} from './types';
import {
  decodeResourceFromBlob,
  disposeResource,
  dropResource,
  getResource,
  listResources,
  registerResources,
  type ImageResource,
} from './resources';
import { createImageObject } from './factory';
import { imageAABB } from './geometry';
import { deleteAssets, getAsset, putAssets } from './db';
import { downloadBlob, packProject, safeFileName, unpackProject, PROJECT_EXT } from './projectFile';
import { isIOSApp, isNativeApp } from './native';
import { viewport, viewCommands } from './viewport';
import { uid } from './id';
import { cancelPendingDraftRestore, flushAutosave, markPersisted } from '../store/autosave';
import { createDiagnosticOperationId, emitDiagnosticResponse, type DiagnosticPhase, type DiagnosticReason, type DiagnosticOperation } from './diagnostics';

/* ---------------- 导入 ---------------- */

const MAX_IMPORT_EDGE = 1400;
const IMPORT_GAP = 26;

let imageImportQueue: Promise<number> = Promise.resolve(0);
let projectOpenGeneration = 0;
let lastImportCancellationToastAt = 0;

export function requestProjectOpenIntent(): number {
  return ++projectOpenGeneration;
}

export function requestImageImportIntent(): number {
  return ++projectOpenGeneration;
}

type ImportSource = 'picker' | 'drop' | 'paste' | 'clipboard' | 'native-files' | 'shortcut' | 'unknown';

function finishImageImport(
  operationId: string,
  parentOperationId: string | undefined,
  source: ImportSource,
  startedAt: number,
  phase: DiagnosticPhase,
  extra: { requestedCount?: number; successCount?: number; failureCount?: number; reason?: DiagnosticReason } = {},
): void {
  emitDiagnosticResponse({
    operationId,
    operation: 'image-import',
    parentOperationId,
    phase,
    source,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...extra,
  });
}

function toastImportCancelled(): void {
  const now = Date.now();
  if (now - lastImportCancellationToastAt < 1500) return;
  lastImportCancellationToastAt = now;
  useUi.getState().toast('图片导入已取消，因为有更新的文件操作', 'info');
}

export function importFiles(files: File[] | FileList, requestedGeneration?: number, source: ImportSource = 'unknown', parentOperationId?: string): Promise<number> {
  const requestedFiles = Array.from(files);
  const importGeneration = requestedGeneration ?? requestImageImportIntent();
  const operationId = createDiagnosticOperationId('image-import');
  const startedAt = Date.now();
  emitDiagnosticResponse({ operationId, parentOperationId, operation: 'image-import', phase: 'start', source, requestedCount: requestedFiles.length });
  if (importGeneration !== projectOpenGeneration) {
    toastImportCancelled();
    finishImageImport(operationId, parentOperationId, source, startedAt, 'cancelled', { requestedCount: requestedFiles.length, reason: 'superseded' });
    return Promise.resolve(0);
  }
  cancelPendingDraftRestore();
  const transition = useProject.getState().projectTransition;
  const operation = imageImportQueue
    .then(() => loadImageFiles(requestedFiles, transition, importGeneration, operationId, parentOperationId, source, startedAt))
    .catch((error: unknown) => {
      finishImageImport(operationId, parentOperationId, source, startedAt, 'failure', {
        requestedCount: requestedFiles.length,
        reason: 'unknown',
      });
      useUi.getState().toast(error instanceof Error ? error.message : '图片导入发生未预期错误', 'error');
      return 0;
    });
  imageImportQueue = operation;
  return operation;
}

async function uniqueResourceId(): Promise<string> {
  let id = '';
  do {
    id = uid('r');
  } while (getResource(id) || (await getAsset(id)));
  return id;
}

async function loadImageFiles(
  files: File[],
  transition: number,
  importGeneration: number,
  operationId: string,
  parentOperationId: string | undefined,
  source: ImportSource,
  startedAt: number,
): Promise<number> {
  const isCurrent = () =>
    projectOpenGeneration === importGeneration && useProject.getState().isProjectTransitionCurrent(transition);
  if (!isCurrent()) {
    toastImportCancelled();
    finishImageImport(operationId, parentOperationId, source, startedAt, 'cancelled', { requestedCount: files.length, reason: 'superseded' });
    return 0;
  }
  const list = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name));
  if (!list.length) {
    useUi.getState().toast('没有可导入的图片文件', 'error');
    finishImageImport(operationId, parentOperationId, source, startedAt, 'failure', { requestedCount: files.length, reason: 'no-files' });
    return 0;
  }
  const resources: ImageResource[] = [];
  const created: ImageObject[] = [];
  let failedCount = 0;

  for (const file of list) {
    try {
      const res = await decodeResourceFromBlob(file, await uniqueResourceId());
      resources.push(res);
      const box = await computeImportBox(res.originalWidth, res.originalHeight);
      created.push(
        createImageObject(
          res,
          box,
          created.length,
          file.name,
        ),
      );
    } catch (err) {
      failedCount += 1;
      useUi.getState().toast(err instanceof Error ? err.message : '图片导入失败', 'error');
    }
  }
  if (!created.length) {
    resources.forEach(disposeResource);
    finishImageImport(operationId, parentOperationId, source, startedAt, 'failure', {
      requestedCount: files.length,
      successCount: 0,
      failureCount: Math.max(failedCount, list.length),
      reason: 'decode-failed',
    });
    return 0;
  }

  if (!isCurrent()) {
    resources.forEach(disposeResource);
    toastImportCancelled();
    finishImageImport(operationId, parentOperationId, source, startedAt, 'cancelled', { requestedCount: files.length, reason: 'superseded' });
    return 0;
  }

  try {
    await putAssets(resources.map((res) => ({ id: res.id, blob: res.blob })));
  } catch (error) {
    resources.forEach(disposeResource);
    useUi.getState().toast(error instanceof Error ? error.message : '图片资源保存失败，未导入图片', 'error');
    finishImageImport(operationId, parentOperationId, source, startedAt, 'failure', { requestedCount: files.length, reason: 'asset-storage' });
    return 0;
  }

  if (!isCurrent()) {
    await deleteAssets(resources.map((res) => res.id)).catch(() => undefined);
    resources.forEach(disposeResource);
    toastImportCancelled();
    finishImageImport(operationId, parentOperationId, source, startedAt, 'cancelled', { requestedCount: files.length, reason: 'superseded' });
    return 0;
  }

  const existingImages = useProject.getState().project.images;
  let nextImageZIndex = existingImages.reduce((highest, image) => Math.max(highest, image.zIndex), -1) + 1;
  created.forEach((img) => { img.zIndex = nextImageZIndex++; });
  arrangeNewImports(created);
  registerResources(resources);
  try {
    useProject.getState().applyWithHistory('导入图片', (d) => {
      d.images.push(...created);
    });
  } catch (error) {
    resources.forEach((res) => dropResource(res.id));
    await deleteAssets(resources.map((res) => res.id)).catch(() => undefined);
    useUi.getState().toast(error instanceof Error ? error.message : '图片导入失败', 'error');
    finishImageImport(operationId, parentOperationId, source, startedAt, 'failure', { requestedCount: files.length, reason: 'commit-failed' });
    return 0;
  }
  resources.forEach((res) => markPersisted(res.id));
  useUi.getState().setSelection(created.map((i) => ({ id: i.id, kind: 'image' as const })));

  const committed = useProject.getState();
  const total = committed.project.images.length;
  const committedProjectId = committed.project.id;
  if (total === created.length) {
    setTimeout(() => {
      const latest = useProject.getState();
      if (latest.projectTransition === transition && latest.project.id === committedProjectId) viewCommands.fit();
    }, 30);
  }
  useUi.getState().toast(`已导入 ${created.length} 张图片`, 'success');
  finishImageImport(operationId, parentOperationId, source, startedAt, failedCount ? 'partial' : 'success', {
    requestedCount: files.length,
    successCount: created.length,
    failureCount: failedCount,
  });
  scheduleImageVisibilityCheck('image-import', operationId, parentOperationId, committedProjectId, created.map((image) => image.id));
  return created.length;
}

function scheduleImageVisibilityCheck(
  operation: Extract<DiagnosticOperation, 'image-import' | 'project-open'>,
  operationId: string,
  parentOperationId: string | undefined,
  expectedProjectId: string,
  subjectImageIds?: string[],
): void {
  window.setTimeout(() => {
    const state = useProject.getState();
    if (state.project.id !== expectedProjectId) return;
    const canvas = state.project.canvas;
    const targets = subjectImageIds
      ? state.project.images.filter((image) => subjectImageIds.includes(image.id))
      : state.project.images;
    const visibleSubjectImageCount = targets.filter((image) => {
      const bounds = imageAABB(image);
      const left = bounds.x * canvas.zoom + canvas.panX;
      const top = bounds.y * canvas.zoom + canvas.panY;
      const right = (bounds.x + bounds.width) * canvas.zoom + canvas.panX;
      const bottom = (bounds.y + bounds.height) * canvas.zoom + canvas.panY;
      return right > 0 && bottom > 0 && left < viewport.width && top < viewport.height;
    }).length;
    const canvasMounted = Boolean(document.querySelector('.konvajs-content'));
    emitDiagnosticResponse({
      operationId,
      parentOperationId,
      operation,
      phase: 'visual-check',
      visualCheck: {
        canvasMounted,
        viewportWidth: Math.round(viewport.width),
        viewportHeight: Math.round(viewport.height),
        zoom: canvas.zoom,
        panX: canvas.panX,
        panY: canvas.panY,
        subjectImageCount: targets.length,
        visibleSubjectImageCount,
        projectImageCount: state.project.images.length,
      },
      reason: !canvasMounted
        ? 'canvas-not-mounted'
        : targets.length > 0 && visibleSubjectImageCount === 0
          ? 'outside-viewport'
          : undefined,
    });
  }, 120);
}

async function computeImportBox(w: number, h: number): Promise<Rect> {
  const longest = Math.max(w, h);
  const scale = longest > MAX_IMPORT_EDGE ? MAX_IMPORT_EDGE / longest : 1;
  return { x: 0, y: 0, width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function viewCenterWorld() {
  const v = useProject.getState().project.canvas;
  return {
    x: (viewport.width / 2 - v.panX) / v.zoom,
    y: (viewport.height / 2 - v.panY) / v.zoom,
  };
}

/** 新导入的图片以网格方式排布在视图中央 */
function arrangeNewImports(items: ImageObject[]): void {
  const center = viewCenterWorld();
  const n = items.length;
  const cols = Math.min(n, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  const colW: number[] = new Array(cols).fill(0);
  const rowH: number[] = new Array(rows).fill(0);
  items.forEach((img, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c], img.width);
    rowH[r] = Math.max(rowH[r], img.height);
  });
  const totalW = colW.reduce((a, b) => a + b, 0) + IMPORT_GAP * (cols - 1);
  const totalH = rowH.reduce((a, b) => a + b, 0) + IMPORT_GAP * (rows - 1);
  let y = center.y - totalH / 2;
  for (let r = 0; r < rows; r += 1) {
    let x = center.x - totalW / 2;
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (i >= n) break;
      const img = items[i];
      img.x = Math.round(x + (colW[c] - img.width) / 2);
      img.y = Math.round(y + (rowH[r] - img.height) / 2);
      x += colW[c] + IMPORT_GAP;
    }
    y += rowH[r] + IMPORT_GAP;
  }
}

export async function importFromClipboard(): Promise<boolean> {
  const importGeneration = requestImageImportIntent();
  const operationId = createDiagnosticOperationId('clipboard-import');
  const startedAt = Date.now();
  emitDiagnosticResponse({ operationId, operation: 'clipboard-import', phase: 'start', source: 'clipboard' });
  try {
    const items = await navigator.clipboard.read();
    const files: File[] = [];
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      files.push(new File([blob], `clipboard-${Date.now()}.png`, { type }));
    }
    if (!files.length) {
      emitDiagnosticResponse({ operationId, operation: 'clipboard-import', phase: 'empty', source: 'clipboard', durationMs: Date.now() - startedAt, reason: 'no-clipboard-image' });
      return false;
    }
    const importedCount = await importFiles(files, importGeneration, 'clipboard', operationId);
    emitDiagnosticResponse({
      operationId,
      parentOperationId: operationId,
      operation: 'clipboard-import',
      phase: importedCount > 0 ? 'success' : 'failure',
      source: 'clipboard',
      durationMs: Date.now() - startedAt,
      selectedCount: files.length,
      successCount: importedCount,
    });
    return importedCount > 0;
  } catch {
    emitDiagnosticResponse({ operationId, operation: 'clipboard-import', phase: 'failure', source: 'clipboard', durationMs: Date.now() - startedAt, reason: 'clipboard-unavailable' });
    return false;
  }
}

/* ---------------- 选择 ---------------- */

function collectDependents(project: ProjectDoc, removedImageIds: Set<string>) {
  return {
    annotations: project.annotations.filter((a) => a.parentImageId && removedImageIds.has(a.parentImageId)).map((a) => a.id),
    magnifiers: project.magnifiers.filter((m) => removedImageIds.has(m.sourceImageId)).map((m) => m.id),
  };
}

export function deleteSelection(selectionOverride?: readonly SelectionRef[]): void {
  const st = useProject.getState();
  const ui = useUi.getState();
  const selection = selectionOverride ?? ui.selection;
  if (!selection.length) return;
  const imageIds = new Set(selection.filter((s) => s.kind === 'image').map((s) => s.id));
  const annIds = new Set(selection.filter((s) => s.kind === 'annotation').map((s) => s.id));
  const magIds = new Set(selection.filter((s) => s.kind === 'magnifier').map((s) => s.id));
  const dependents = collectDependents(st.project, imageIds);
  dependents.annotations.forEach((id) => annIds.add(id));
  dependents.magnifiers.forEach((id) => magIds.add(id));

  if (!imageIds.size && !annIds.size && !magIds.size) return;
  st.applyWithHistory('删除对象', (d) => {
    d.images = d.images.filter((i) => !imageIds.has(i.id));
    d.annotations = d.annotations.filter((a) => !annIds.has(a.id));
    d.magnifiers = d.magnifiers.filter((m) => !magIds.has(m.id));
  });
  ui.setSelection([]);
  ui.setEditingText(null, null);
}

/* ---------------- 剪贴板 ---------------- */

let clipboard: {
  images: ImageObject[];
  annotations: AnnotationObject[];
  magnifiers: MagnifierObject[];
} | null = null;

function releaseUnusedResources(): void {
  const state = useProject.getState();
  const retained = new Set<string>();
  const addImages = (images: readonly ImageObject[]) => images.forEach((img) => retained.add(img.resourceId));
  addImages(state.project.images);
  state.past.forEach((entry) => addImages(entry.scene.images));
  state.future.forEach((entry) => addImages(entry.scene.images));
  if (state.pending) addImages(state.pending.scene.images);
  if (clipboard) addImages(clipboard.images);
  for (const res of listResources()) {
    if (!retained.has(res.id)) dropResource(res.id);
  }
}

useProject.subscribe(releaseUnusedResources);

export function copySelection(): void {
  const st = useProject.getState();
  const ui = useUi.getState();
  if (!ui.selection.length) return;
  const ids = new Set(ui.selection.map((s) => s.id));
  const images = st.project.images.filter((i) => ids.has(i.id));
  const annotations = st.project.annotations.filter((a) => ids.has(a.id) || (a.parentImageId && ids.has(a.parentImageId)));
  const magnifiers = st.project.magnifiers.filter((m) => ids.has(m.id) || ids.has(m.sourceImageId));
  clipboard = JSON.parse(JSON.stringify({ images, annotations, magnifiers }));
  releaseUnusedResources();
  ui.toast('已复制到剪贴板', 'info');
}

export function hasClipboard(): boolean {
  return Boolean(clipboard && (clipboard.images.length || clipboard.annotations.length || clipboard.magnifiers.length));
}

export function pasteObjects(): void {
  if (!clipboard) return;
  duplicatePayload(clipboard, 18, 18, true);
}

export function duplicateSelection(selectionOverride?: readonly SelectionRef[]): void {
  const st = useProject.getState();
  const ui = useUi.getState();
  const selection = selectionOverride ?? ui.selection;
  if (!selection.length) return;
  const ids = new Set(selection.map((s) => s.id));
  const payload = {
    images: st.project.images.filter((i) => ids.has(i.id)),
    annotations: st.project.annotations.filter((a) => ids.has(a.id) || (a.parentImageId && ids.has(a.parentImageId))),
    magnifiers: st.project.magnifiers.filter((m) => ids.has(m.id) || ids.has(m.sourceImageId)),
  };
  duplicatePayload(payload, 18, 18, false);
}

function duplicatePayload(
  payload: { images: ImageObject[]; annotations: AnnotationObject[]; magnifiers: MagnifierObject[] },
  dx: number,
  dy: number,
  fromClipboard: boolean,
): void {
  const st = useProject.getState();
  const ui = useUi.getState();
  const imageMap = new Map<string, string>();
  let z = st.project.images.reduce((m, i) => Math.max(m, i.zIndex), -1) + 1;
  const newImages: ImageObject[] = payload.images.map((img) => {
    const id = uid('img');
    imageMap.set(img.id, id);
    return { ...JSON.parse(JSON.stringify(img)), id, x: img.x + dx, y: img.y + dy, zIndex: z++, locked: false };
  });
  let az = st.project.annotations.reduce((m, a) => Math.max(m, a.zIndex), -1) + 1;
  const newAnns: AnnotationObject[] = payload.annotations.map((a) => {
    const copy = JSON.parse(JSON.stringify(a)) as AnnotationObject;
    copy.id = uid('ann');
    copy.zIndex = az++;
    copy.locked = false;
    const newParent = a.parentImageId ? imageMap.get(a.parentImageId) : null;
    if (a.parentImageId && !newParent) {
      // 标注被单独复制：保留在原图上，仅偏移
      copy.parentImageId = a.parentImageId;
      offsetAnnotation(copy, dx, dy, st.project);
    } else {
      copy.parentImageId = newParent ?? null;
    }
    return copy;
  });
  let mz = st.project.magnifiers.reduce((m, x) => Math.max(m, x.zIndex), -1) + 1;
  const newMags: MagnifierObject[] = payload.magnifiers
    .map((m) => {
      const newSource = imageMap.get(m.sourceImageId) ?? m.sourceImageId;
      const sourceExists = newImages.some((image) => image.id === newSource) || st.project.images.some((image) => image.id === newSource);
      if (!sourceExists) return null;
      const copy = JSON.parse(JSON.stringify(m)) as MagnifierObject;
      copy.id = uid('mag');
      copy.locked = false;
      copy.sourceImageId = newSource;
      copy.destination.x += dx;
      copy.destination.y += dy;
      copy.zIndex = mz++;
      return copy;
    })
    .filter((x): x is MagnifierObject => Boolean(x));

  st.applyWithHistory(fromClipboard ? '粘贴对象' : '复制对象', (d) => {
    d.images.push(...newImages);
    d.annotations.push(...newAnns);
    d.magnifiers.push(...newMags);
  });
  const picked: SelectionRef[] = [
    ...newImages.map((i) => ({ id: i.id, kind: 'image' as const })),
    ...newAnns.map((a) => ({ id: a.id, kind: 'annotation' as const })),
    ...newMags.map((m) => ({ id: m.id, kind: 'magnifier' as const })),
  ];
  if (picked.length) ui.setSelection(picked);
}

function offsetAnnotation(ann: AnnotationObject, dx: number, dy: number, project: ProjectDoc): void {
  const img = project.images.find((i) => i.id === ann.parentImageId);
  if (img) {
    const s = img.width / img.crop.width;
    dx = dx / s;
    dy = dy / s;
  }
  if (ann.geometry.rect) {
    ann.geometry.rect.x += dx;
    ann.geometry.rect.y += dy;
  }
  if (ann.geometry.points) ann.geometry.points = ann.geometry.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  if (ann.geometry.position) {
    ann.geometry.position.x += dx;
    ann.geometry.position.y += dy;
  }
}

export function selectAll(): void {
  const st = useProject.getState();
  const ui = useUi.getState();
  ui.setSelection([
    ...st.project.images.map((i) => ({ id: i.id, kind: 'image' as const })),
    ...st.project.annotations.map((a) => ({ id: a.id, kind: 'annotation' as const })),
    ...st.project.magnifiers.map((m) => ({ id: m.id, kind: 'magnifier' as const })),
  ]);
}

/* ---------------- 图片操作 ---------------- */

export function rotateImage(id: string): void {
  const st = useProject.getState();
  st.applyWithHistory('旋转图片', (d) => {
    const img = d.images.find((i) => i.id === id);
    if (!img) return;
    const cx = img.x + img.width / 2;
    const cy = img.y + img.height / 2;
    img.rotation = ((img.rotation + 90) % 360 + 360) % 360;
    const rad = (img.rotation * Math.PI) / 180;
    const w = Math.abs(img.width * Math.cos(rad)) + Math.abs(img.height * Math.sin(rad));
    const h = Math.abs(img.width * Math.sin(rad)) + Math.abs(img.height * Math.cos(rad));
    img.x = cx - w / 2;
    img.y = cy - h / 2;
  });
}

export function toggleLock(ref: SelectionRef): void {
  const st = useProject.getState();
  st.applyWithHistory('锁定状态', (d) => {
    if (ref.kind === 'image') {
      const t = d.images.find((i) => i.id === ref.id);
      if (t) t.locked = !t.locked;
    } else if (ref.kind === 'annotation') {
      const t = d.annotations.find((a) => a.id === ref.id);
      if (t) t.locked = !t.locked;
    } else {
      const t = d.magnifiers.find((m) => m.id === ref.id);
      if (t) t.locked = !t.locked;
    }
  });
}

export function toggleAnnotationsVisible(ref: SelectionRef): void {
  const st = useProject.getState();
  st.applyWithHistory('显示/隐藏标注', (d) => {
    const img = d.images.find((i) => i.id === ref.id);
    if (img) img.annotationsVisible = !img.annotationsVisible;
  });
}

export function toggleConnector(id: string): void {
  useProject.getState().applyWithHistory('显示/隐藏连接线', (d) => {
    const m = d.magnifiers.find((x) => x.id === id);
    if (m) m.connectorVisible = !m.connectorVisible;
  });
}

export function setImageCrop(id: string, crop: Rect): void {
  useProject.getState().applyWithHistory('裁切图片', (d) => {
    const img = d.images.find((i) => i.id === id);
    if (!img) return;
    img.crop = crop;
    const s = img.crop.width / img.originalWidth;
    void s;
  });
}

/* ---------------- 快速排版 ---------------- */

export function arrangeImages(mode: 'vertical' | 'horizontal' | 'grid'): void {
  const st = useProject.getState();
  const ui = useUi.getState();
  const ids = ui.selection.filter((s) => s.kind === 'image').map((s) => s.id);
  const targets = st.project.images.filter((i) => ids.includes(i.id));
  if (targets.length < 2) {
    ui.toast('请先选中至少两张图片', 'info');
    return;
  }
  const gap = 22;
  const boxes = targets.map((t) => ({ img: t, box: imageAABB(t) }));
  const totalArea = boxes.reduce((a, b) => a + b.box.width * b.box.height, 0);
  const minX = Math.min(...boxes.map((b) => b.box.x));
  const minY = Math.min(...boxes.map((b) => b.box.y));

  const placements = new Map<string, { x: number; y: number }>();

  if (mode === 'vertical') {
    const width = Math.max(...boxes.map((b) => b.box.width));
    let y = minY;
    for (const b of boxes) {
      placements.set(b.img.id, { x: minX + (width - b.box.width) / 2, y });
      y += b.box.height + gap;
    }
  } else if (mode === 'horizontal') {
    const height = Math.max(...boxes.map((b) => b.box.height));
    let x = minX;
    for (const b of boxes) {
      placements.set(b.img.id, { x, y: minY + (height - b.box.height) / 2 });
      x += b.box.width + gap;
    }
  } else {
    const cols = Math.max(2, Math.ceil(Math.sqrt(targets.length)));
    const rows = Math.ceil(targets.length / cols);
    const colW: number[] = new Array(cols).fill(0);
    const rowH: number[] = new Array(rows).fill(0);
    boxes.forEach((b, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      colW[c] = Math.max(colW[c], b.box.width);
      rowH[r] = Math.max(rowH[r], b.box.height);
    });
    let y = minY;
    for (let r = 0; r < rows; r += 1) {
      let x = minX;
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        if (i >= boxes.length) break;
        const b = boxes[i];
        placements.set(b.img.id, {
          x: x + (colW[c] - b.box.width) / 2,
          y: y + (rowH[r] - b.box.height) / 2,
        });
        x += colW[c] + gap;
      }
      y += rowH[r] + gap;
    }
    void totalArea;
  }

  st.applyWithHistory('快速排版', (d) => {
    for (const b of boxes) {
      const target = placements.get(b.img.id);
      const img = d.images.find((i) => i.id === b.img.id);
      if (!target || !img) continue;
      img.x += target.x - b.box.x;
      img.y += target.y - b.box.y;
    }
  });
}

export function bringToFrontSelection(): void {
  const ui = useUi.getState();
  ui.selection.forEach((ref) => changeZ(ref.kind, ref.id, 'front'));
}

/* ---------------- 工程文件 ---------------- */

export async function saveProjectToFile(): Promise<void> {
  const st = useProject.getState();
  const project = st.project;
  const operationId = createDiagnosticOperationId('project-save');
  const startedAt = Date.now();
  emitDiagnosticResponse({ operationId, operation: 'project-save', phase: 'start' });
  let bytes = 0;
  try {
    const blob = await packProject(project);
    bytes = blob.size;
    await downloadBlob(blob, `${safeFileName(project.title)}${PROJECT_EXT}`);
  } catch (error) {
    emitDiagnosticResponse({ operationId, operation: 'project-save', phase: 'failure', durationMs: Date.now() - startedAt, reason: 'share-failed' });
    useUi.getState().toast(
      error instanceof Error ? error.message : '无法保存或分享工程文件，请检查可用空间后重试',
      'error',
    );
    return;
  }
  emitDiagnosticResponse({ operationId, operation: 'project-save', phase: 'success', durationMs: Date.now() - startedAt, bytes });
  useUi.getState().flashSaved();
  useUi.getState().toast(
    isIOSApp()
      ? '工程已存入“文件”>“我的 iPad”>“PathLab”>“Exports”，分享面板也已打开'
      : isNativeApp()
        ? '已打开分享面板，可选择保存位置'
        : '工程已保存到下载目录',
    'success',
  );
}

let projectOpenQueue: Promise<void> = Promise.resolve();

export function openProjectFromFile(file: File | Blob, requestedGeneration?: number, parentOperationId?: string): Promise<void> {
  const openGeneration = requestedGeneration ?? requestProjectOpenIntent();
  const operationId = createDiagnosticOperationId('project-open');
  const startedAt = Date.now();
  emitDiagnosticResponse({ operationId, parentOperationId, operation: 'project-open', phase: 'start', bytes: file.size, mimeType: file.type || undefined });
  if (openGeneration !== projectOpenGeneration) {
    emitDiagnosticResponse({ operationId, parentOperationId, operation: 'project-open', phase: 'cancelled', durationMs: Date.now() - startedAt, reason: 'superseded' });
    useUi.getState().toast('工程打开已取消，因为有更新的文件操作', 'info');
    return Promise.resolve();
  }
  const transition = useProject.getState().beginProjectTransition();
  useUi.getState().setPendingPolygon(null);
  const operation = projectOpenQueue.then(() => loadProjectFromFile(file, transition, openGeneration, operationId, parentOperationId, startedAt));
  projectOpenQueue = operation.catch(() => undefined);
  return operation;
}

function resetUiForProjectSwitch(): void {
  const ui = useUi.getState();
  ui.clearSelection();
  ui.setCrop(null, null);
  ui.setEditingText(null, null);
  ui.setPendingPolygon(null);
  ui.setAnnotationsVisible(true);
  ui.setTranslationAnnotation(null);
  ui.setSpace(false);
  ui.bumpTextSync();
}

async function loadProjectFromFile(
  file: File | Blob,
  transition: number,
  openGeneration: number,
  operationId: string,
  parentOperationId: string | undefined,
  startedAt: number,
): Promise<void> {
  let resources: ImageResource[] = [];
  let assetsStored = false;
  let resourcesRegistered = false;
  let projectCommitted = false;
  let failureStage: DiagnosticReason = 'unpack-failed';
  const logCancelled = () => emitDiagnosticResponse({
    operationId,
    parentOperationId,
    operation: 'project-open',
    phase: 'cancelled',
    durationMs: Date.now() - startedAt,
    reason: 'superseded',
  });
  const isCurrent = () =>
    projectOpenGeneration === openGeneration && useProject.getState().isProjectTransitionCurrent(transition);
  try {
    if (!isCurrent()) {
      logCancelled();
      return;
    }
    const unpacked = await unpackProject(file);
    resources = unpacked.resources;
    if (!isCurrent()) {
      resources.forEach(disposeResource);
      logCancelled();
      return;
    }

    failureStage = 'autosave-failed';
    await flushAutosave();
    if (!isCurrent()) {
      resources.forEach(disposeResource);
      logCancelled();
      return;
    }

    failureStage = 'asset-storage';
    await putAssets(resources.map((res) => ({ id: res.id, blob: res.blob })));
    assetsStored = true;
    if (!isCurrent()) {
      await deleteAssets(resources.map((res) => res.id)).catch(() => undefined);
      assetsStored = false;
      resources.forEach(disposeResource);
      logCancelled();
      return;
    }

    failureStage = 'commit-failed';
    resourcesRegistered = true;
    registerResources(resources);
    if (!isCurrent() || !useProject.getState().commitProjectTransition(unpacked.project, transition)) {
      await deleteAssets(resources.map((res) => res.id)).catch(() => undefined);
      assetsStored = false;
      resources.forEach((res) => dropResource(res.id));
      resourcesRegistered = false;
      logCancelled();
      return;
    }
    projectCommitted = true;
    resources.forEach((res) => markPersisted(res.id));
    resetUiForProjectSwitch();
    const committedTransition = useProject.getState().projectTransition;
    setTimeout(() => {
      const latest = useProject.getState();
      if (latest.projectTransition === committedTransition && latest.project.id === unpacked.project.id) viewCommands.fit();
    }, 40);
    const opened = useProject.getState().project;
    emitDiagnosticResponse({
      operationId,
      parentOperationId,
      operation: 'project-open',
      phase: 'success',
      durationMs: Date.now() - startedAt,
      successCount: opened.images.length,
      annotationCount: opened.annotations.length,
      magnifierCount: opened.magnifiers.length,
    });
    scheduleImageVisibilityCheck('project-open', operationId, parentOperationId, unpacked.project.id);
    useUi.getState().toast('工程已打开', 'success');
  } catch (err) {
    if (!projectCommitted) {
      if (resourcesRegistered) resources.forEach((res) => dropResource(res.id));
      else resources.forEach(disposeResource);
      if (assetsStored) await deleteAssets(resources.map((res) => res.id)).catch(() => undefined);
    }
    emitDiagnosticResponse({
      operationId,
      parentOperationId,
      operation: 'project-open',
      phase: 'failure',
      durationMs: Date.now() - startedAt,
      reason: failureStage,
    });
    useUi.getState().toast(err instanceof Error ? err.message : '打开工程失败', 'error');
  }
}

export function startNewProject(): void {
  const operationId = createDiagnosticOperationId('new-project');
  const startedAt = Date.now();
  emitDiagnosticResponse({ operationId, operation: 'new-project', phase: 'start' });
  const openGeneration = ++projectOpenGeneration;
  const transition = useProject.getState().beginProjectTransition();
  useUi.getState().setPendingPolygon(null);
  void (async () => {
    try {
      await flushAutosave();
      const state = useProject.getState();
      if (projectOpenGeneration !== openGeneration || !state.isProjectTransitionCurrent(transition)) {
        emitDiagnosticResponse({ operationId, operation: 'new-project', phase: 'cancelled', durationMs: Date.now() - startedAt, reason: 'superseded' });
        return;
      }
      if (!state.commitNewProjectTransition(transition)) {
        emitDiagnosticResponse({ operationId, operation: 'new-project', phase: 'cancelled', durationMs: Date.now() - startedAt, reason: 'superseded' });
        return;
      }
      resetUiForProjectSwitch();
      emitDiagnosticResponse({ operationId, operation: 'new-project', phase: 'success', durationMs: Date.now() - startedAt });
    } catch (error) {
      if (useProject.getState().isProjectTransitionCurrent(transition)) {
        emitDiagnosticResponse({ operationId, operation: 'new-project', phase: 'failure', durationMs: Date.now() - startedAt, reason: 'autosave-failed' });
        useUi.getState().toast(
          error instanceof Error ? `草稿保存失败，未新建工程：${error.message}` : '草稿保存失败，未新建工程',
          'error',
        );
      } else {
        emitDiagnosticResponse({ operationId, operation: 'new-project', phase: 'cancelled', durationMs: Date.now() - startedAt, reason: 'superseded' });
      }
    }
  })();
}
