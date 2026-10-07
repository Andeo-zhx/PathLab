import type { AnnotationObject, ImageObject, Point, Rect } from './types';
import { DEFAULT_TEXT_FONT_FAMILY, fitTextBlock } from './textPreferences';

export const DEG = Math.PI / 180;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function normRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function rectUnion(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const r = Math.max(a.x + a.width, b.x + b.width);
  const bt = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: r - x, height: bt - y };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

export function expandRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 };
}

export function pointInRect(p: Point, r: Rect, pad = 0): boolean {
  return (
    p.x >= r.x - pad && p.x <= r.x + r.width + pad && p.y >= r.y - pad && p.y <= r.y + r.height + pad
  );
}

export function rotatePoint(p: Point, origin: Point, deg: number): Point {
  const r = deg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + c * dx - s * dy, y: origin.y + s * dx + c * dy };
}

/** 图片显示区域在画布上的四个角（含旋转），顺序：tl, tr, br, bl */
export function imageCorners(img: ImageObject): Point[] {
  const o = { x: img.x, y: img.y };
  const pts: Point[] = [
    { x: img.x, y: img.y },
    { x: img.x + img.width, y: img.y },
    { x: img.x + img.width, y: img.y + img.height },
    { x: img.x, y: img.y + img.height },
  ];
  if (!img.rotation) return pts;
  return pts.map((p) => rotatePoint(p, o, img.rotation));
}

export function imageAABB(img: ImageObject): Rect {
  const pts = imageCorners(img);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export function pointInImage(img: ImageObject, p: Point): boolean {
  if (!img.rotation) {
    return pointInRect(p, { x: img.x, y: img.y, width: img.width, height: img.height });
  }
  const local = rotatePoint(p, { x: img.x, y: img.y }, -img.rotation);
  return pointInRect(local, { x: img.x, y: img.y, width: img.width, height: img.height });
}

/** 源图像素 -> 画布坐标 */
export function imageLocalToCanvas(img: ImageObject, p: Point): Point {
  const s = img.width / img.crop.width;
  const local = { x: img.x + (p.x - img.crop.x) * s, y: img.y + (p.y - img.crop.y) * s };
  if (!img.rotation) return local;
  return rotatePoint(local, { x: img.x, y: img.y }, img.rotation);
}

/** 画布坐标 -> 源图像素 */
export function canvasToImageLocal(img: ImageObject, p: Point): Point {
  const local = img.rotation
    ? rotatePoint(p, { x: img.x, y: img.y }, -img.rotation)
    : { x: p.x, y: p.y };
  const s = img.crop.width / img.width;
  return { x: (local.x - img.x) * s + img.crop.x, y: (local.y - img.y) * s + img.crop.y };
}

/** 画布像素 / 源像素 */
export function imageDisplayScale(img: ImageObject): number {
  return img.width / img.crop.width;
}

/** 标注包围盒（画布坐标） */
export function annotationCanvasRect(ann: AnnotationObject, parent: ImageObject | null): Rect {
  const conv = (p: Point) => (parent ? imageLocalToCanvas(parent, p) : p);
  if (ann.type === 'text') {
    const pos = ann.geometry.position ?? { x: 0, y: 0 };
    const fs = ann.textStyle?.fontSize ?? 18;
    const layout = fitTextBlock(
      ann.text ?? '',
      fs,
      ann.textStyle?.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
      ann.textStyle?.fontWeight ?? 400,
      ann.textStyle?.fontStyle ?? 'normal',
    );
    const origin = conv(pos);
    const w = Math.max(layout.width, fs);
    const h = Math.max(layout.lineCount * fs * 1.35, fs);
    return { x: origin.x - fs * 0.25, y: origin.y - fs * 0.25, width: w + fs * 0.5, height: h + fs * 0.5 };
  }
  const pts: Point[] = [];
  if (ann.geometry.rect) {
    const r = ann.geometry.rect;
    pts.push(conv({ x: r.x, y: r.y }), conv({ x: r.x + r.width, y: r.y + r.height }));
  }
  if (ann.geometry.points) ann.geometry.points.forEach((p) => pts.push(conv(p)));
  if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

const CJK_RE = /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF\uAC00-\uD7AF]/;

/** 粗略估算一段文字的像素宽度（CJK 按 1em、空格 0.3em、其余 0.55em） */
export function estimateTextWidth(lines: string[], fontSize: number): number {
  let max = 0;
  for (const line of lines) {
    let w = 0;
    for (const ch of line) {
      if (CJK_RE.test(ch)) w += 1;
      else if (ch === ' ') w += 0.3;
      else w += 0.55;
    }
    max = Math.max(max, w);
  }
  return max * fontSize;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 点到线段的距离 */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 对自由轮廓做适度平滑（Chaikin 细分一次 + 距离重采样），保持原始形状 */
export function smoothPolyline(points: Point[], iterations = 1): Point[] {
  if (points.length < 3) return points;
  let pts = points;
  for (let k = 0; k < iterations; k += 1) {
    const out: Point[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** 简化点列（Ramer–Douglas–Peucker），减少对象数量 */
export function simplifyPolyline(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const first = 0;
  const last = points.length - 1;
  let maxDist = 0;
  let index = -1;
  for (let i = first + 1; i < last; i += 1) {
    const d = distToSegment(points[i], points[first], points[last]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > tolerance && index !== -1) {
    const left = simplifyPolyline(points.slice(first, index + 1), tolerance);
    const right = simplifyPolyline(points.slice(index, last + 1), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [points[first], points[last]];
}

export function roundRectPath(
  ctx: CanvasRenderingContext2D | { beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; quadraticCurveTo(a: number, b: number, c: number, d: number): void; closePath(): void },
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
