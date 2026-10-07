/**
 * 图片资源表。
 * 二进制不进历史快照，只保留几何数据在 ProjectDoc 中。
 * 显示用位图可能降采样，导出时使用原始像素位图。
 */
import { uid } from './id';
import type { Rect } from './types';

/** 超过该边长的图片在交互画布上使用降采样副本 */
const MAX_DISPLAY_EDGE = 2400;

export interface ImageResource {
  id: string;
  blob: Blob;
  objectUrl: string;
  /** 原始像素位图（导出用） */
  hiRes: HTMLImageElement;
  /** 交互用位图（可能降采样） */
  display: HTMLImageElement | HTMLCanvasElement;
  originalWidth: number;
  originalHeight: number;
  downscaled: boolean;
}

const registry = new Map<string, ImageResource>();
const listeners = new Set<() => void>();

export function onResourcesChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((l) => l());
}

export function getResource(id: string): ImageResource | undefined {
  return registry.get(id);
}

export function listResources(): ImageResource[] {
  return [...registry.values()];
}

export function registerResource(res: ImageResource): void {
  const previous = registry.get(res.id);
  if (previous && previous !== res) URL.revokeObjectURL(previous.objectUrl);
  registry.set(res.id, res);
  notify();
}

export function registerResources(resources: readonly ImageResource[]): void {
  if (!resources.length) return;
  for (const res of resources) {
    const previous = registry.get(res.id);
    if (previous && previous !== res) URL.revokeObjectURL(previous.objectUrl);
    registry.set(res.id, res);
  }
  notify();
}

export function dropResource(id: string): void {
  const res = registry.get(id);
  if (res) {
    URL.revokeObjectURL(res.objectUrl);
    registry.delete(id);
    notify();
  }
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败：可能是浏览器不支持的格式（如 TIFF）'));
    img.src = url;
  });
}

function makeDisplayCopy(img: HTMLImageElement): {
  source: HTMLImageElement | HTMLCanvasElement;
  downscaled: boolean;
} {
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= MAX_DISPLAY_EDGE) return { source: img, downscaled: false };
  const k = MAX_DISPLAY_EDGE / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { source: img, downscaled: false };
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { source: canvas, downscaled: true };
}

export async function decodeResourceFromBlob(blob: Blob, id = uid('r')): Promise<ImageResource> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const hiRes = await loadImageElement(objectUrl);
    if (hiRes.naturalWidth < 1 || hiRes.naturalHeight < 1) throw new Error('图片像素尺寸无效');
    const { source, downscaled } = makeDisplayCopy(hiRes);
    const res: ImageResource = {
      id,
      blob,
      objectUrl,
      hiRes,
      display: source,
      originalWidth: hiRes.naturalWidth,
      originalHeight: hiRes.naturalHeight,
      downscaled,
    };
    return res;
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

/** Decode and publish one resource for callers that are not doing a staged import. */
export async function createResourceFromBlob(blob: Blob, id = uid('r')): Promise<ImageResource> {
  const res = await decodeResourceFromBlob(blob, id);
  registerResource(res);
  return res;
}

/** Revoke a staged resource that was never committed to the live registry. */
export function disposeResource(res: ImageResource): void {
  if (registry.get(res.id) !== res) URL.revokeObjectURL(res.objectUrl);
}

/** Convert original-image crop coordinates to the source pixels of a chosen bitmap. */
export function cropForBitmap(res: ImageResource, crop: Rect, hiRes = false): Rect {
  const bitmap = hiRes ? res.hiRes : res.display;
  const width = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
  const height = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
  const scaleX = width / res.originalWidth;
  const scaleY = height / res.originalHeight;
  return {
    x: crop.x * scaleX,
    y: crop.y * scaleY,
    width: crop.width * scaleX,
    height: crop.height * scaleY,
  };
}

export function guessExtension(mime: string, fileName?: string): string {
  if (fileName) {
    const m = /\.([a-z0-9]+)$/i.exec(fileName);
    if (m) return m[1].toLowerCase();
  }
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/bmp':
      return 'bmp';
    case 'image/avif':
      return 'avif';
    default:
      return 'bin';
  }
}
