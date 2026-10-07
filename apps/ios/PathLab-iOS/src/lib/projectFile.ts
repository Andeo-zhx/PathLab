import JSZip from 'jszip';
import { decodeResourceFromBlob, disposeResource, getResource, guessExtension, type ImageResource } from './resources';
import { isNativeApp } from './native';
import { shareBlobFromNative } from './nativeFiles';
import type { AnnotationType, ProjectDoc, Rect } from './types';
import { EMPTY_TEXT_DOC, PROJECT_VERSION } from './types';
import { getAsset } from './db';
import { migrateProject } from './migrate';
import { uid } from './id';

export const PROJECT_EXT = '.pathlab';

interface AssetManifestEntry {
  resourceId: string;
  mimeType: string;
  path: string;
  fileName: string;
}

/**
 * 打包为 .pathlab（ZIP 容器：project.json + assets/*）。
 * project.json 中的 resourceId 指向 assets 内的二进制。
 */
export async function packProject(project: ProjectDoc): Promise<Blob> {
  const zip = new JSZip();
  const manifest: AssetManifestEntry[] = [];
  const used = new Set(project.images.map((img) => img.resourceId));
  const missingResources: string[] = [];

  used.forEach((resourceId) => {
    const res = getResource(resourceId);
    if (!res) {
      missingResources.push(resourceId);
      return;
    }
    const ext = guessExtension(res.blob.type, '');
    const path = `assets/${resourceId}.${ext}`;
    zip.file(path, res.blob);
    manifest.push({
      resourceId,
      mimeType: res.blob.type || 'application/octet-stream',
      path,
      fileName: `${resourceId}.${ext}`,
    });
  });

  if (missingResources.length) {
    throw new Error(`有 ${missingResources.length} 张图片的原始资源当前不可用，已取消导出以避免生成无法重新打开的工程。请重新导入图片后再试。`);
  }

  const doc = {
    kind: 'pathlab-project',
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    assets: manifest,
    project: { ...project, updatedAt: new Date().toISOString() },
  };
  zip.file('project.json', JSON.stringify(doc, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export interface UnpackedProject {
  project: ProjectDoc;
  resources: ImageResource[];
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function validRect(value: unknown, allowZero = false): value is Rect {
  if (!isRecord(value) || !finite(value.x) || !finite(value.y) || !finite(value.width) || !finite(value.height)) return false;
  return allowZero ? value.width >= 0 && value.height >= 0 : value.width > 0 && value.height > 0;
}

function validPoint(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && finite(value.x) && finite(value.y);
}

function validTextNode(value: unknown, depth = 0): boolean {
  if (depth > 100 || !isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'text' && typeof value.text !== 'string') return false;
  if (value.content !== undefined && (!Array.isArray(value.content) || !value.content.every((node) => validTextNode(node, depth + 1)))) return false;
  if (value.attrs !== undefined && !isRecord(value.attrs)) return false;
  if (value.marks !== undefined && (!Array.isArray(value.marks) || !value.marks.every((mark) => isRecord(mark) && typeof mark.type === 'string'))) return false;
  return true;
}

export function validateProjectStructure(value: unknown, beforeMigration = false): string | null {
  if (!isRecord(value)) return '工程结构不是对象。';
  const p = value;
  if (!Number.isInteger(p.version) || (p.version as number) < 1 || (p.version as number) > PROJECT_VERSION) return '工程版本不受当前 PathLab 支持。';
  if (typeof p.id !== 'string' || !p.id || typeof p.title !== 'string') return '工程缺少有效的 ID 或标题。';
  if (typeof p.createdAt !== 'string' || typeof p.updatedAt !== 'string') return '工程时间信息不完整。';
  if (!isRecord(p.canvas) || !positive(p.canvas.zoom) || !finite(p.canvas.panX) || !finite(p.canvas.panY)) return '画布视图数据无效。';
  if (!Array.isArray(p.images) || !Array.isArray(p.annotations) || !Array.isArray(p.magnifiers)) return '工程对象列表不完整。';
  if (!isRecord(p.textDocument) || p.textDocument.type !== 'doc' || !Array.isArray(p.textDocument.content) || !p.textDocument.content.every((node) => validTextNode(node))) return '观察记录结构无效。';

  const ids = new Set<string>();
  const imageIds = new Set<string>();
  const addId = (item: RecordValue, kind: string): string | null => {
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) return `${kind} ID 缺失或重复。`;
    ids.add(item.id);
    return null;
  };

  for (const item of p.images) {
    if (!isRecord(item)) return '图片对象结构无效。';
    const idError = addId(item, '图片');
    if (idError) return idError;
    imageIds.add(item.id as string);
    if (typeof item.resourceId !== 'string' || !item.resourceId || typeof item.fileName !== 'string' || typeof item.mimeType !== 'string') return '图片资源引用不完整。';
    if (!positive(item.originalWidth) || !positive(item.originalHeight) || !finite(item.x) || !finite(item.y) || !positive(item.width) || !positive(item.height)) return '图片几何数据无效。';
    if (!validRect(item.crop) || item.crop.x < 0 || item.crop.y < 0 || item.crop.x + item.crop.width > item.originalWidth + 1 || item.crop.y + item.crop.height > item.originalHeight + 1) return '图片裁切数据超出原图范围。';
    if (!finite(item.rotation) || !finite(item.zIndex) || !finite(item.opacity) || item.opacity < 0 || item.opacity > 1 || !finite(item.cornerRadius)) return '图片显示属性无效。';
    if (typeof item.locked !== 'boolean' || typeof item.visible !== 'boolean' || typeof item.annotationsVisible !== 'boolean') return '图片状态字段无效。';
  }

  const annotationTypes = new Set<AnnotationType>(['rect', 'ellipse', 'polygon', 'freehand', 'arrow', 'line', 'text']);
  for (const item of p.annotations) {
    if (!isRecord(item)) return '标注对象结构无效。';
    const idError = addId(item, '标注');
    if (idError) return idError;
    if (typeof item.type !== 'string' || !annotationTypes.has(item.type as AnnotationType) || (item.parentImageId !== null && (typeof item.parentImageId !== 'string' || !imageIds.has(item.parentImageId)))) return '标注类型或宿主图片引用无效。';
    if (!isRecord(item.geometry) || !finite(item.zIndex) || typeof item.stroke !== 'string' || !positive(item.strokeWidth) || !Array.isArray(item.dash) || !item.dash.every(finite) || (item.fill !== null && typeof item.fill !== 'string') || typeof item.visible !== 'boolean' || typeof item.locked !== 'boolean') return '标注样式或几何结构无效。';
    const geometry = item.geometry;
    if ((item.type === 'rect' || item.type === 'ellipse') && !validRect(geometry.rect, true)) return '矩形或椭圆标注缺少有效区域。';
    if ((item.type === 'polygon' || item.type === 'freehand' || item.type === 'arrow' || item.type === 'line') && (!Array.isArray(geometry.points) || geometry.points.length < (item.type === 'polygon' ? 3 : 2) || !geometry.points.every(validPoint))) return '线条或多边形标注的点列无效。';
    if (item.type === 'text' && (!validPoint(geometry.position) || typeof item.text !== 'string')) return '文字标注结构无效。';
    if (item.textStyle !== undefined && (!isRecord(item.textStyle) || !positive(item.textStyle.fontSize) || !finite(item.textStyle.fontWeight) || (item.textStyle.fontFamily !== undefined && typeof item.textStyle.fontFamily !== 'string') || (item.textStyle.fontStyle !== 'normal' && item.textStyle.fontStyle !== 'italic') || !['left', 'center', 'right'].includes(String(item.textStyle.align)) || typeof item.textStyle.color !== 'string' || (item.textStyle.background !== null && typeof item.textStyle.background !== 'string') || (item.textStyle.outline !== null && typeof item.textStyle.outline !== 'string'))) return '文字标注样式结构无效。';
  }

  for (const item of p.magnifiers) {
    if (!isRecord(item)) return '放大引用对象结构无效。';
    const idError = addId(item, '放大引用');
    if (idError) return idError;
    if (typeof item.sourceImageId !== 'string' || !imageIds.has(item.sourceImageId) || !validRect(item.sourceRegion) || (!beforeMigration && !positive(item.zoom))) return '放大引用的源图片或区域无效。';
    if (item.destination !== undefined && (!isRecord(item.destination) || !finite(item.destination.x) || !finite(item.destination.y) || !finite(item.destination.radius))) return '放大引用的目标位置无效。';
    if ((!beforeMigration && typeof item.roiColor !== 'string') || typeof item.borderColor !== 'string' || !positive(item.borderWidth) || !finite(item.zIndex) || typeof item.connectorVisible !== 'boolean' || typeof item.visible !== 'boolean' || typeof item.locked !== 'boolean') return '放大引用的显示属性无效。';
  }
  return null;
}

export async function unpackProject(file: Blob): Promise<UnpackedProject> {
  const zip = await JSZip.loadAsync(file).catch(() => null);
  if (!zip) throw new Error('无法读取此文件；请确认选择的是 PathLab 导出的 .pathlab 工程。');
  const manifestFile = zip.file('project.json');
  if (!manifestFile) throw new Error('不是有效的 .pathlab 文件（缺少 project.json）');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await manifestFile.async('string'));
  } catch {
    throw new Error('.pathlab 文件中的工程数据无法解析，文件可能已损坏。');
  }
  if (!isRecord(parsed)) {
    throw new Error('.pathlab 文件中的工程数据结构无效。');
  }
  const raw = parsed;

  if (raw.kind !== 'pathlab-project' || !Number.isInteger(raw.version) || (raw.version as number) < 1 || (raw.version as number) > PROJECT_VERSION) {
    throw new Error('工程封装版本无效或高于当前 PathLab 支持的版本。');
  }
  if (!isRecord(raw.project)) {
    throw new Error('不是有效的 .pathlab 工程文件（缺少工程数据）。');
  }
  if (raw.project.version === undefined) raw.project.version = raw.version;
  if (raw.project.images === undefined) raw.project.images = [];
  if (raw.project.annotations === undefined) raw.project.annotations = [];
  if (raw.project.magnifiers === undefined) raw.project.magnifiers = [];
  if (raw.project.canvas === undefined) raw.project.canvas = { zoom: 1, panX: 0, panY: 0 };
  if (raw.project.textDocument === undefined) raw.project.textDocument = JSON.parse(JSON.stringify(EMPTY_TEXT_DOC)) as unknown;
  const shapeError = validateProjectStructure(raw.project, true);
  if (shapeError) throw new Error(`.pathlab 工程数据无效：${shapeError}`);
  const project = migrateProject(raw.project) as ProjectDoc;
  const postMigrationError = validateProjectStructure(project);
  if (postMigrationError) throw new Error(`迁移后的工程数据无效：${postMigrationError}`);

  if (raw.assets === undefined && project.images.length === 0) raw.assets = [];
  if (!Array.isArray(raw.assets)) throw new Error('.pathlab 工程缺少图片资源清单。');
  const manifest = new Map<string, AssetManifestEntry>();
  const paths = new Set<string>();
  for (const value of raw.assets) {
    if (!isRecord(value) || typeof value.resourceId !== 'string' || !value.resourceId || typeof value.path !== 'string' || !value.path.startsWith('assets/') || value.path.split('/').includes('..') || typeof value.mimeType !== 'string' || typeof value.fileName !== 'string') {
      throw new Error('.pathlab 图片资源清单中存在无效条目。');
    }
    if (manifest.has(value.resourceId) || paths.has(value.path)) throw new Error('.pathlab 图片资源清单中存在重复引用。');
    manifest.set(value.resourceId, value as unknown as AssetManifestEntry);
    paths.add(value.path);
  }

  const originalIds = new Set(project.images.map((img) => img.resourceId));
  for (const id of originalIds) {
    if (!manifest.has(id)) throw new Error(`.pathlab 工程缺少图片资源 ${id}，已保留当前工程。`);
  }

  const resources: ImageResource[] = [];
  try {
    const idMap = new Map<string, string>();
    for (const oldId of originalIds) {
      const entry = manifest.get(oldId)!;
      const zipped = zip.file(entry.path);
      if (!zipped || zipped.dir) throw new Error(`.pathlab 工程中的图片资源 ${oldId} 不完整，已保留当前工程。`);
      const blob = await zipped.async('blob');
      const typed = entry.mimeType ? new Blob([blob], { type: entry.mimeType }) : blob;
      let id = '';
      do {
        id = uid('r');
      } while (getResource(id) || (await getAsset(id)));
      let decoded: ImageResource;
      try {
        decoded = await decodeResourceFromBlob(typed, id);
      } catch {
        throw new Error(`.pathlab 工程中的图片资源 ${oldId} 无法验证或解码，已保留当前工程。`);
      }
      resources.push(decoded);
      const references = project.images.filter((img) => img.resourceId === oldId);
      if (references.some((img) => img.originalWidth !== decoded.originalWidth || img.originalHeight !== decoded.originalHeight)) {
        throw new Error(`.pathlab 工程中的图片资源 ${oldId} 像素尺寸与工程记录不一致，已保留当前工程。`);
      }
      idMap.set(oldId, id);
    }
    const remapped: ProjectDoc = {
      ...project,
      images: project.images.map((img) => ({ ...img, resourceId: idMap.get(img.resourceId)! })),
    };
    return { project: remapped, resources };
  } catch (error) {
    resources.forEach(disposeResource);
    throw error;
  }
}

export async function downloadBlob(blob: Blob, fileName: string): Promise<void> {
  if (isNativeApp()) {
    await shareBlobFromNative(blob, fileName);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadDataUrl(dataUrl: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function safeFileName(name: string): string {
  return (name || '未命名工程').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
}
