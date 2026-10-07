import { memo, useLayoutEffect, useRef, useState } from 'react';
import { Arrow, Ellipse, Group, Line, Rect, Text as KText } from 'react-konva';
import type Konva from 'konva';
import type { AnnotationObject } from '../lib/types';
import { DEFAULT_TEXT_COLOR } from '../lib/factory';
import { DEFAULT_TEXT_FONT_FAMILY, fitTextBlock } from '../lib/textPreferences';

export interface AnnotationShapeProps {
  ann: AnnotationObject;
  /** 世界像素 -> 宿主局部单位的换算因子（1 / imageDisplayScale） */
  unit: number;
  /** 正在用 HTML textarea 编辑时隐藏矢量文字 */
  hideText?: boolean;
}

function dashOf(dash: number[], unit: number): number[] | undefined {
  if (!dash.length) return undefined;
  return dash.map((d) => d * unit);
}

function flatted(points: { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p.x, p.y);
  return out;
}

function konvaFontStyle(italic: boolean, weight: number): string {
  return (italic ? 'italic ' : '') + String(weight);
}

function TextAnnotation({ ann, unit, hidden }: { ann: AnnotationObject; unit: number; hidden: boolean }) {
  const ref = useRef<Konva.Text>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const style = ann.textStyle;
  const fontSize = (style?.fontSize ?? 20) * unit;
  const fontFamily = style?.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY;
  const text = ann.text ?? '';
  const layout = fitTextBlock(text, fontSize, fontFamily, style?.fontWeight ?? 400, style?.fontStyle ?? 'normal');

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const w = node.width();
    const h = node.height();
    setBox((prev) => (Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5 ? prev : { w, h }));
  }, [text, style?.fontSize, style?.fontFamily, style?.fontWeight, style?.fontStyle, unit, layout.width]);

  if (hidden) return null;

  const pos = ann.geometry.position ?? { x: 0, y: 0 };
  const pad = fontSize * 0.34;
  const hasBg = Boolean(style?.background);

  return (
    <Group x={pos.x} y={pos.y} listening={false}>
      {hasBg && box.w > 0 && (
        <Rect
          x={-pad}
          y={-pad * 0.7}
          width={box.w + pad * 2}
          height={box.h + pad * 1.4}
          cornerRadius={fontSize * 0.3}
          fill={style?.background ?? undefined}
          listening={false}
        />
      )}
      <KText
        ref={ref}
        text={text}
        x={0}
        y={0}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fontStyle={konvaFontStyle(style?.fontStyle === 'italic', style?.fontWeight ?? 400)}
        width={layout.width}
        fill={style?.color ?? DEFAULT_TEXT_COLOR}
        lineHeight={1.35}
        align={style?.align ?? 'left'}
        wrap="word"
        stroke={style?.outline ?? undefined}
        strokeWidth={style?.outline ? fontSize * 0.16 : 0}
        fillAfterStrokeEnabled={Boolean(style?.outline)}
        listening={false}
      />
    </Group>
  );
}

function AnnotationShapeInner({ ann, unit, hideText }: AnnotationShapeProps) {
  if (!ann.visible) return null;
  const dash = dashOf(ann.dash, unit);
  const strokeWidth = Math.max(0.15, ann.strokeWidth * unit);

  switch (ann.type) {
    case 'rect': {
      const r = ann.geometry.rect;
      if (!r) return null;
      return (
        <Rect
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          stroke={ann.stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          fill={ann.fill ?? undefined}
          lineJoin="round"
          listening={false}
        />
      );
    }
    case 'ellipse': {
      const r = ann.geometry.rect;
      if (!r) return null;
      return (
        <Ellipse
          x={r.x + r.width / 2}
          y={r.y + r.height / 2}
          radiusX={Math.abs(r.width / 2)}
          radiusY={Math.abs(r.height / 2)}
          stroke={ann.stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          fill={ann.fill ?? undefined}
          listening={false}
        />
      );
    }
    case 'polygon': {
      const pts = ann.geometry.points ?? [];
      if (pts.length < 2) return null;
      return (
        <Line
          points={flatted(pts)}
          closed
          stroke={ann.stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          fill={ann.fill ?? undefined}
          lineJoin="round"
          listening={false}
        />
      );
    }
    case 'freehand': {
      const pts = ann.geometry.points ?? [];
      if (pts.length < 2) return null;
      return (
        <Line
          points={flatted(pts)}
          stroke={ann.stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          lineCap="round"
          lineJoin="round"
          tension={0.3}
          listening={false}
        />
      );
    }
    case 'line': {
      const pts = ann.geometry.points ?? [];
      if (pts.length < 2) return null;
      return (
        <Line
          points={flatted(pts)}
          stroke={ann.stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          lineCap="round"
          listening={false}
        />
      );
    }
    case 'arrow': {
      const pts = ann.geometry.points ?? [];
      if (pts.length < 2) return null;
      return (
        <Arrow
          points={flatted(pts)}
          stroke={ann.stroke}
          fill={ann.stroke}
          strokeWidth={strokeWidth}
          dash={dash}
          pointerLength={Math.max(3, ann.strokeWidth * 3.4 * unit)}
          pointerWidth={Math.max(3, ann.strokeWidth * 3 * unit)}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      );
    }
    case 'text':
      return <TextAnnotation ann={ann} unit={unit} hidden={Boolean(hideText)} />;
    default:
      return null;
  }
}

export const AnnotationShape = memo(AnnotationShapeInner);
