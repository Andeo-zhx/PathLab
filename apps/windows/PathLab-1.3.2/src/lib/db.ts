import Dexie, { type Table } from 'dexie';
import type { ProjectDoc } from './types';

export interface AssetRow {
  id: string;
  blob: Blob;
}

export interface DraftRow {
  id: string;
  project: ProjectDoc;
  updatedAt: number;
}

class PathLabDB extends Dexie {
  assets!: Table<AssetRow, string>;
  drafts!: Table<DraftRow, string>;

  constructor() {
    super('pathlab');
    this.version(1).stores({
      assets: 'id',
      drafts: 'id, updatedAt',
    });
  }
}

export const db = new PathLabDB();

export async function putAsset(id: string, blob: Blob): Promise<void> {
  await db.assets.put({ id, blob });
}

export async function putAssets(assets: readonly AssetRow[]): Promise<void> {
  if (!assets.length) return;
  await db.transaction('rw', db.assets, async () => {
    await db.assets.bulkPut([...assets]);
  });
}

export async function getAsset(id: string): Promise<Blob | undefined> {
  const row = await db.assets.get(id);
  return row?.blob;
}

export async function deleteAsset(id: string): Promise<void> {
  await db.assets.delete(id);
}

export async function deleteAssets(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  await db.transaction('rw', db.assets, async () => {
    await db.assets.bulkDelete([...ids]);
  });
}

export async function saveDraft(project: ProjectDoc): Promise<void> {
  await db.drafts.put({ id: project.id, project, updatedAt: Date.now() });
}

export async function loadLatestDraft(): Promise<ProjectDoc | null> {
  const rows = await db.drafts.orderBy('updatedAt').reverse().limit(1).toArray();
  return rows.length ? rows[0].project : null;
}

export async function loadDraft(id: string): Promise<ProjectDoc | null> {
  const row = await db.drafts.get(id);
  return row?.project ?? null;
}

export async function listDrafts(): Promise<{ id: string; title: string; updatedAt: number }[]> {
  const rows = await db.drafts.orderBy('updatedAt').reverse().toArray();
  return rows.map((r) => ({ id: r.id, title: r.project.title, updatedAt: r.updatedAt }));
}

export async function deleteDraft(id: string): Promise<void> {
  await db.drafts.delete(id);
}

/** 清理没有工程引用的资源 */
export async function pruneAssets(keepIds: Set<string>): Promise<void> {
  const all = await db.assets.toArray();
  const stale = all.filter((a) => !keepIds.has(a.id)).map((a) => a.id);
  if (stale.length) await db.assets.bulkDelete(stale);
}
