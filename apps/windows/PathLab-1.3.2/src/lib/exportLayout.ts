import type { ProjectDoc, Rect } from './types';
import { annotationCanvasRect, rectUnion } from './geometry';
import { layoutRichText, type RichLayout } from './richText';
import { resolveMagnifier } from './magnifier';

export type ExportMode = 'canvas' | 'page';
export type ExportPageSize = 'a4' | 'auto';

export const A4_WIDTH = 794;
export const A4_HEIGHT = 1123;
export const AUTO_WIDTH = 900;
export const PAGE_MARGIN = 68;
export const PAGE_TITLE_H = 44;

export interface ExportLayout {
  mode: ExportMode;
  pageSize: ExportPageSize;
  scale: number;
  transparent: boolean;
  pageWidth: number;
  pageHeight: number;
  contentRect: Rect;
  canvasPad: number;
  /** 画布块在页面中的位置与缩放（page 模式） */
  blockX: number;
  blockY: number;
  blockScale: number;
  title?: string;
  titleY: number;
  textX: number;
  textY: number;
  textWidth: number;
  textFontSize: number;
  textLayout: RichLayout | null;
  overflow: boolean;
}

export function contentBounds(project: ProjectDoc): Rect {
  let acc: Rect | null = null;
  for (const img of project.images) {
    if (!img.visible) continue;
    const xs: number[] = [];
    const ys: number[] = [];
    const corners = [
      { x: img.x, y: img.y },
      { x: img.x + img.width, y: img.y },
      { x: img.x + img.width, y: img.y + img.height },
      { x: img.x, y: img.y + img.height },
    ];
    for (const c of corners) {
      const r = ((img.rotation % 360) + 360) % 360;
      const cx = img.x + img.width / 2;
      const cy = img.y + img.height / 2;
      const rad = (r * Math.PI) / 180;
      const dx = c.x - cx;
      const dy = c.y - cy;
      xs.push(cx + dx * Math.cos(rad) - dy * Math.sin(rad));
      ys.push(cy + dx * Math.sin(rad) + dy * Math.cos(rad));
    }
    acc = rectUnion(acc, {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    });
  }
  for (const ann of project.annotations) {
    const parent = project.images.find((i) => i.id === ann.parentImageId) ?? null;
    if (ann.parentImageId && !parent) continue;
    const r = annotationCanvasRect(ann, parent);
    const pad = ann.type === 'text' ? 6 : ann.strokeWidth + 6;
    acc = rectUnion(acc, { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
  }
  for (const m of project.magnifiers) {
    if (!m.visible) continue;
    const src = project.images.find((i) => i.id === m.sourceImageId);
    const r = resolveMagnifier(m, src);
    const radius = r ? r.radius : m.destination.radius;
    acc = rectUnion(acc, {
      x: m.destination.x - radius - 6,
      y: m.destination.y - radius - 6,
      width: radius * 2 + 12,
      height: radius * 2 + 12,
    });
    if (src) {
      acc = rectUnion(acc, {
        x: src.x - 4,
        y: src.y - 4,
        width: src.width + 8,
        height: src.height + 8,
      });
    }
  }
  return acc ?? { x: 0, y: 0, width: 600, height: 400 };
}

export function computeExportLayout(
  project: ProjectDoc,
  mode: ExportMode,
  pageSize: ExportPageSize,
  scale: number,
  transparent: boolean,
  includeText: boolean,
): ExportLayout {
  const content = contentBounds(project);
  const pad = 22;

  if (mode === 'canvas') {
    return {
      mode,
      pageSize,
      scale,
      transparent,
      pageWidth: Math.max(1, Math.round(content.width + pad * 2)),
      pageHeight: Math.max(1, Math.round(content.height + pad * 2)),
      contentRect: content,
      canvasPad: pad,
      blockX: 0,
      blockY: 0,
      blockScale: 1,
      titleY: 0,
      textX: 0,
      textY: 0,
      textWidth: 0,
      textFontSize: 16,
      textLayout: null,
      overflow: false,
    };
  }

  const pageWidth = pageSize === 'a4' ? A4_WIDTH : AUTO_WIDTH;
  const fixedHeight = pageSize === 'a4' ? A4_HEIGHT : null;
  const innerW = pageWidth - PAGE_MARGIN * 2;
  const maxH = fixedHeight ? fixedHeight * 0.44 : Infinity;
  let s = Math.min(innerW / Math.max(1, content.width), maxH / Math.max(1, content.height));
  s = Math.min(s, 2.4);
  const blockW = content.width * s;
  const blockH = content.height * s;

  const title = project.title || '未命名工程';
  const titleY = PAGE_MARGIN;
  const blockY = PAGE_MARGIN + PAGE_TITLE_H + 10;
  const textY = blockY + blockH + 44;
  const textWidth = innerW;
  const textFontSize = 16;
  const textLayout =
    includeText && project.textDocument
      ? layoutRichText(project.textDocument, { width: textWidth, baseFontSize: textFontSize, lineHeight: 1.7 })
      : null;
  const textH = textLayout?.height ?? 0;
  const needed = textY + textH + PAGE_MARGIN;
  const pageHeight = fixedHeight ?? Math.max(320, Math.round(needed));

  return {
    mode,
    pageSize,
    scale,
    transparent,
    pageWidth,
    pageHeight,
    contentRect: content,
    canvasPad: pad,
    blockX: PAGE_MARGIN + (innerW - blockW) / 2,
    blockY,
    blockScale: s,
    title,
    titleY,
    textX: PAGE_MARGIN,
    textY,
    textWidth,
    textFontSize,
    textLayout,
    overflow: fixedHeight ? needed > fixedHeight : false,
  };
}
