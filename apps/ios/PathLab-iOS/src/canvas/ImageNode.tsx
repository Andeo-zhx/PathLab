import { memo } from 'react';
import { Ellipse, Group, Image as KImage, Rect } from 'react-konva';
import type { AnnotationObject, ImageObject, MagnifierObject, Rect as RectT } from '../lib/types';
import { cropForBitmap, getResource } from '../lib/resources';
import { imageDisplayScale } from '../lib/geometry';
import { DEFAULT_ROI_COLOR, magnifierRegion } from '../lib/magnifier';
import { withAlpha } from '../lib/colors';
import { cropViewOf } from './transform';
import { AnnotationShape } from './AnnotationShape';

const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

export interface ImageNodeProps {
  img: ImageObject;
  annotations: AnnotationObject[];
  /** 引用该图的放大镜（用于绘制 ROI 圈） */
  rois: MagnifierObject[];
  /** 导出时使用原始像素位图 */
  hiRes?: boolean;
  editingTextId?: string | null;
  /** 裁切模式下的草稿（原始像素坐标） */
  cropDraft?: RectT | null;
  /** 全局隐藏标注 */
  hideAnnotations?: boolean;
  showRois?: boolean;
  /** 当前画布缩放：用于让圈选区虚线框在任何缩放下都保持可读的屏幕粗细 */
  canvasZoom?: number;
  /** 需要强调显示的圈选区（当前选中的放大引用） */
  emphasizedRoiIds?: ReadonlySet<string>;
}

/**
 * 圈选区（ROI）标记：三层绘制，保证在浅色与深色组织上都清晰可辨。
 * 线宽/虚线按屏幕像素换算，因此缩放画布时视觉粗细恒定。
 */
function RoiRing({
  magnifier,
  screenUnit,
  emphasized,
}: {
  magnifier: MagnifierObject;
  screenUnit: number;
  emphasized: boolean;
}) {
  const region = magnifierRegion(magnifier);
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  const rx = Math.max(1, region.width / 2);
  const ry = Math.max(1, region.height / 2);
  const color = magnifier.roiColor || DEFAULT_ROI_COLOR;
  const u = screenUnit;
  return (
    <Group listening={false}>
      <Ellipse x={cx} y={cy} radiusX={rx} radiusY={ry} fill={withAlpha(color, 0.07)} listening={false} />
      <Ellipse
        x={cx}
        y={cy}
        radiusX={rx}
        radiusY={ry}
        stroke="rgba(255,255,255,0.92)"
        strokeWidth={5.4 * u}
        listening={false}
      />
      <Ellipse
        x={cx}
        y={cy}
        radiusX={rx}
        radiusY={ry}
        stroke={color}
        strokeWidth={2.1 * u}
        dash={[9 * u, 6 * u]}
        listening={false}
      />
      {emphasized && (
        <Ellipse
          x={cx}
          y={cy}
          radiusX={rx + 4 * u}
          radiusY={ry + 4 * u}
          stroke={color}
          strokeWidth={1.2 * u}
          listening={false}
        />
      )}
    </Group>
  );
}

function ImageNodeInner({
  img,
  annotations,
  rois,
  hiRes = false,
  editingTextId = null,
  cropDraft = null,
  hideAnnotations = false,
  showRois = true,
  canvasZoom = 1,
  emphasizedRoiIds = EMPTY_ID_SET,
}: ImageNodeProps) {
  const res = getResource(img.resourceId);
  if (!res || !img.visible) return null;

  const bitmap = hiRes ? res.hiRes : res.display;
  const bitmapCrop = cropForBitmap(res, img.crop, hiRes);
  const scale = imageDisplayScale(img);
  const unit = 1 / scale;

  if (cropDraft) {
    const view = cropViewOf(img, cropDraft);
    const vs = imageDisplayScale(view);
    const full = { x: 0, y: 0, width: view.width, height: view.height };
    const hole = {
      x: cropDraft.x * vs,
      y: cropDraft.y * vs,
      width: cropDraft.width * vs,
      height: cropDraft.height * vs,
    };
    const dim = 'rgba(11, 15, 25, 0.5)';
    return (
      <Group x={view.x} y={view.y} rotation={view.rotation} listening={false}>
        <KImage
          image={bitmap}
          x={0}
          y={0}
          width={view.width}
          height={view.height}
          listening={false}
        />
        <Rect x={full.x} y={full.y} width={full.width} height={Math.max(0, hole.y)} fill={dim} listening={false} />
        <Rect
          x={full.x}
          y={hole.y + hole.height}
          width={full.width}
          height={Math.max(0, full.height - hole.y - hole.height)}
          fill={dim}
          listening={false}
        />
        <Rect x={full.x} y={hole.y} width={Math.max(0, hole.x)} height={hole.height} fill={dim} listening={false} />
        <Rect
          x={hole.x + hole.width}
          y={hole.y}
          width={Math.max(0, full.width - hole.x - hole.width)}
          height={hole.height}
          fill={dim}
          listening={false}
        />
      </Group>
    );
  }

  return (
    <Group x={img.x} y={img.y} rotation={img.rotation} opacity={img.opacity} listening={false}>
      <Rect
        x={0}
        y={0}
        width={img.width}
        height={img.height}
        cornerRadius={img.cornerRadius}
        fill="#FFFFFF"
        shadowColor="#0F172A"
        shadowOpacity={0.18}
        shadowBlur={16}
        shadowOffsetY={5}
        listening={false}
      />
      <KImage
        image={bitmap}
        x={0}
        y={0}
        width={img.width}
        height={img.height}
        crop={{
          x: bitmapCrop.x,
          y: bitmapCrop.y,
          width: bitmapCrop.width,
          height: bitmapCrop.height,
        }}
        cornerRadius={img.cornerRadius}
        listening={false}
      />
      <Group x={-img.crop.x * scale} y={-img.crop.y * scale} scaleX={scale} scaleY={scale} listening={false}>
        {showRois &&
          rois.map((m) => (
            <RoiRing
              key={m.id}
              magnifier={m}
              screenUnit={unit / Math.max(0.02, canvasZoom)}
              emphasized={emphasizedRoiIds.has(m.id)}
            />
          ))}
        {!hideAnnotations &&
          img.annotationsVisible &&
          annotations.map((ann) => (
            <AnnotationShape
              key={ann.id}
              ann={ann}
              unit={unit}
              hideText={editingTextId === ann.id}
            />
          ))}
      </Group>
    </Group>
  );
}

export const ImageNode = memo(
  ImageNodeInner,
  (a, b) =>
    a.img === b.img &&
    a.hiRes === b.hiRes &&
    a.editingTextId === b.editingTextId &&
    a.cropDraft === b.cropDraft &&
    a.hideAnnotations === b.hideAnnotations &&
    a.showRois === b.showRois &&
    a.canvasZoom === b.canvasZoom &&
    a.emphasizedRoiIds === b.emphasizedRoiIds &&
    sameList(a.annotations, b.annotations) &&
    sameList(a.rois, b.rois),
);

function sameList<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
  return true;
}
