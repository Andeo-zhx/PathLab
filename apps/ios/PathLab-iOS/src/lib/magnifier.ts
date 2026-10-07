import type { ImageObject, MagnifierObject, Point, Rect } from './types';
import { imageDisplayScale, imageLocalToCanvas } from './geometry';

/**
 * 圆形放大引用的几何解析。
 *
 * 唯一真相是「圈选区（ROI）」：ROI 圆心与半径以源图像素保存在 sourceRegion 里。
 * 投射圆是**派生量**，满足两条不变式（由构造保证，永远不会不一致）：
 *
 *   1. 投射圆直径 = ROI 在画布上的直径 × zoom        （投射图就是圈选图的 zoom 倍）
 *   2. 投射圆里可见的源图范围 = ROI 本身              （所见即所圈）
 *
 * 因此 destination.radius 只是派生缓存，渲染一律走 resolveMagnifier()。
 */

export const MIN_SOURCE_RADIUS = 4;
export const DEFAULT_ROI_COLOR = '#2E6C68';

export interface ResolvedMagnifier {
  /** ROI 中心（源图像素） */
  centerSource: Point;
  /** ROI 半径（源图像素） */
  sourceRadius: number;
  /** 归一化后的 ROI 正方形包围盒（源图像素） */
  region: Rect;
  /** 投射圆半径（画布/世界单位） = sourceRadius × 显示比例 × zoom */
  radius: number;
  /** 投射圆内部的内容缩放（世界单位 / 源像素） = 显示比例 × zoom */
  mScale: number;
  /** ROI 中心对应的画布坐标（含图片旋转），用于画连接线 */
  centerCanvas: Point;
  /** 投射圆的旋转角，跟随源图 */
  rotation: number;
}

export function magnifierRegion(m: MagnifierObject): Rect {
  const r = Math.max(
    1,
    Math.min(Math.abs(m.sourceRegion.width), Math.abs(m.sourceRegion.height)) / 2,
  );
  const cx = m.sourceRegion.x + m.sourceRegion.width / 2;
  const cy = m.sourceRegion.y + m.sourceRegion.height / 2;
  return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
}

export function magnifierRegionCenter(m: MagnifierObject): Point {
  const region = magnifierRegion(m);
  return { x: region.x + region.width / 2, y: region.y + region.height / 2 };
}

export function resolveMagnifier(
  m: MagnifierObject,
  source: ImageObject | null | undefined,
): ResolvedMagnifier | null {
  if (!source) return null;
  const region = magnifierRegion(m);
  const sourceRadius = Math.max(MIN_SOURCE_RADIUS, region.width / 2);
  const scale = imageDisplayScale(source);
  const zoom = Number.isFinite(m.zoom) && m.zoom > 0 ? m.zoom : 1;
  const mScale = scale * zoom;
  const centerSource = { x: region.x + sourceRadius, y: region.y + sourceRadius };
  return {
    centerSource,
    sourceRadius,
    region,
    radius: Math.max(1, sourceRadius * mScale),
    mScale,
    centerCanvas: imageLocalToCanvas(source, centerSource),
    rotation: source.rotation,
  };
}

/** 由投射圆半径反推 ROI 半径（源图像素），用于拖动手柄改取景范围 */
export function sourceRadiusFromProjection(
  m: MagnifierObject,
  source: ImageObject,
  radiusCanvas: number,
): number {
  const scale = imageDisplayScale(source);
  const zoom = Number.isFinite(m.zoom) && m.zoom > 0 ? m.zoom : 1;
  return Math.max(MIN_SOURCE_RADIUS, radiusCanvas / (scale * zoom));
}

/** ROI 半径允许的最大值：不让圈选区越过当前裁切范围内的有效像素 */
export function maxSourceRadiusAt(center: Point, source: ImageObject): number {
  const crop = source.crop;
  const limit = Math.min(
    center.x - crop.x,
    crop.x + crop.width - center.x,
    center.y - crop.y,
    crop.y + crop.height - center.y,
  );
  return Math.max(MIN_SOURCE_RADIUS, limit);
}

/** 以圆心为中心，按给定半径写回正方形 sourceRegion */
export function setRegionRadius(m: MagnifierObject, radius: number): void {
  const c = magnifierRegionCenter(m);
  const r = Math.max(MIN_SOURCE_RADIUS, radius);
  m.sourceRegion = { x: c.x - r, y: c.y - r, width: r * 2, height: r * 2 };
}

/**
 * 把派生半径写回文档缓存。只在超出阈值时赋值，
 * 避免 immer 产生无意义的新状态（拖拽期间不会触发额外重渲染）。
 */
export function normalizeMagnifierRadii(doc: {
  images: ImageObject[];
  magnifiers: MagnifierObject[];
}): void {
  const byId = new Map(doc.images.map((i) => [i.id, i]));
  for (const m of doc.magnifiers) {
    const src = byId.get(m.sourceImageId);
    if (!src) continue;
    const r = resolveMagnifier(m, src);
    if (!r) continue;
    if (Math.abs(m.destination.radius - r.radius) > 1e-3) {
      m.destination.radius = r.radius;
    }
    if (!m.roiColor) m.roiColor = DEFAULT_ROI_COLOR;
  }
}
