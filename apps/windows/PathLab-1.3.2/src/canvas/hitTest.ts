import type {
  AnnotationObject,
  ImageObject,
  Point,
  SceneDoc,
  SelectionRef,
} from '../lib/types';
import {
  canvasToImageLocal,
  distToSegment,
  imageDisplayScale,
  pointInImage,
  pointInPolygon,
  pointInRect,
  annotationCanvasRect,
} from '../lib/geometry';
import { resolveMagnifier } from '../lib/magnifier';

/** 命中容差（画布像素） */
const TOL = 7;

export function findImage(project: SceneDoc, id: string | null): ImageObject | null {
  if (!id) return null;
  return project.images.find((i) => i.id === id) ?? null;
}

function hitAnnotation(ann: AnnotationObject, parent: ImageObject | null, world: Point): boolean {
  if (!ann.visible) return false;
  if (parent && !parent.visible) return false;
  const s = parent ? imageDisplayScale(parent) : 1;
  const p = parent ? canvasToImageLocal(parent, world) : world;
  const tol = TOL / s;

  if (ann.type === 'text') {
    return pointInRect(world, annotationCanvasRect(ann, parent), TOL);
  }

  if (ann.type === 'rect' && ann.geometry.rect) {
    const r = ann.geometry.rect;
    return pointInRect(p, {
      x: r.x - tol,
      y: r.y - tol,
      width: r.width + tol * 2,
      height: r.height + tol * 2,
    });
  }

  if (ann.type === 'ellipse' && ann.geometry.rect) {
    const r = ann.geometry.rect;
    const rx = r.width / 2 + tol;
    const ry = r.height / 2 + tol;
    if (rx <= 0 || ry <= 0) return false;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    return ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1;
  }

  if ((ann.type === 'line' || ann.type === 'arrow') && ann.geometry.points?.length === 2) {
    const [a, b] = ann.geometry.points;
    return distToSegment(p, a, b) <= tol + ann.strokeWidth / 2;
  }

  if (ann.type === 'polygon' && ann.geometry.points?.length) {
    const pts = ann.geometry.points;
    if (pointInPolygon(p, pts)) return true;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (distToSegment(p, a, b) <= tol) return true;
    }
    return false;
  }

  if (ann.type === 'freehand' && ann.geometry.points?.length) {
    const pts = ann.geometry.points;
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tol * 3;
    for (let i = 0; i < pts.length - 1; i += 1) {
      if (distToSegment(p, pts[i], pts[i + 1]) <= tol + ann.strokeWidth / 2) return true;
    }
    return false;
  }

  if (ann.geometry.rect) {
    return pointInRect(p, ann.geometry.rect, tol);
  }
  return false;
}

/** 返回最上层命中的对象；顺序与绘制层一致：标注 -> 放大引用 -> 图片 */
export function hitTest(
  project: SceneDoc,
  world: Point,
  opts: { includeLocked?: boolean; only?: 'image' | 'annotation' | 'magnifier' } = {},
): SelectionRef | null {
  const { includeLocked = false, only } = opts;

  const images = [...project.images]
    .filter((i) => i.visible)
    .sort((a, b) => b.zIndex - a.zIndex);

  if (!only || only === 'annotation') {
    // Loose annotations are painted after hosted annotations, so they are visually topmost.
    const looseAnns = project.annotations
      .filter((a) => !a.parentImageId)
      .sort((a, b) => b.zIndex - a.zIndex);
    for (const ann of looseAnns) {
      if (hitAnnotation(ann, null, world)) return { id: ann.id, kind: 'annotation' };
    }

    for (const img of images) {
      if (!img.annotationsVisible) continue;
      const anns = project.annotations
        .filter((a) => a.parentImageId === img.id)
        .sort((a, b) => b.zIndex - a.zIndex);
      for (const ann of anns) {
        if (hitAnnotation(ann, img, world)) return { id: ann.id, kind: 'annotation' };
      }
    }
  }

  if (!only || only === 'magnifier') {
    const mags = [...project.magnifiers]
      .filter((m) => m.visible)
      .sort((a, b) => b.zIndex - a.zIndex);
    for (const m of mags) {
      const src = project.images.find((i) => i.id === m.sourceImageId) ?? null;
      const r = resolveMagnifier(m, src);
      const radius = r ? r.radius : m.destination.radius;
      if (Math.hypot(world.x - m.destination.x, world.y - m.destination.y) <= radius + 2) {
        return { id: m.id, kind: 'magnifier' };
      }
    }
  }

  if (!only || only === 'image') {
    for (const img of images) {
      if (img.locked && !includeLocked) continue;
      if (pointInImage(img, world)) return { id: img.id, kind: 'image' };
    }
  }

  return null;
}

/** 找出某个画布坐标下最上层的图片（用于绘制标注时确定宿主） */
export function imageUnderPoint(project: SceneDoc, world: Point): ImageObject | null {
  const images = [...project.images].filter((i) => i.visible).sort((a, b) => b.zIndex - a.zIndex);
  for (const img of images) {
    if (pointInImage(img, world)) return img;
  }
  return null;
}
