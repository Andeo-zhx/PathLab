import { useProject } from './projectStore';
import { useUi } from './uiStore';
import { decodeResourceFromBlob, disposeResource, dropResource, getResource, registerResources, type ImageResource } from '../lib/resources';
import { getAsset, loadLatestDraft, putAsset, saveDraft } from '../lib/db';
import type { ProjectDoc } from '../lib/types';
import { PROJECT_VERSION } from '../lib/types';
import { migrateProject } from '../lib/migrate';
import { validateProjectStructure } from '../lib/projectFile';

const persisted = new Set<string>();
let timer: number | null = null;
let stopped = false;
let saveQueue: Promise<void> = Promise.resolve();
let draftRestoreGeneration = 0;
let lastSaveFailureToastAt = 0;

function enqueueSnapshot(project: ProjectDoc): Promise<void> {
  const save = saveQueue.then(async () => {
    if (!hasRecoverableContent(project) && project.title === '未命名工程' && project.updatedAt === project.createdAt) return;
    for (const img of project.images) {
      if (persisted.has(img.resourceId)) continue;
      const res = getResource(img.resourceId);
      if (!res) continue;
      await putAsset(res.id, res.blob);
      persisted.add(res.id);
    }
    await saveDraft(project);
    if (useProject.getState().project === project) useUi.getState().flashSaved();
  });
  saveQueue = save.catch(() => undefined);
  return save;
}

async function persistCurrent(): Promise<void> {
  if (stopped) return;
  await enqueueSnapshot(useProject.getState().project);
}

function cancelScheduledSave(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
}

function scheduleSave(): void {
  cancelScheduledSave();
  timer = window.setTimeout(() => {
    timer = null;
    void persistCurrent().catch(() => {
      const now = Date.now();
      if (now - lastSaveFailureToastAt < 8000) return;
      lastSaveFailureToastAt = now;
      useUi.getState().toast('自动保存失败，请检查设备存储空间后重试', 'error');
    });
  }, 900);
}

export function startAutosave(): () => void {
  stopped = false;
  const unsub = useProject.subscribe(scheduleSave);
  const onHide = () => {
    void flushAutosave().catch(() => undefined);
  };
  window.addEventListener('pagehide', onHide);
  window.addEventListener('beforeunload', onHide);
  return () => {
    stopped = true;
    unsub();
    cancelScheduledSave();
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('beforeunload', onHide);
  };
}

/** Save the latest stable project snapshot before replacing the active project. */
export async function flushAutosave(): Promise<void> {
  cancelScheduledSave();
  while (true) {
    const snapshot = useProject.getState().project;
    await enqueueSnapshot(snapshot);
    if (useProject.getState().project === snapshot) {
      cancelScheduledSave();
      return;
    }
    cancelScheduledSave();
  }
}

/** Prevent a slow startup restore from replacing a project after the user has requested an image import. */
export function cancelPendingDraftRestore(): void {
  draftRestoreGeneration += 1;
}

function hasTextContent(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasTextContent);
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string' && record.text.length > 0) return true;
  return hasTextContent(record.content);
}

function hasRecoverableContent(project: ProjectDoc): boolean {
  return project.images.length > 0 || project.annotations.length > 0 || project.magnifiers.length > 0 || hasTextContent(project.textDocument);
}

/** Restore the latest draft only if the user has not edited or switched projects meanwhile. */
export async function restoreLatestDraft(): Promise<boolean> {
  const initial = useProject.getState();
  const initialProject = initial.project;
  const transition = initial.projectTransition;
  const restoreGeneration = draftRestoreGeneration;
  const staged: ImageResource[] = [];
  let resourcesRegistered = false;
  let projectCommitted = false;
  try {
    const storedDraft = await loadLatestDraft();
    if (!storedDraft || !Number.isInteger(storedDraft.version) || storedDraft.version > PROJECT_VERSION) return false;
    const draft = migrateProject(storedDraft);
    if (!draft.textDocument) draft.textDocument = { type: 'doc', content: [{ type: 'paragraph' }] };
    const structureError = validateProjectStructure(draft);
    if (structureError) {
      useUi.getState().toast(`自动草稿数据无效，已保留当前工程：${structureError}`, 'error');
      return false;
    }
    if (!hasRecoverableContent(draft)) return false;

    const imagesByResource = new Map<string, typeof draft.images>();
    for (const image of draft.images) {
      if (typeof image?.resourceId !== 'string' || !image.resourceId) continue;
      const images = imagesByResource.get(image.resourceId) ?? [];
      images.push(image);
      imagesByResource.set(image.resourceId, images);
    }
    const missing: string[] = [];
    for (const [resourceId, images] of imagesByResource) {
      const blob = await getAsset(resourceId);
      if (!blob) {
        missing.push(resourceId);
        continue;
      }
      try {
        const resource = await decodeResourceFromBlob(blob, resourceId);
        const dimensionsMatch = images.every(
          (image) => resource.originalWidth === image.originalWidth && resource.originalHeight === image.originalHeight,
        );
        if (!dimensionsMatch) {
          disposeResource(resource);
          missing.push(resourceId);
          continue;
        }
        staged.push(resource);
      } catch {
        missing.push(resourceId);
      }
    }

    const latest = useProject.getState();
    if (
      latest.projectTransition !== transition ||
      latest.project !== initialProject ||
      draftRestoreGeneration !== restoreGeneration
    ) {
      staged.forEach(disposeResource);
      return false;
    }

    resourcesRegistered = true;
    registerResources(staged);
    if (!latest.commitProjectTransition(draft, transition)) {
      staged.forEach((res) => dropResource(res.id));
      return false;
    }
    projectCommitted = true;
    staged.forEach((res) => persisted.add(res.id));
    useUi.getState().clearSelection();
    useUi.getState().setCrop(null, null);
    useUi.getState().bumpTextSync();
    if (missing.length) useUi.getState().toast(`草稿已恢复，但有 ${missing.length} 张图片资源暂不可用`, 'error');
    return true;
  } catch {
    if (!projectCommitted && resourcesRegistered) staged.forEach((res) => dropResource(res.id));
    else if (!resourcesRegistered) staged.forEach(disposeResource);
    useUi.getState().toast('自动草稿无法安全恢复，已保留当前工程', 'error');
    return false;
  }
}

export function markPersisted(id: string): void {
  persisted.add(id);
}
