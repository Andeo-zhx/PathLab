import { Circle, Ellipse, Group, Line, Rect } from 'react-konva';
import type { AnnotationObject, ImageObject, Point, SceneDoc, Rect as RectT, SelectionRef } from '../lib/types';
import { annotationCanvasRect, imageCorners, imageLocalToCanvas } from '../lib/geometry';
import { resolveMagnifier } from '../lib/magnifier';
import type { HandleDef } from './handles';

export type Draft =
  | { kind: 'rect'; start: Point; current: Point }
  | { kind: 'ellipse'; start: Point; current: Point }
  | { kind: 'line'; start: Point; current: Point }
  | { kind: 'arrow'; start: Point; current: Point }
  | { kind: 'freehand'; points: Point[] }
  | { kind: 'polygon'; points: Point[]; current: Point | null }
  | { kind: 'magnifier'; start: Point; current: Point };

const ACCENT = '#2E6C68';

export interface GuideLine {
  axis: 'x' | 'y';
  position: number;
  from: number;
  to: number;
}

export interface OverlayProps {
  project: SceneDoc;
  selection: SelectionRef[];
  handles: HandleDef[];
  zoom: number;
  draft: Draft | null;
  marquee: RectT | null;
  guides: GuideLine[];
  strokeColor: string;
  strokeWidth: number;
  dash: number[];
  cropFrame: RectT | null;
  cropImage: ImageObject | null;
  hideChrome: boolean;
}

function annPoints(ann: AnnotationObject, parent: ImageObject | null): Point[] {
  const conv = (p: Point) => (parent ? imageLocalToCanvas(parent, p) : p);
  if (ann.geometry.points) return ann.geometry.points.map(conv);
  const r = ann.geometry.rect;
  if (!r) return [];
  return [conv({ x: r.x, y: r.y }), conv({ x: r.x + r.width, y: r.y + r.height })];
}

export function OverlayLayer(props: OverlayProps) {
  const {
    project,
    selection,
    handles,
    zoom,
    draft,
    marquee,
    guides,
    strokeColor,
    strokeWidth,
    dash,
    cropFrame,
    cropImage,
    hideChrome,
  } = props;

  const hs = 9 / zoom;
  const thin = 1.4 / zoom;

  return (
    <Group listening={false}>
      {/* 放大引用的连接线 */}
      {project.magnifiers.map((m) => {
        if (!m.connectorVisible || !m.visible) return null;
        const src = project.images.find((i) => i.id === m.sourceImageId);
        if (!src || !src.visible) return null;
        const res = resolveMagnifier(m, src);
        if (!res) return null;
        const c = res.centerCanvas;
        const dx = m.destination.x - c.x;
        const dy = m.destination.y - c.y;
        const len = Math.hypot(dx, dy);
        if (len < res.radius + 2) return null;
        const ux = dx / len;
        const uy = dy / len;
        const end = {
          x: m.destination.x - ux * res.radius,
          y: m.destination.y - uy * res.radius,
        };
        return (
          <Group key={`conn-${m.id}`}>
            <Line
              points={[c.x, c.y, end.x, end.y]}
              stroke="rgba(17,24,39,0.55)"
              strokeWidth={1.25 / zoom}
              dash={[5 / zoom, 4 / zoom]}
              listening={false}
            />
            <Circle x={c.x} y={c.y} radius={3.4 / zoom} fill="rgba(17,24,39,0.55)" listening={false} />
          </Group>
        );
      })}

      {/* 选中轮廓 */}
      {!hideChrome &&
        selection.map((ref) => {
          if (ref.kind === 'image') {
            const img = project.images.find((i) => i.id === ref.id);
            if (!img) return null;
            const c = imageCorners(img);
            return (
              <Line
                key={`sel-${ref.id}`}
                points={c.flatMap((p) => [p.x, p.y])}
                closed
                stroke={img.locked ? '#8A93A0' : ACCENT}
                strokeWidth={1.5 / zoom}
                dash={img.locked ? [5 / zoom, 4 / zoom] : undefined}
                listening={false}
              />
            );
          }
          if (ref.kind === 'annotation') {
            const ann = project.annotations.find((a) => a.id === ref.id);
            if (!ann) return null;
            const parent = project.images.find((i) => i.id === ann.parentImageId) ?? null;
            if (ann.type === 'polygon' || ann.type === 'freehand') {
              const pts = annPoints(ann, parent);
              if (pts.length > 1) {
                return (
                  <Line
                    key={`sel-${ref.id}`}
                    points={pts.flatMap((p) => [p.x, p.y])}
                    stroke={ACCENT}
                    strokeWidth={thin}
                    dash={[4 / zoom, 4 / zoom]}
                    closed={ann.type === 'polygon'}
                    listening={false}
                  />
                );
              }
            }
            const r = annotationCanvasRect(ann, parent);
            const pad = 3 / zoom;
            return (
              <Rect
                key={`sel-${ref.id}`}
                x={r.x - pad}
                y={r.y - pad}
                width={r.width + pad * 2}
                height={r.height + pad * 2}
                stroke={ACCENT}
                strokeWidth={thin}
                dash={[4 / zoom, 4 / zoom]}
                listening={false}
              />
            );
          }
          const m = project.magnifiers.find((x) => x.id === ref.id);
          if (!m) return null;
          const src = project.images.find((i) => i.id === m.sourceImageId) ?? null;
          const rm = resolveMagnifier(m, src);
          const radius = rm ? rm.radius : m.destination.radius;
          const roiRadius = rm ? rm.radius / Math.max(0.01, m.zoom) : 0;
          return (
            <Group key={`sel-${ref.id}`}>
              <Circle
                x={m.destination.x}
                y={m.destination.y}
                radius={radius + 4 / zoom}
                stroke={ACCENT}
                strokeWidth={thin}
                dash={[4 / zoom, 4 / zoom]}
                listening={false}
              />
              {rm && (
                // 在原图上标出「这一圈对应投射圆里的内容」
                <Circle
                  x={rm.centerCanvas.x}
                  y={rm.centerCanvas.y}
                  radius={roiRadius}
                  stroke={ACCENT}
                  strokeWidth={1.6 / zoom}
                  listening={false}
                />
              )}
            </Group>
          );
        })}

      {/* 控制点 */}
      {!hideChrome &&
        handles.map((h) =>
          h.kind === 'vertex' ? (
            <Circle
              key={h.hid}
              x={h.world.x}
              y={h.world.y}
              radius={5 / zoom}
              fill="#FFFFFF"
              stroke={ACCENT}
              strokeWidth={1.6 / zoom}
              listening={false}
            />
          ) : (
            <Rect
              key={h.hid}
              x={h.world.x - hs / 2}
              y={h.world.y - hs / 2}
              width={hs}
              height={hs}
              cornerRadius={2.5 / zoom}
              fill="#FFFFFF"
              stroke={ACCENT}
              strokeWidth={1.6 / zoom}
              shadowColor="#0F172A"
              shadowOpacity={0.18}
              shadowBlur={4 / zoom}
              listening={false}
            />
          ),
        )}

      {/* 对齐参考线 */}
      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <Line
            key={`guide-x-${i}`}
            points={[g.position, g.from, g.position, g.to]}
            stroke="#E0518A"
            strokeWidth={1 / zoom}
            listening={false}
          />
        ) : (
          <Line
            key={`guide-y-${i}`}
            points={[g.from, g.position, g.to, g.position]}
            stroke="#E0518A"
            strokeWidth={1 / zoom}
            listening={false}
          />
        ),
      )}

      {/* 绘制中的草稿 */}
      {draft && draft.kind === 'rect' && (
        <Rect
          x={Math.min(draft.start.x, draft.current.x)}
          y={Math.min(draft.start.y, draft.current.y)}
          width={Math.abs(draft.current.x - draft.start.x)}
          height={Math.abs(draft.current.y - draft.start.y)}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          dash={dash.length ? dash : undefined}
          listening={false}
        />
      )}
      {draft && draft.kind === 'ellipse' && (
        <Ellipse
          x={(draft.start.x + draft.current.x) / 2}
          y={(draft.start.y + draft.current.y) / 2}
          radiusX={Math.abs(draft.current.x - draft.start.x) / 2}
          radiusY={Math.abs(draft.current.y - draft.start.y) / 2}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          dash={dash.length ? dash : undefined}
          listening={false}
        />
      )}
      {draft && draft.kind === 'line' && (
        <Line
          points={[draft.start.x, draft.start.y, draft.current.x, draft.current.y]}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          dash={dash.length ? dash : undefined}
          listening={false}
        />
      )}
      {draft && draft.kind === 'arrow' && (
        <Line
          points={[draft.start.x, draft.start.y, draft.current.x, draft.current.y]}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          listening={false}
        />
      )}
      {draft && draft.kind === 'freehand' && draft.points.length > 1 && (
        <Line
          points={draft.points.flatMap((p) => [p.x, p.y])}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )}
      {draft && draft.kind === 'polygon' && (
        <>
          <Line
            points={[
              ...draft.points.flatMap((p) => [p.x, p.y]),
              ...(draft.current ? [draft.current.x, draft.current.y] : []),
            ]}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            listening={false}
          />
          {draft.points.map((p, i) => (
            <Circle
              key={`pp-${i}`}
              x={p.x}
              y={p.y}
              radius={4 / zoom}
              fill="#FFFFFF"
              stroke={strokeColor}
              strokeWidth={1.5 / zoom}
              listening={false}
            />
          ))}
        </>
      )}
      {draft && draft.kind === 'magnifier' && (
        <>
          <Ellipse
            x={(draft.start.x + draft.current.x) / 2}
            y={(draft.start.y + draft.current.y) / 2}
            radiusX={Math.abs(draft.current.x - draft.start.x) / 2}
            radiusY={Math.abs(draft.current.y - draft.start.y) / 2}
            stroke="#E23B3B"
            strokeWidth={2 / zoom}
            dash={[6 / zoom, 4 / zoom]}
            listening={false}
          />
        </>
      )}

      {/* 框选 */}
      {marquee && (
        <Rect
          x={Math.min(marquee.x, marquee.x + marquee.width)}
          y={Math.min(marquee.y, marquee.y + marquee.height)}
          width={Math.abs(marquee.width)}
          height={Math.abs(marquee.height)}
          fill="rgba(46,108,104,0.09)"
          stroke={ACCENT}
          strokeWidth={1 / zoom}
          dash={[5 / zoom, 3 / zoom]}
          listening={false}
        />
      )}

      {/* 裁切框 */}
      {cropFrame && cropImage && <CropFrame image={cropImage} frame={cropFrame} zoom={zoom} />}
    </Group>
  );
}

function CropFrame({ image, frame, zoom }: { image: ImageObject; frame: RectT; zoom: number }) {
  const corners = [
    { x: frame.x, y: frame.y },
    { x: frame.x + frame.width, y: frame.y },
    { x: frame.x + frame.width, y: frame.y + frame.height },
    { x: frame.x, y: frame.y + frame.height },
  ].map((p) => imageLocalToCanvas(image, p));
  const mids = [
    imageLocalToCanvas(image, { x: frame.x + frame.width / 2, y: frame.y }),
    imageLocalToCanvas(image, { x: frame.x + frame.width, y: frame.y + frame.height / 2 }),
    imageLocalToCanvas(image, { x: frame.x + frame.width / 2, y: frame.y + frame.height }),
    imageLocalToCanvas(image, { x: frame.x, y: frame.y + frame.height / 2 }),
  ];
  const hs = 10 / zoom;
  return (
    <Group listening={false}>
      <Line
        points={corners.flatMap((p) => [p.x, p.y])}
        closed
        stroke="#FFFFFF"
        strokeWidth={1.6 / zoom}
        shadowColor="#0F172A"
        shadowOpacity={0.5}
        shadowBlur={4 / zoom}
        listening={false}
      />
      {[...corners, ...mids].map((p, i) => (
        <Rect
          key={`crop-h-${i}`}
          x={p.x - hs / 2}
          y={p.y - hs / 2}
          width={hs}
          height={hs}
          fill="#FFFFFF"
          stroke="rgba(15,23,42,0.35)"
          strokeWidth={1 / zoom}
          listening={false}
        />
      ))}
    </Group>
  );
}
