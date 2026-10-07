import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Group, Layer, Rect, Shape, Stage, Text as KText } from 'react-konva';
import type Konva from 'konva';
import type { AnnotationObject, MagnifierObject, ProjectDoc } from '../lib/types';
import { ImageNode } from '../canvas/ImageNode';
import { MagnifierNode } from '../canvas/MagnifierNode';
import { AnnotationsOverlay } from '../canvas/AnnotationsOverlay';
import { OverlayLayer } from '../canvas/OverlayLayer';
import { paintRichLayout } from '../lib/richText';
import { DEFAULT_TEXT_FONT_FAMILY } from '../lib/textPreferences';
import type { ExportLayout } from '../lib/exportLayout';

const FONT_FAMILY = DEFAULT_TEXT_FONT_FAMILY;

const EMPTY_ANNOTATIONS: AnnotationObject[] = [];
const EMPTY_MAGNIFIERS: MagnifierObject[] = [];
const EMPTY_SELECTION: never[] = [];
const EMPTY_HANDLES: never[] = [];
const EMPTY_GUIDES: never[] = [];
const EMPTY_DASH: number[] = [];

function RichTextShape({ layout, x, y }: { layout: ExportLayout['textLayout']; x: number; y: number }) {
  if (!layout) return null;
  return (
    <Shape
      x={x}
      y={y}
      listening={false}
      sceneFunc={(ctx) => {
        const raw =
          (ctx as unknown as { _context?: CanvasRenderingContext2D })._context ??
          (ctx as unknown as CanvasRenderingContext2D);
        paintRichLayout(raw, layout, 0, 0);
      }}
    />
  );
}

/** 场景图形本身（不含 Layer，Layer 由调用方包裹） */
function SceneShapes({ project, hiRes }: { project: ProjectDoc; hiRes: boolean }) {
  const imageOrder = useMemo(() => [...project.images].sort((a, b) => a.zIndex - b.zIndex), [project.images]);
  const magnifierOrder = useMemo(
    () => [...project.magnifiers].sort((a, b) => a.zIndex - b.zIndex),
    [project.magnifiers],
  );
  const byImage = useMemo(() => {
    const map = new Map<string, AnnotationObject[]>();
    const loose: AnnotationObject[] = [];
    for (const a of project.annotations) {
      if (!a.parentImageId) {
        loose.push(a);
        continue;
      }
      const list = map.get(a.parentImageId);
      if (list) list.push(a);
      else map.set(a.parentImageId, [a]);
    }
    for (const list of map.values()) list.sort((a, b) => a.zIndex - b.zIndex);
    loose.sort((a, b) => a.zIndex - b.zIndex);
    map.set('__loose__', loose);
    return map;
  }, [project.annotations]);
  const roisByImage = useMemo(() => {
    const map = new Map<string, MagnifierObject[]>();
    for (const m of project.magnifiers) {
      const list = map.get(m.sourceImageId);
      if (list) list.push(m);
      else map.set(m.sourceImageId, [m]);
    }
    return map;
  }, [project.magnifiers]);

  return (
    <>
      {imageOrder.map((img) => (
        <ImageNode
          key={img.id}
          img={img}
          annotations={byImage.get(img.id) ?? EMPTY_ANNOTATIONS}
          rois={roisByImage.get(img.id) ?? EMPTY_MAGNIFIERS}
          hiRes={hiRes}
          hideAnnotations
        />
      ))}
      {magnifierOrder.map((m) => (
        <MagnifierNode
          key={m.id}
          magnifier={m}
          hiRes={hiRes}
          source={project.images.find((i) => i.id === m.sourceImageId) ?? null}
        />
      ))}
      <AnnotationsOverlay project={project} />
      <OverlayLayer
        project={{ images: project.images, annotations: project.annotations, magnifiers: project.magnifiers }}
        selection={EMPTY_SELECTION}
        handles={EMPTY_HANDLES}
        zoom={1}
        draft={null}
        marquee={null}
        guides={EMPTY_GUIDES}
        strokeColor="#000000"
        strokeWidth={1}
        dash={EMPTY_DASH}
        cropFrame={null}
        cropImage={null}
        hideChrome
      />
    </>
  );
}

export interface ExportStageProps {
  project: ProjectDoc;
  layout: ExportLayout;
  onRendered: (image: Blob) => void;
  onError: (err: unknown) => void;
}

export function ExportComposition({
  project,
  layout,
  hiRes,
}: {
  project: ProjectDoc;
  layout: ExportLayout;
  hiRes: boolean;
}) {
  const background = layout.transparent && layout.mode === 'canvas' ? undefined : '#FFFFFF';
  return (
    <>
      {background && <Rect x={0} y={0} width={layout.pageWidth} height={layout.pageHeight} fill={background} />}
      {layout.mode === 'canvas' ? (
        <Group x={-layout.contentRect.x + layout.canvasPad} y={-layout.contentRect.y + layout.canvasPad}>
          <SceneShapes project={project} hiRes={hiRes} />
        </Group>
      ) : (
        <>
          <KText
            text={layout.title ?? ''}
            x={layout.textX}
            y={layout.titleY}
            width={layout.pageWidth - layout.textX * 2}
            fontSize={26}
            fontStyle="700"
            fontFamily={FONT_FAMILY}
            fill="#111827"
            listening={false}
          />
          <Rect
            x={layout.textX}
            y={layout.titleY + 40}
            width={layout.pageWidth - layout.textX * 2}
            height={1}
            fill="rgba(15,23,42,0.14)"
            listening={false}
          />
          <Group x={layout.blockX} y={layout.blockY} scaleX={layout.blockScale} scaleY={layout.blockScale}>
            <Group x={-layout.contentRect.x} y={-layout.contentRect.y}>
              <SceneShapes project={project} hiRes={hiRes} />
            </Group>
          </Group>
          <RichTextShape layout={layout.textLayout} x={layout.textX} y={layout.textY} />
        </>
      )}
    </>
  );
}

export function ExportStage({ project, layout, onRendered, onError }: ExportStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const guard = useRef(false);

  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    let timer = 0;
    let cancelled = false;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          const stage = stageRef.current;
          if (!stage || guard.current) return;
          void stage
            .toBlob({ pixelRatio: layout.scale, mimeType: 'image/png' })
            .then((image) => {
              if (cancelled) return;
              if (!image || image.size === 0 || image.type !== 'image/png') {
                throw new Error('PNG 编码失败或输出为空');
              }
            guard.current = true;
              onRendered(image);
            })
            .catch((err: unknown) => {
              if (cancelled) return;
              guard.current = true;
              onError(err);
            });
        }, 120);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const node = (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: -200000,
        top: 0,
        width: layout.pageWidth,
        height: layout.pageHeight,
        pointerEvents: 'none',
      }}
    >
      <Stage ref={stageRef} width={layout.pageWidth} height={layout.pageHeight}>
        <Layer listening={false}>
          <ExportComposition project={project} layout={layout} hiRes />
        </Layer>
      </Stage>
    </div>
  );

  return createPortal(node, document.body);
}
