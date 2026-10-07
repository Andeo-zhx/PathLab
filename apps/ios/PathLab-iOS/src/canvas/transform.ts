import type { ImageObject, Point, Rect } from '../lib/types';
import { imageDisplayScale, rotatePoint } from '../lib/geometry';

/** 画布坐标 -> 图片自身坐标系（原点为显示框左上角，未旋转） */
export function worldToImageFrame(img: ImageObject, p: Point): Point {
  const r = rotatePoint(p, { x: img.x, y: img.y }, -img.rotation);
  return { x: r.x - img.x, y: r.y - img.y };
}

/** 图片自身坐标系 -> 画布坐标 */
export function imageFrameToWorld(img: ImageObject, l: Point): Point {
  return rotatePoint({ x: img.x + l.x, y: img.y + l.y }, { x: img.x, y: img.y }, img.rotation);
}

function rotateVec(v: Point, deg: number): Point {
  return rotatePoint(v, { x: 0, y: 0 }, deg);
}

export const MIN_IMAGE_SIZE = 24;

export interface ResizeResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 拖动图片四角控制点。在图片自身坐标系中计算，锚点为对角。
 * handle: 'nw' | 'ne' | 'se' | 'sw'
 */
export function resizeImageBox(
  img: ImageObject,
  handle: 'nw' | 'ne' | 'se' | 'sw',
  worldPoint: Point,
  keepRatio: boolean,
): ResizeResult {
  const w0 = img.width;
  const h0 = img.height;
  const p = worldToImageFrame(img, worldPoint);

  const sx = handle === 'ne' || handle === 'se' ? 1 : -1;
  const sy = handle === 'sw' || handle === 'se' ? 1 : -1;

  // 锚点（对角）在自身坐标系中的位置
  const anchor: Point =
    handle === 'se'
      ? { x: 0, y: 0 }
      : handle === 'nw'
        ? { x: w0, y: h0 }
        : handle === 'ne'
          ? { x: 0, y: h0 }
          : { x: w0, y: 0 };

  let nw = Math.max(MIN_IMAGE_SIZE, sx * (p.x - anchor.x));
  let nh = Math.max(MIN_IMAGE_SIZE, sy * (p.y - anchor.y));

  if (keepRatio) {
    const k = Math.max(nw / w0, nh / h0);
    nw = w0 * k;
    nh = h0 * k;
  }

  // 锚点在世界坐标中的位置（保持不动）
  const worldAnchor = rotatePoint(
    { x: img.x + anchor.x, y: img.y + anchor.y },
    { x: img.x, y: img.y },
    img.rotation,
  );
  // 新盒子中锚点所在的角
  const newAnchorLocal: Point =
    handle === 'se'
      ? { x: 0, y: 0 }
      : handle === 'nw'
        ? { x: nw, y: nh }
        : handle === 'ne'
          ? { x: 0, y: nh }
          : { x: nw, y: 0 };
  const rv = rotateVec(newAnchorLocal, img.rotation);

  return {
    x: worldAnchor.x - rv.x,
    y: worldAnchor.y - rv.y,
    width: nw,
    height: nh,
  };
}

/**
 * 裁切模式下使用的虚拟图片对象：显示完整图，并保证被裁切的像素在屏幕上位置不变。
 * 这样裁切框的控制点可以用同一套坐标换算函数。
 */
export function cropViewOf(img: ImageObject, draft: Rect): ImageObject {
  const s = imageDisplayScale(img);
  return {
    ...img,
    x: img.x - draft.x * s,
    y: img.y - draft.y * s,
    width: img.originalWidth * s,
    height: img.originalHeight * s,
    crop: { x: 0, y: 0, width: img.originalWidth, height: img.originalHeight },
  };
}

/** 按内容包围盒缩放一组点 */
export function scalePoints(points: Point[], from: Rect, to: Rect): Point[] {
  const kx = from.width === 0 ? 1 : to.width / from.width;
  const ky = from.height === 0 ? 1 : to.height / from.height;
  return points.map((p) => ({
    x: to.x + (p.x - from.x) * kx,
    y: to.y + (p.y - from.y) * ky,
  }));
}
