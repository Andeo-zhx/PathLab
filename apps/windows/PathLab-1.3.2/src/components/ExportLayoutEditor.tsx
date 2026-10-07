import { useEffect, useRef, useState } from 'react';
import { Move, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Layer, Stage } from 'react-konva';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ProjectDoc } from '../lib/types';
import { layoutRichText } from '../lib/richText';
import type { ExportLayout } from '../lib/exportLayout';
import { ExportComposition } from './ExportStage';

type Area = 'board' | 'text';
type DragMode = 'move' | 'resize';

interface DragState {
  area: Area;
  mode: DragMode;
  startX: number;
  startY: number;
  layout: ExportLayout;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

export function ExportLayoutEditor({
  project,
  layout,
  onChange,
  onReset,
}: {
  project: ProjectDoc;
  layout: ExportLayout;
  onChange: (next: ExportLayout) => void;
  onReset: () => void;
}) {
  const [selected, setSelected] = useState<Area>('board');
  const previewRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const hasText = Boolean(layout.textLayout && project.textDocument);
  const previewScale = Math.min(560 / layout.pageWidth, 690 / layout.pageHeight);
  const previewWidth = layout.pageWidth * previewScale;
  const previewHeight = layout.pageHeight * previewScale;
  const boardWidth = layout.contentRect.width * layout.blockScale;
  const boardHeight = layout.contentRect.height * layout.blockScale;
  const textHeight = (layout.textLayout?.height ?? 0) + 12;

  useEffect(() => () => cleanupRef.current?.(), []);
  useEffect(() => {
    if (!hasText && selected === 'text') setSelected('board');
  }, [hasText, selected]);

  const logicalPoint = (clientX: number, clientY: number) => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * layout.pageWidth,
      y: ((clientY - rect.top) / rect.height) * layout.pageHeight,
    };
  };

  const beginDrag = (area: Area, mode: DragMode, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    cleanupRef.current?.();
    setSelected(area);
    const start = logicalPoint(event.clientX, event.clientY);
    const startLayout = layout;
    const drag: DragState = { area, mode, startX: start.x, startY: start.y, layout: startLayout };

    const onMove = (pointer: PointerEvent) => {
      const current = logicalPoint(pointer.clientX, pointer.clientY);
      const dx = current.x - drag.startX;
      const dy = current.y - drag.startY;
      const next = { ...drag.layout };

      if (drag.area === 'board' && drag.mode === 'move') {
        next.blockX = clamp(drag.layout.blockX + dx, 0, next.pageWidth - boardWidth);
        next.blockY = clamp(drag.layout.blockY + dy, 0, next.pageHeight - boardHeight);
      } else if (drag.area === 'board') {
        const baseWidth = Math.max(1, drag.layout.contentRect.width * drag.layout.blockScale);
        const baseHeight = Math.max(1, drag.layout.contentRect.height * drag.layout.blockScale);
        const factor = Math.max(0.08, ((baseWidth + dx) / baseWidth + (baseHeight + dy) / baseHeight) / 2);
        const maxScale = Math.min(
          (next.pageWidth - drag.layout.blockX) / Math.max(1, next.contentRect.width),
          (next.pageHeight - drag.layout.blockY) / Math.max(1, next.contentRect.height),
        );
        next.blockScale = clamp(drag.layout.blockScale * factor, 0.12, maxScale);
      } else if (drag.area === 'text' && drag.mode === 'move') {
        next.textX = clamp(drag.layout.textX + dx, 0, next.pageWidth - drag.layout.textWidth);
        next.textY = clamp(drag.layout.textY + dy, 0, next.pageHeight - textHeight);
      } else {
        const width = clamp(drag.layout.textWidth + dx, 150, next.pageWidth - drag.layout.textX);
        next.textWidth = width;
        if (project.textDocument) {
          next.textLayout = layoutRichText(project.textDocument, {
            width,
            baseFontSize: drag.layout.textFontSize,
            lineHeight: 1.7,
          });
        }
        const resizedHeight = (next.textLayout?.height ?? 0) + 12;
        next.textY = clamp(drag.layout.textY, 0, next.pageHeight - resizedHeight);
      }
      onChange(next);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cleanupRef.current = null;
    };
    cleanupRef.current = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const adjustBoardScale = (factor: number) => {
    const maxScale = Math.min(
      (layout.pageWidth - layout.blockX) / Math.max(1, layout.contentRect.width),
      (layout.pageHeight - layout.blockY) / Math.max(1, layout.contentRect.height),
    );
    onChange({ ...layout, blockScale: clamp(layout.blockScale * factor, 0.12, maxScale) });
  };

  const adjustTextFont = (delta: number) => {
    if (!project.textDocument) return;
    const textFontSize = clamp(layout.textFontSize + delta, 10, 28);
    const textLayout = layoutRichText(project.textDocument, {
      width: layout.textWidth,
      baseFontSize: textFontSize,
      lineHeight: 1.7,
    });
    const textY = clamp(layout.textY, 0, layout.pageHeight - textLayout.height - 12);
    onChange({ ...layout, textFontSize, textLayout, textY });
  };

  const boardFrameStyle = {
    left: layout.blockX * previewScale,
    top: layout.blockY * previewScale,
    width: boardWidth * previewScale,
    height: boardHeight * previewScale,
  };
  const textFrameStyle = {
    left: layout.textX * previewScale,
    top: layout.textY * previewScale,
    width: layout.textWidth * previewScale,
    height: textHeight * previewScale,
  };

  return (
    <div className="export-workbench">
      <div className="export-preview-column">
        <div className="export-preview-heading">
          <div>
            <strong>页面预览</strong>
            <span>拖动区域移动，拖右下角调整尺寸</span>
          </div>
          <span className="export-page-chip">{layout.pageSize === 'a4' ? 'A4 · 纵向' : '自适应长图'}</span>
        </div>
        <div className="export-preview-stage">
          <div
            className="export-preview-paper"
            style={{ width: previewWidth, height: previewHeight }}
            ref={previewRef}
          >
            <div
              className="export-preview-render"
              style={{
                width: layout.pageWidth,
                height: layout.pageHeight,
                transform: `scale(${previewScale})`,
              }}
            >
              <Stage width={layout.pageWidth} height={layout.pageHeight}>
                <Layer listening={false}>
                  <ExportComposition project={project} layout={layout} hiRes={false} />
                </Layer>
              </Stage>
            </div>
            <div className="export-preview-overlays" style={{ width: previewWidth, height: previewHeight }}>
              <div
                role="group"
                aria-label="白板内容区，可拖动和调整大小"
                className={`export-layout-frame export-layout-frame-board${selected === 'board' ? ' is-selected' : ''}`}
                style={boardFrameStyle}
                onPointerDown={(event) => beginDrag('board', 'move', event)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') onChange({ ...layout, blockX: clamp(layout.blockX - 12, 0, layout.pageWidth - boardWidth) });
                  if (event.key === 'ArrowRight') onChange({ ...layout, blockX: clamp(layout.blockX + 12, 0, layout.pageWidth - boardWidth) });
                  if (event.key === 'ArrowUp') onChange({ ...layout, blockY: clamp(layout.blockY - 12, 0, layout.pageHeight - boardHeight) });
                  if (event.key === 'ArrowDown') onChange({ ...layout, blockY: clamp(layout.blockY + 12, 0, layout.pageHeight - boardHeight) });
                }}
                tabIndex={0}
              >
                <span className="export-frame-label"><Move size={11} /> 白板</span>
                <button
                  type="button"
                  className="export-frame-grip"
                  aria-label="调整白板大小"
                  onPointerDown={(event) => beginDrag('board', 'resize', event)}
                />
              </div>
              {hasText && (
                <div
                  role="group"
                  aria-label="观察记录区，可拖动和调整宽度"
                  className={`export-layout-frame export-layout-frame-text${selected === 'text' ? ' is-selected' : ''}`}
                  style={textFrameStyle}
                  onPointerDown={(event) => beginDrag('text', 'move', event)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft') onChange({ ...layout, textX: clamp(layout.textX - 12, 0, layout.pageWidth - layout.textWidth) });
                    if (event.key === 'ArrowRight') onChange({ ...layout, textX: clamp(layout.textX + 12, 0, layout.pageWidth - layout.textWidth) });
                    if (event.key === 'ArrowUp') onChange({ ...layout, textY: clamp(layout.textY - 12, 0, layout.pageHeight - textHeight) });
                    if (event.key === 'ArrowDown') onChange({ ...layout, textY: clamp(layout.textY + 12, 0, layout.pageHeight - textHeight) });
                  }}
                  tabIndex={0}
                >
                  <span className="export-frame-label"><Move size={11} /> 文字区</span>
                  <button
                    type="button"
                    className="export-frame-grip"
                    aria-label="调整文字区宽度"
                    onPointerDown={(event) => beginDrag('text', 'resize', event)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="export-preview-footnote">仅调整导出页面，不会改动原白板或项目文件</div>
      </div>

      <aside className="export-layout-controls">
        <div className="export-control-head">
          <div>
            <span className="field-label">当前选区</span>
            <strong>{selected === 'board' ? '白板内容区' : '观察记录区'}</strong>
          </div>
          <button type="button" className="export-reset-button" onClick={onReset} title="恢复默认排版">
            <RotateCcw size={14} /> 重置
          </button>
        </div>

        <div className="export-area-switch" role="group" aria-label="选择要编辑的区域">
          <button type="button" aria-pressed={selected === 'board'} onClick={() => setSelected('board')}>
            白板
          </button>
          <button
            type="button"
            aria-pressed={selected === 'text'}
            disabled={!hasText}
            onClick={() => setSelected('text')}
          >
            文字区
          </button>
        </div>

        {selected === 'board' ? (
          <div className="export-inspector-card">
            <span className="export-inspector-label">白板缩放</span>
            <div className="export-stepper">
              <button type="button" onClick={() => adjustBoardScale(0.9)} aria-label="缩小白板"><ZoomOut size={16} /></button>
              <strong>{Math.round(layout.blockScale * 100)}%</strong>
              <button type="button" onClick={() => adjustBoardScale(1.1)} aria-label="放大白板"><ZoomIn size={16} /></button>
            </div>
            <small>可在预览中拖动定位，拖动右下角等比缩放</small>
          </div>
        ) : (
          <div className="export-inspector-card">
            <span className="export-inspector-label">文字字号</span>
            <div className="export-stepper">
              <button type="button" onClick={() => adjustTextFont(-2)} aria-label="缩小字号"><ZoomOut size={16} /></button>
              <strong>{layout.textFontSize}px</strong>
              <button type="button" onClick={() => adjustTextFont(2)} aria-label="放大字号"><ZoomIn size={16} /></button>
            </div>
            <small>拖动文字区移动位置，拖右下角调整栏宽</small>
          </div>
        )}

        <div className="export-position-readout">
          <span>位置</span>
          <b>
            {Math.round(selected === 'board' ? layout.blockX : layout.textX)} ×{' '}
            {Math.round(selected === 'board' ? layout.blockY : layout.textY)}
          </b>
        </div>
        <div className="export-layout-tip">键盘方向键也可微调当前选区。排版只影响本次导出。</div>
      </aside>
    </div>
  );
}
