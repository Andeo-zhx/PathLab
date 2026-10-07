import type {
  AnnotationObject,
  ImageObject,
  MagnifierObject,
  Point,
  Rect,
  SceneDoc,
  SelectionRef,
} from '../lib/types';
import {
  annotationCanvasRect,
  canvasToImageLocal,
  imageCorners,
  imageLocalToCanvas,
  rectUnion,
} from '../lib/geometry';
import { resolveMagnifier } from '../lib/magnifier';

export type HandleKind =
  | 'image-corner'
  | 'ann-corner'
  | 'ann-edge'
  | 'vertex'
  | 'freehand-corner'
  | 'magnifier-radius'
  | 'magnifier-roi-radius';

export interface HandleDef {
  /** 唯一 id，用于手势分派 */
  hid: string;
  kind: HandleKind;
  targetId: string;
  corner?: 'nw' | 'ne' | 'se' | 'sw';
  edge?: 'n' | 'e' | 's' | 'w';
  index?: number;
  world: Point;
  cursor: string;
}

export function cursorForDirection(dx: number, dy: number): string {
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const a = (angle + 360) % 360;
  if (a < 22.5 || a >= 337.5) return 'ew-resize';
  if (a < 67.5) return 'nwse-resize';
  if (a < 112.5) return 'ns-resize';
  if (a < 157.5) return 'nesw-resize';
  if (a < 202.5) return 'ew-resize';
  if (a < 247.5) return 'nwse-resize';
  if (a < 292.5) return 'ns-resize';
  return 'nesw-resize';
}

export function getSelectionBounds(project: SceneDoc, selection: SelectionRef[]): Rect | null {
  let acc: Rect | null = null;
  for (const ref of selection) {
    if (ref.kind === 'image') {
      const img = project.images.find((i) => i.id === ref.id);
      if (!img) continue;
      const pts = imageCorners(img);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      acc = rectUnion(acc, {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      });
    } else if (ref.kind === 'annotation') {
      const ann = project.annotations.find((a) => a.id === ref.id);
      if (!ann) continue;
      const parent = project.images.find((i) => i.id === ann.parentImageId) ?? null;
      const r = annotationCanvasRect(ann, parent);
      const pad = ann.type === 'text' ? 0 : ann.strokeWidth / 2 + 2;
      acc = rectUnion(acc, {
        x: r.x - pad,
        y: r.y - pad,
        width: r.width + pad * 2,
        height: r.height + pad * 2,
      });
    } else {
      const m = project.magnifiers.find((x) => x.id === ref.id);
      if (!m) continue;
      const src = project.images.find((i) => i.id === m.sourceImageId) ?? null;
      const r = resolveMagnifier(m, src);
      const radius = r ? r.radius : m.destination.radius;
      acc = rectUnion(acc, {
        x: m.destination.x - radius,
        y: m.destination.y - radius,
        width: radius * 2,
        height: radius * 2,
      });
    }
  }
  return acc;
}

function imageHandles(img: ImageObject): HandleDef[] {
  if (img.locked) return [];
  const cx = img.x + img.width / 2;
  const cy = img.y + img.height / 2;
  const corners = imageCorners(img);
  // corners 顺序 tl, tr, br, bl
  const map: { corner: 'nw' | 'ne' | 'se' | 'sw'; p: Point }[] = [
    { corner: 'nw', p: corners[0] },
    { corner: 'ne', p: corners[1] },
    { corner: 'se', p: corners[2] },
    { corner: 'sw', p: corners[3] },
  ];
  return map.map(({ corner, p }) => ({
    hid: `img:${img.id}:${corner}`,
    kind: 'image-corner' as const,
    targetId: img.id,
    corner,
    world: p,
    cursor: cursorForDirection(p.x - cx, p.y - cy),
  }));
}

function annotationHandles(ann: AnnotationObject, parent: ImageObject | null): HandleDef[] {
  if (ann.locked) return [];
  const toWorld = (p: Point) => (parent ? imageLocalToCanvas(parent, p) : p);
  const out: HandleDef[] = [];

  if (ann.type === 'text') return out;

  if (ann.type === 'line' || ann.type === 'arrow') {
    (ann.geometry.points ?? []).forEach((p, i) => {
      out.push({
        hid: `v:${ann.id}:${i}`,
        kind: 'vertex',
        targetId: ann.id,
        index: i,
        world: toWorld(p),
        cursor: 'crosshair',
      });
    });
    return out;
  }

  if (ann.type === 'polygon') {
    (ann.geometry.points ?? []).forEach((p, i) => {
      out.push({
        hid: `v:${ann.id}:${i}`,
        kind: 'vertex',
        targetId: ann.id,
        index: i,
        world: toWorld(p),
        cursor: 'crosshair',
      });
    });
    return out;
  }

  const r = ann.geometry.rect;
  if (!r) return out;

  if (ann.type === 'freehand') {
    const corners: { corner: 'nw' | 'ne' | 'se' | 'sw'; p: Point }[] = [
      { corner: 'nw', p: { x: r.x, y: r.y } },
      { corner: 'ne', p: { x: r.x + r.width, y: r.y } },
      { corner: 'se', p: { x: r.x + r.width, y: r.y + r.height } },
      { corner: 'sw', p: { x: r.x, y: r.y + r.height } },
    ];
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    corners.forEach(({ corner, p }) => {
      const w = toWorld(p);
      const wc = toWorld({ x: cx, y: cy });
      out.push({
        hid: `fc:${ann.id}:${corner}`,
        kind: 'freehand-corner',
        targetId: ann.id,
        corner,
        world: w,
        cursor: cursorForDirection(w.x - wc.x, w.y - wc.y),
      });
    });
    return out;
  }

  // 矩形 / 椭圆：四角 + 四边中点
  const corners: { corner: 'nw' | 'ne' | 'se' | 'sw'; p: Point }[] = [
    { corner: 'nw', p: { x: r.x, y: r.y } },
    { corner: 'ne', p: { x: r.x + r.width, y: r.y } },
    { corner: 'se', p: { x: r.x + r.width, y: r.y + r.height } },
    { corner: 'sw', p: { x: r.x, y: r.y + r.height } },
  ];
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  corners.forEach(({ corner, p }) => {
    const w = toWorld(p);
    const wc = toWorld({ x: cx, y: cy });
    out.push({
      hid: `c:${ann.id}:${corner}`,
      kind: 'ann-corner',
      targetId: ann.id,
      corner,
      world: w,
      cursor: cursorForDirection(w.x - wc.x, w.y - wc.y),
    });
  });
  const edges: { edge: 'n' | 'e' | 's' | 'w'; p: Point }[] = [
    { edge: 'n', p: { x: cx, y: r.y } },
    { edge: 'e', p: { x: r.x + r.width, y: cy } },
    { edge: 's', p: { x: cx, y: r.y + r.height } },
    { edge: 'w', p: { x: r.x, y: cy } },
  ];
  edges.forEach(({ edge, p }) => {
    const w = toWorld(p);
    const wc = toWorld({ x: cx, y: cy });
    out.push({
      hid: `e:${ann.id}:${edge}`,
      kind: 'ann-edge',
      targetId: ann.id,
      edge,
      world: w,
      cursor: cursorForDirection(w.x - wc.x, w.y - wc.y),
    });
  });
  return out;
}

function magnifierHandles(m: MagnifierObject, source: ImageObject | null): HandleDef[] {
  if (m.locked) return [];
  const r = resolveMagnifier(m, source);
  const out: HandleDef[] = [
    {
      // 拖它 = 改取景范围：投射圆与圈选区一起缩放，倍率不变
      hid: `mr:${m.id}`,
      kind: 'magnifier-radius',
      targetId: m.id,
      world: { x: m.destination.x + (r ? r.radius : m.destination.radius), y: m.destination.y },
      cursor: 'ew-resize',
    },
  ];
  if (r) {
    out.push({
      // 直接在原图上拖圈选区
      hid: `mroi:${m.id}`,
      kind: 'magnifier-roi-radius',
      targetId: m.id,
      world: {
        x: r.centerCanvas.x + r.radius / Math.max(0.01, m.zoom),
        y: r.centerCanvas.y,
      },
      cursor: 'ew-resize',
    });
  }
  return out;
}

/** 单对象选择时返回缩放/编辑控制点；多选返回空（多选仅支持移动与排列） */
export function getHandles(
  project: SceneDoc,
  selection: SelectionRef[],
  opts: { force?: boolean } = {},
): HandleDef[] {
  if (selection.length !== 1) return [];
  const ref = selection[0];
  if (ref.kind === 'image') {
    const img = project.images.find((i) => i.id === ref.id);
    if (!img) return [];
    if (!opts.force && img.locked) return [];
    return imageHandles(img);
  }
  if (ref.kind === 'annotation') {
    const ann = project.annotations.find((a) => a.id === ref.id);
    if (!ann) return [];
    const parent = project.images.find((i) => i.id === ann.parentImageId) ?? null;
    return annotationHandles(ann, parent);
  }
  const m = project.magnifiers.find((x) => x.id === ref.id);
  if (!m) return [];
  const src = project.images.find((i) => i.id === m.sourceImageId) ?? null;
  return magnifierHandles(m, src);
}

/** 把画布坐标转换到标注自身坐标系 */
export function toAnnotationLocal(
  world: Point,
  parent: ImageObject | null,
): Point {
  return parent ? canvasToImageLocal(parent, world) : world;
}
