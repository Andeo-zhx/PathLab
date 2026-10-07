import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Stage } from 'react-konva';
import type Konva from 'konva';
import { Check, Crop, Plus, X } from 'lucide-react';
import { useProject } from '../store/projectStore';
import { useUi, type ContextMenuItem } from '../store/uiStore';
import { useStyle } from '../store/styleStore';
import type {
  AnnotationGeometry,
  AnnotationObject,
  ImageObject,
  MagnifierObject,
  Point,
  Rect as RectT,
  SelectionRef,
  Tool,
} from '../lib/types';
import {
  canvasToImageLocal,
  clamp,
  distance,
  imageAABB,
  imageDisplayScale,
  imageLocalToCanvas,
  normRect,
  rectsIntersect,
  simplifyPolyline,
  smoothPolyline,
} from '../lib/geometry';
import { viewport, viewCommands } from '../lib/viewport';
import { hitTest, imageUnderPoint } from './hitTest';
import { getHandles, type HandleDef } from './handles';
import { cropViewOf, resizeImageBox, scalePoints } from './transform';
import { ImageNode } from './ImageNode';
import { MagnifierNode } from './MagnifierNode';
import { AnnotationsOverlay } from './AnnotationsOverlay';
import { OverlayLayer, type Draft, type GuideLine } from './OverlayLayer';
import { createAnnotation, createMagnifier } from '../lib/factory';
import {
  MIN_SOURCE_RADIUS,
  magnifierRegionCenter,
  maxSourceRadiusAt,
  resolveMagnifier,
  setRegionRadius,
  sourceRadiusFromProjection,
} from '../lib/magnifier';
import { TextEditOverlay } from './TextEditOverlay';
import { SelectionToolbar } from '../components/SelectionToolbar';
import { hasClipboard } from '../lib/actions';
import { pickImageFiles } from '../lib/commands';
import { MOD } from '../lib/platform';

const SNAP_TOLERANCE = 6;
const EMPTY_ANNOTATIONS: AnnotationObject[] = [];
const EMPTY_MAGNIFIERS: MagnifierObject[] = [];

type MoveItem =
  | { kind: 'image'; id: string; x: number; y: number }
  | { kind: 'annotation'; id: string; parentId: string | null; grab: Point; geometry: AnnotationGeometry }
  | { kind: 'magnifier'; id: string; x: number; y: number };

type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

type Interaction =
  | { type: 'idle' }
  | { type: 'pan'; startScreen: Point; startPan: Point }
  | { type: 'marquee'; start: Point; current: Point; additive: boolean }
  | { type: 'move'; start: Point; items: MoveItem[]; moved: boolean; baseRects: RectT[]; movingIds: string[] }
  | { type: 'imageResize'; id: string; corner: 'nw' | 'ne' | 'se' | 'sw'; base: ImageObject }
  | { type: 'annRect'; id: string; handle: HandleDef; base: RectT; parent: ImageObject | null }
  | { type: 'freehandResize'; id: string; corner: 'nw' | 'ne' | 'se' | 'sw'; base: RectT; points: Point[]; parent: ImageObject | null }
  | { type: 'vertex'; id: string; index: number; base: Point[]; parent: ImageObject | null }
  | { type: 'magnifierRadius'; id: string }
  | { type: 'magnifierRoiRadius'; id: string }
  | { type: 'draw'; tool: Tool; start: Point; parentImageId: string | null }
  | { type: 'textPlace'; at: Point }
  | { type: 'freehandDraw'; parentImageId: string | null }
  | { type: 'magnifierDraw'; imageId: string; start: Point }
  | { type: 'crop'; imageId: string; handle: CropHandle; base: RectT; grab: Point };

type TouchSequence = {
  startEvent: Konva.KonvaEventObject<TouchEvent>;
  startClient: Point;
  inputType: 'finger' | 'pen';
  active: boolean;
  longPressed: boolean;
  timer: number;
};

type RecentPointerInput = {
  pointerType: 'touch' | 'pen';
  pointerId: number;
  clientX: number;
  clientY: number;
  time: number;
};

function touchInputType(touch: Touch, recent: RecentPointerInput | null): 'finger' | 'pen' {
  const nativeTouchType = (touch as Touch & { touchType?: string }).touchType;
  if (nativeTouchType === 'stylus' || nativeTouchType === 'pencil') return 'pen';

  if (
    recent &&
    performance.now() - recent.time < 250 &&
    Math.hypot(touch.clientX - recent.clientX, touch.clientY - recent.clientY) < 48
  ) {
    return recent.pointerType === 'pen' ? 'pen' : 'finger';
  }
  return 'finger';
}

function touchMetrics(evt: TouchEvent, rect: DOMRect, stage: Konva.Stage): { center: Point; distance: number } | null {
  if (evt.touches.length < 2) return null;
  const a = evt.touches[0];
  const b = evt.touches[1];
  const scaleX = rect.width / (stage.container().clientWidth || rect.width) || 1;
  const scaleY = rect.height / (stage.container().clientHeight || rect.height) || 1;
  const first = { x: (a.clientX - rect.left) / scaleX, y: (a.clientY - rect.top) / scaleY };
  const second = { x: (b.clientX - rect.left) / scaleX, y: (b.clientY - rect.top) / scaleY };
  return {
    center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.max(1, distance(first, second)),
  };
}

function cropHandleAnchor(handle: CropHandle): { ax: number; ay: number } {
  switch (handle) {
    case 'nw':
      return { ax: 1, ay: 1 };
    case 'n':
      return { ax: 0.5, ay: 1 };
    case 'ne':
      return { ax: 0, ay: 1 };
    case 'e':
      return { ax: 0, ay: 0.5 };
    case 'se':
      return { ax: 0, ay: 0 };
    case 's':
      return { ax: 0.5, ay: 0 };
    case 'sw':
      return { ax: 1, ay: 0 };
    case 'w':
      return { ax: 1, ay: 0.5 };
    default:
      return { ax: 0, ay: 0 };
  }
}

function forceCircle(start: Point, current: Point): Point {
  const r = Math.max(Math.abs(current.x - start.x), Math.abs(current.y - start.y));
  return {
    x: start.x + (current.x - start.x < 0 ? -r : r),
    y: start.y + (current.y - start.y < 0 ? -r : r),
  };
}

function boundsOf(points: Point[]): RectT {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function shiftGeometry(g: AnnotationGeometry, dx: number, dy: number): AnnotationGeometry {
  const next: AnnotationGeometry = {};
  if (g.rect) next.rect = { ...g.rect, x: g.rect.x + dx, y: g.rect.y + dy };
  if (g.points) next.points = g.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  if (g.position) next.position = { x: g.position.x + dx, y: g.position.y + dy };
  return next;
}

/**
 * 新建标注时的尺寸补偿：画布缩得很小时，按屏幕观感放大线宽与字号，
 * 保证“画出来的粗细 = 看到的粗细”，同时设定 3 倍上限避免极端值。
 */
function newObjectScale(): number {
  const z = useProject.getState().project.canvas.zoom || 1;
  return clamp(1 / z, 1, 3);
}

function scaledStyle(base: { strokeWidth: number; fontSize: number; dash: number[] }): {
  strokeWidth: number;
  fontSize: number;
  dash: number[];
} {
  const k = newObjectScale();
  return {
    strokeWidth: base.strokeWidth * k,
    fontSize: base.fontSize * k,
    dash: base.dash.length ? base.dash.map((d) => d * k) : [],
  };
}

function nextAnnotationZ(): number {
  const st = useProject.getState();
  return st.project.annotations.reduce((m, a) => Math.max(m, a.zIndex), -1) + 1;
}

function nextMagnifierZ(): number {
  const st = useProject.getState();
  return st.project.magnifiers.reduce((m, a) => Math.max(m, a.zIndex), -1) + 1;
}

export function CanvasWorkspace() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const interaction = useRef<Interaction>({ type: 'idle' });
  const lastClick = useRef<{ t: number; x: number; y: number } | null>(null);
  const touchSequence = useRef<TouchSequence | null>(null);
  const recentPointerInput = useRef<RecentPointerInput | null>(null);
  const pinchGesture = useRef<{ center: Point; distance: number } | null>(null);
  const contextMenuRef = useRef<((e: Konva.KonvaEventObject<PointerEvent>) => void) | null>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [polyCursor, setPolyCursor] = useState<Point | null>(null);
  const [marquee, setMarquee] = useState<RectT | null>(null);
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [dropping, setDropping] = useState(false);
  const [panning, setPanning] = useState(false);

  const images = useProject((s) => s.project.images);
  const annotations = useProject((s) => s.project.annotations);
  const magnifiers = useProject((s) => s.project.magnifiers);
  const canvasView = useProject((s) => s.project.canvas);
  const projectTransition = useProject((s) => s.projectTransition);
  const begin = useProject((s) => s.begin);
  const endHistory = useProject((s) => s.end);
  const project = useMemo(() => ({ images, annotations, magnifiers }), [images, annotations, magnifiers]);

  useEffect(() => {
    interaction.current = { type: 'idle' };
    lastClick.current = null;
    touchSequence.current = null;
    recentPointerInput.current = null;
    pinchGesture.current = null;
    endHistory();
    setDraft(null);
    setPolyCursor(null);
    setMarquee(null);
    setGuides([]);
    setPanning(false);
    useUi.getState().setPendingPolygon(null);
  }, [endHistory, projectTransition]);

  const tool = useUi((s) => s.tool);
  const selection = useUi((s) => s.selection);
  const editingTextId = useUi((s) => s.editingTextId);
  const croppingImageId = useUi((s) => s.croppingImageId);
  const cropDraft = useUi((s) => s.cropDraft);
  const spacePressed = useUi((s) => s.spacePressed);
  const annotationsGloballyVisible = useUi((s) => s.annotationsGloballyVisible);
  const pendingPolygon = useUi((s) => s.pendingPolygon);

  const style = useStyle();
  const zoom = canvasView.zoom;

  /* ---------------- 尺寸 ---------------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const rect = host.getBoundingClientRect();
      const next = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
      viewport.width = next.width;
      viewport.height = next.height;
      setSize(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  /* ---------------- 坐标换算 ---------------- */
  const screenToWorld = useCallback((p: Point): Point => {
    const v = useProject.getState().project.canvas;
    return { x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom };
  }, []);

  const worldToScreen = useCallback((p: Point): Point => {
    const v = useProject.getState().project.canvas;
    return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY };
  }, []);

  const pointerWorld = useCallback((): Point | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return screenToWorld(pos);
  }, [screenToWorld]);

  /* ---------------- 缩放 ---------------- */
  const zoomAt = useCallback((screen: Point, factor: number) => {
    const st = useProject.getState();
    const v = st.project.canvas;
    const next = clamp(v.zoom * factor, 0.1, 8);
    if (Math.abs(next - v.zoom) < 1e-6) return;
    const wx = (screen.x - v.panX) / v.zoom;
    const wy = (screen.y - v.panY) / v.zoom;
    st.setView({ zoom: next, panX: screen.x - wx * next, panY: screen.y - wy * next });
  }, []);

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      if (e.evt.shiftKey && !e.evt.ctrlKey && !e.evt.metaKey) {
        const st = useProject.getState();
        st.setView({ panX: st.project.canvas.panX - e.evt.deltaY });
        return;
      }
      const intensity = e.evt.ctrlKey || e.evt.metaKey ? 0.012 : 0.0018;
      zoomAt(pos, Math.exp(-e.evt.deltaY * intensity));
    },
    [zoomAt],
  );

  /* ---------------- 适应视图 ---------------- */
  const fitView = useCallback(
    (padding = 58) => {
      const st = useProject.getState();
      const imgs = st.project.images.filter((i) => i.visible);
      if (!imgs.length) {
        st.setView({ zoom: 1, panX: size.width / 2, panY: size.height / 2 });
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const img of imgs) {
        const r = imageAABB(img);
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const z = clamp(
        Math.min((size.width - padding * 2 - 60) / w, (size.height - padding * 2) / h),
        0.02,
        8,
      );
      st.setView({
        zoom: z,
        panX: (size.width - 60) / 2 + 26 - (minX + w / 2) * z,
        panY: size.height / 2 - (minY + h / 2) * z,
      });
    },
    [size.width, size.height],
  );

  useEffect(() => {
    viewCommands.fit = () => fitView();
    viewCommands.zoom100 = () => {
      const st = useProject.getState();
      const v = st.project.canvas;
      const cx = (size.width - 60) / 2 + 26;
      const cy = size.height / 2;
      const wx = (cx - v.panX) / v.zoom;
      const wy = (cy - v.panY) / v.zoom;
      st.setView({ zoom: 1, panX: cx - wx, panY: cy - wy });
    };
    viewCommands.zoomTo = (z: number) => {
      const st = useProject.getState();
      const v = st.project.canvas;
      const cx = (size.width - 60) / 2 + 26;
      const cy = size.height / 2;
      const wx = (cx - v.panX) / v.zoom;
      const wy = (cy - v.panY) / v.zoom;
      st.setView({ zoom: z, panX: cx - wx * z, panY: cy - wy * z });
    };
  }, [fitView, size.width, size.height]);

  /* ---------------- 提交：文字 / 绘制 / 多边形 ---------------- */
  const commitText = useCallback(() => {
    const ui = useUi.getState();
    const id = ui.editingTextId;
    if (!id) return;
    const value = ui.textDraft ?? '';
    const st = useProject.getState();
    const ann = st.project.annotations.find((a) => a.id === id);
    ui.setEditingText(null, null);
    if (!ann) return;
    if (!value.trim()) {
      st.applyWithHistory('删除空白文字', (d) => {
        d.annotations = d.annotations.filter((a) => a.id !== id);
      });
      ui.setSelection([]);
      return;
    }
    if ((ann.text ?? '') === value) return;
    st.applyWithHistory('编辑文字', (d) => {
      const a = d.annotations.find((x) => x.id === id);
      if (a) a.text = value;
    });
  }, []);

  const finishPolygon = useCallback(() => {
    const ui = useUi.getState();
    const st = useProject.getState();
    const pending = ui.pendingPolygon;
    ui.setPendingPolygon(null);
    setDraft(null);
    setPolyCursor(null);
    if (!pending || pending.points.length < 3) return;
    const rawStyle = useStyle.getState();
    const ann = createAnnotation('polygon', pending.parentImageId, { ...rawStyle, ...scaledStyle(rawStyle) }, nextAnnotationZ());
    ann.geometry = { points: pending.points.map((p) => ({ ...p })) };
    st.applyWithHistory('绘制多边形套索', (d) => {
      d.annotations.push(ann);
    });
    ui.setSelection([{ id: ann.id, kind: 'annotation' }]);
    ui.setTool('select');
  }, []);

  const commitDragDraw = useCallback(
    (toolName: Tool, d: Draft, parentImageId: string | null) => {
      const st = useProject.getState();
      const parent = st.project.images.find((i) => i.id === parentImageId) ?? null;
      const toLocal = (p: Point) => (parent ? canvasToImageLocal(parent, p) : p);
      const rawStyle = useStyle.getState();
      const sized = scaledStyle(rawStyle);
      const styleNow = { ...rawStyle, ...sized };

      if (d.kind === 'rect' || d.kind === 'ellipse') {
        const r = normRect(d.start, d.current);
        if (r.width < 2 && r.height < 2) return;
        const rect = normRect(toLocal({ x: r.x, y: r.y }), toLocal({ x: r.x + r.width, y: r.y + r.height }));
        const ann = createAnnotation(d.kind, parentImageId, styleNow, nextAnnotationZ());
        ann.geometry = { rect };
        st.applyWithHistory(d.kind === 'rect' ? '绘制矩形' : '绘制椭圆', (dd) => {
          dd.annotations.push(ann);
        });
        useUi.getState().setSelection([{ id: ann.id, kind: 'annotation' }]);
        return;
      }
      if (d.kind === 'line' || d.kind === 'arrow') {
        if (distance(d.start, d.current) < 2) return;
        const ann = createAnnotation(d.kind, parentImageId, styleNow, nextAnnotationZ());
        ann.dash = [];
        ann.geometry = { points: [toLocal(d.start), toLocal(d.current)] };
        st.applyWithHistory(d.kind === 'line' ? '绘制直线' : '绘制箭头', (dd) => {
          dd.annotations.push(ann);
        });
        useUi.getState().setSelection([{ id: ann.id, kind: 'annotation' }]);
        return;
      }
      void toolName;
    },
    [],
  );

  /* ---------------- 命中辅助 ---------------- */
  const handles = useMemo(
    () => (croppingImageId ? [] : getHandles(project, selection)),
    [project, selection, croppingImageId],
  );

  const cropHandles = useMemo(() => {
    if (!croppingImageId || !cropDraft) return [];
    const img = project.images.find((i) => i.id === croppingImageId);
    if (!img) return [];
    const view = cropViewOf(img, cropDraft);
    const r = cropDraft;
    const map: { handle: CropHandle; p: Point }[] = [
      { handle: 'nw', p: { x: r.x, y: r.y } },
      { handle: 'n', p: { x: r.x + r.width / 2, y: r.y } },
      { handle: 'ne', p: { x: r.x + r.width, y: r.y } },
      { handle: 'e', p: { x: r.x + r.width, y: r.y + r.height / 2 } },
      { handle: 'se', p: { x: r.x + r.width, y: r.y + r.height } },
      { handle: 's', p: { x: r.x + r.width / 2, y: r.y + r.height } },
      { handle: 'sw', p: { x: r.x, y: r.y + r.height } },
      { handle: 'w', p: { x: r.x, y: r.y + r.height / 2 } },
    ];
    return map.map(({ handle, p }) => ({ handle, world: imageLocalToCanvas(view, p) }));
  }, [croppingImageId, cropDraft, project.images]);

  const hitHandle = useCallback(
    (world: Point): HandleDef | null => {
      const tol = 9 / zoom;
      for (let i = handles.length - 1; i >= 0; i -= 1) {
        if (distance(handles[i].world, world) <= tol) return handles[i];
      }
      return null;
    },
    [handles, zoom],
  );

  /* ---------------- 开始移动 ---------------- */
  const startMove = useCallback(
    (world: Point, ref: SelectionRef, additive: boolean, currentSelection: SelectionRef[]) => {
      let nextSelection = currentSelection;
      if (additive) {
        const exists = currentSelection.some((r) => r.id === ref.id);
        nextSelection = exists ? currentSelection.filter((r) => r.id !== ref.id) : [...currentSelection, ref];
        useUi.getState().setSelection(nextSelection);
        if (exists) return;
      } else if (!currentSelection.some((r) => r.id === ref.id)) {
        nextSelection = [ref];
        useUi.getState().setSelection(nextSelection);
      }

      const st = useProject.getState();
      const items: MoveItem[] = [];
      const baseRects: RectT[] = [];
      const movingIds: string[] = [];

      for (const r of nextSelection) {
        if (r.kind === 'image') {
          const img = st.project.images.find((i) => i.id === r.id);
          if (!img || img.locked) continue;
          items.push({ kind: 'image', id: img.id, x: img.x, y: img.y });
          baseRects.push(imageAABB(img));
          movingIds.push(img.id);
        } else if (r.kind === 'annotation') {
          const ann = st.project.annotations.find((a) => a.id === r.id);
          if (!ann || ann.locked) continue;
          const parent = st.project.images.find((i) => i.id === ann.parentImageId) ?? null;
          items.push({
            kind: 'annotation',
            id: ann.id,
            parentId: ann.parentImageId,
            grab: parent ? canvasToImageLocal(parent, world) : world,
            geometry: JSON.parse(JSON.stringify(ann.geometry)) as AnnotationGeometry,
          });
        } else {
          const m = st.project.magnifiers.find((x) => x.id === r.id);
          if (!m || m.locked) continue;
          items.push({ kind: 'magnifier', id: m.id, x: m.destination.x, y: m.destination.y });
        }
      }
      // 与移动中的图片绑定的放大引用一起移动，保持图版关系
      const movingImageIds = new Set(items.filter((i) => i.kind === 'image').map((i) => i.id));
      if (movingImageIds.size) {
        for (const m of st.project.magnifiers) {
          if (m.locked || !movingImageIds.has(m.sourceImageId)) continue;
          if (items.some((i) => i.kind === 'magnifier' && i.id === m.id)) continue;
          items.push({ kind: 'magnifier', id: m.id, x: m.destination.x, y: m.destination.y });
        }
      }
      if (!items.length) return;
      begin('移动对象');
      interaction.current = { type: 'move', start: world, items, moved: false, baseRects, movingIds };
    },
    [begin],
  );

  /* ---------------- 双击 ---------------- */
  const onDoubleClick = useCallback(
    (world: Point) => {
      const ui = useUi.getState();
      const st = useProject.getState();
      if (ui.tool === 'polygon' && ui.pendingPolygon) {
        finishPolygon();
        return;
      }
      if (ui.tool !== 'select') return;
      const ref = hitTest(st.project, world, { includeLocked: true });
      if (!ref) return;
      if (ref.kind === 'image') {
        const img = st.project.images.find((i) => i.id === ref.id);
        if (img && !img.locked) {
          ui.setSelection([{ id: img.id, kind: 'image' }]);
          ui.setCrop(img.id, { ...img.crop });
        }
      } else if (ref.kind === 'annotation') {
        const ann = st.project.annotations.find((a) => a.id === ref.id);
        if (ann?.type === 'text' && !ann.locked) {
          ui.setTool('select');
          ui.setSelection([{ id: ann.id, kind: 'annotation' }]);
          ui.setEditingText(ann.id, ann.text ?? '');
        }
      }
    },
    [finishPolygon],
  );

  /* ---------------- 按下 ---------------- */
  const handleDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const evt = e.evt;
      const isTouch = evt.type.startsWith('touch');
      const pointerType = 'pointerType' in evt ? (evt as PointerEvent).pointerType : '';
      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const world = screenToWorld(pos);
      const ui = useUi.getState();
      const st = useProject.getState();
      const inputType = isTouch
        ? touchSequence.current?.inputType ?? 'finger'
        : pointerType === 'pen'
          ? 'pen'
          : pointerType === 'touch'
            ? 'finger'
            : null;
      const fingerPanning = ui.stylusModeEnabled && ui.tool === 'select' && inputType === 'finger';

      if (
        evt.button === 1 ||
        (isTouch && ui.tool === 'hand') ||
        fingerPanning ||
        (evt.button === 0 && (ui.spacePressed || ui.tool === 'hand'))
      ) {
        interaction.current = {
          type: 'pan',
          startScreen: pos,
          startPan: { x: st.project.canvas.panX, y: st.project.canvas.panY },
        };
        setPanning(true);
        return;
      }
      if (!isTouch && evt.button !== 0) return;

      // 自己实现双击判定：Konva 的 dblclick 是全局计时器，会在两次快速单击时误触发
      if (ui.tool === 'select' || ui.tool === 'polygon') {
        const now = performance.now();
        const prev = lastClick.current;
        const isDouble =
          !!prev && now - prev.t < 340 && Math.abs(pos.x - prev.x) < 7 && Math.abs(pos.y - prev.y) < 7;
        lastClick.current = isDouble ? null : { t: now, x: pos.x, y: pos.y };
        if (isDouble && !evt.shiftKey) {
          onDoubleClick(world);
          return;
        }
      } else {
        lastClick.current = null;
      }

      // 裁切模式
      if (ui.croppingImageId && ui.cropDraft) {
        const tol = 11 / zoom;
        const img = st.project.images.find((i) => i.id === ui.croppingImageId);
        for (const h of cropHandles) {
          if (distance(h.world, world) <= tol) {
            interaction.current = {
              type: 'crop',
              imageId: ui.croppingImageId,
              handle: h.handle,
              base: { ...ui.cropDraft },
              grab: { x: 0, y: 0 },
            };
            return;
          }
        }
        if (img) {
          const view = cropViewOf(img, ui.cropDraft);
          const p = canvasToImageLocal(view, world);
          const r = ui.cropDraft;
          if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) {
            interaction.current = {
              type: 'crop',
              imageId: ui.croppingImageId,
              handle: 'move',
              base: { ...ui.cropDraft },
              grab: p,
            };
            return;
          }
        }
        ui.setCrop(null, null);
        return;
      }

      if (ui.tool === 'select') {
        const h = hitHandle(world);
        if (h) {
          const ann = st.project.annotations.find((a) => a.id === h.targetId);
          const parent = ann ? st.project.images.find((i) => i.id === ann.parentImageId) ?? null : null;
          if (h.kind === 'image-corner' && h.corner) {
            const img = st.project.images.find((i) => i.id === h.targetId);
            if (img) {
              begin('缩放图片');
              interaction.current = { type: 'imageResize', id: img.id, corner: h.corner, base: { ...img } };
            }
          } else if ((h.kind === 'ann-corner' || h.kind === 'ann-edge') && ann?.geometry.rect) {
            begin('调整标注');
            interaction.current = { type: 'annRect', id: ann.id, handle: h, base: { ...ann.geometry.rect }, parent };
          } else if (h.kind === 'vertex' && ann?.geometry.points) {
            begin('编辑节点');
            interaction.current = {
              type: 'vertex',
              id: ann.id,
              index: h.index ?? 0,
              base: ann.geometry.points.map((p) => ({ ...p })),
              parent,
            };
          } else if (h.kind === 'freehand-corner' && h.corner && ann?.geometry.rect && ann.geometry.points) {
            begin('缩放轮廓');
            interaction.current = {
              type: 'freehandResize',
              id: ann.id,
              corner: h.corner,
              base: { ...ann.geometry.rect },
              points: ann.geometry.points.map((p) => ({ ...p })),
              parent,
            };
          } else if (h.kind === 'magnifier-radius') {
            begin('调整取景范围');
            interaction.current = { type: 'magnifierRadius', id: h.targetId };
          } else if (h.kind === 'magnifier-roi-radius') {
            begin('调整圈选区');
            interaction.current = { type: 'magnifierRoiRadius', id: h.targetId };
          }
          return;
        }

        const ref = hitTest(st.project, world, { includeLocked: true });
        if (ref) {
          startMove(world, ref, evt.shiftKey, ui.selection);
          return;
        }
        if (!evt.shiftKey) ui.setSelection([]);
        ui.setPendingPolygon(null);
        interaction.current = { type: 'marquee', start: world, current: world, additive: evt.shiftKey };
        setMarquee({ x: world.x, y: world.y, width: 0, height: 0 });
        return;
      }

      if (ui.tool === 'text') {
        // 在 mouseup 时创建，避免浏览器的 mousedown 焦点修正抢走输入框焦点
        interaction.current = { type: 'textPlace', at: world };
        return;
      }

      if (ui.tool === 'polygon') {
        const parent = imageUnderPoint(st.project, world);
        const local = parent ? canvasToImageLocal(parent, world) : world;
        const existing = ui.pendingPolygon;
        const hostId = parent?.id ?? null;
        if (existing && existing.parentImageId === hostId) {
          ui.setPendingPolygon({ ...existing, points: [...existing.points, local] });
        } else {
          ui.setPendingPolygon({ parentImageId: hostId, points: [local] });
        }
        return;
      }

      if (ui.tool === 'magnifier') {
        const img = imageUnderPoint(st.project, world);
        if (!img) {
          ui.toast('请在图片上拖出要放大的圆形区域', 'info');
          return;
        }
        interaction.current = { type: 'magnifierDraw', imageId: img.id, start: world };
        setDraft({ kind: 'magnifier', start: world, current: world });
        return;
      }

      if (ui.tool === 'freehand') {
        const parent = imageUnderPoint(st.project, world);
        interaction.current = { type: 'freehandDraw', parentImageId: parent?.id ?? null };
        setDraft({ kind: 'freehand', points: [world] });
        return;
      }

      const parent = imageUnderPoint(st.project, world);
      interaction.current = { type: 'draw', tool: ui.tool, start: world, parentImageId: parent?.id ?? null };
      if (ui.tool === 'rect') setDraft({ kind: 'rect', start: world, current: world });
      else if (ui.tool === 'ellipse') setDraft({ kind: 'ellipse', start: world, current: world });
      else if (ui.tool === 'line') setDraft({ kind: 'line', start: world, current: world });
      else if (ui.tool === 'arrow') setDraft({ kind: 'arrow', start: world, current: world });
    },
    [begin, cropHandles, hitHandle, onDoubleClick, screenToWorld, startMove, zoom],
  );

  /* ---------------- 移动 ---------------- */
  const handleMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const it = interaction.current;
      if (it.type === 'idle') {
        if (useUi.getState().tool === 'polygon' && useUi.getState().pendingPolygon) {
          const w = pointerWorld();
          setPolyCursor((prev) => (prev && w && Math.abs(prev.x - w.x) < 0.5 && Math.abs(prev.y - w.y) < 0.5 ? prev : w));
        }
        return;
      }
      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const world = screenToWorld(pos);
      const st = useProject.getState();

      switch (it.type) {
        case 'pan':
          st.setView({
            panX: it.startPan.x + (pos.x - it.startScreen.x),
            panY: it.startPan.y + (pos.y - it.startScreen.y),
          });
          break;

        case 'marquee': {
          it.current = world;
          setMarquee({ x: it.start.x, y: it.start.y, width: world.x - it.start.x, height: world.y - it.start.y });
          break;
        }

        case 'move': {
          let dx = world.x - it.start.x;
          let dy = world.y - it.start.y;
          const guideList: GuideLine[] = [];
          if (it.movingIds.length && it.baseRects.length) {
            const others: RectT[] = [];
            for (const img of st.project.images) {
              if (it.movingIds.includes(img.id)) continue;
              others.push(imageAABB(img));
            }
            const tol = SNAP_TOLERANCE / zoom;
            const primary = it.baseRects[0];
            let bestX = Infinity;
            let bestY = Infinity;
            let gx: GuideLine | null = null;
            let gy: GuideLine | null = null;
            for (const o of others) {
              const tx = [primary.x, primary.x + primary.width / 2, primary.x + primary.width];
              const ox = [o.x, o.x + o.width / 2, o.x + o.width];
              for (const a of tx) {
                for (const b of ox) {
                  const d = b - a;
                  if (Math.abs(d) <= tol && Math.abs(d) < Math.abs(bestX)) {
                    bestX = d;
                    gx = {
                      axis: 'x',
                      position: b,
                      from: Math.min(primary.y + dy, o.y) - 26,
                      to: Math.max(primary.y + primary.height + dy, o.y + o.height) + 26,
                    };
                  }
                }
              }
              const ty = [primary.y, primary.y + primary.height / 2, primary.y + primary.height];
              const oy = [o.y, o.y + o.height / 2, o.y + o.height];
              for (const a of ty) {
                for (const b of oy) {
                  const d = b - a;
                  if (Math.abs(d) <= tol && Math.abs(d) < Math.abs(bestY)) {
                    bestY = d;
                    gy = {
                      axis: 'y',
                      position: b,
                      from: Math.min(primary.x + dx, o.x) - 26,
                      to: Math.max(primary.x + primary.width + dx, o.x + o.width) + 26,
                    };
                  }
                }
              }
            }
            if (gx) {
              dx += bestX;
              guideList.push(gx);
            }
            if (gy) {
              dy += bestY;
              guideList.push(gy);
            }
          }
          setGuides(guideList);
          st.apply((d) => {
            for (const item of it.items) {
              if (item.kind === 'image') {
                const img = d.images.find((i) => i.id === item.id);
                if (img) {
                  img.x = item.x + dx;
                  img.y = item.y + dy;
                }
              } else if (item.kind === 'magnifier') {
                const m = d.magnifiers.find((x) => x.id === item.id);
                if (m) {
                  m.destination.x = item.x + dx;
                  m.destination.y = item.y + dy;
                }
              } else {
                const ann = d.annotations.find((a) => a.id === item.id);
                if (!ann) continue;
                const parent = d.images.find((i) => i.id === item.parentId) ?? null;
                const now = parent ? canvasToImageLocal(parent, world) : world;
                ann.geometry = shiftGeometry(item.geometry, now.x - item.grab.x, now.y - item.grab.y);
              }
            }
          });
          it.moved = true;
          break;
        }

        case 'imageResize': {
          const box = resizeImageBox(it.base, it.corner, world, !e.evt.altKey);
          st.apply((d) => {
            const img = d.images.find((i) => i.id === it.id);
            if (!img) return;
            img.x = box.x;
            img.y = box.y;
            img.width = box.width;
            img.height = box.height;
          });
          break;
        }

        case 'annRect': {
          const p = it.parent ? canvasToImageLocal(it.parent, world) : world;
          const b = it.base;
          let { x, y, width, height } = b;
          const corner = it.handle.corner;
          const edge = it.handle.edge;
          if (corner === 'nw' || edge === 'w') {
            const nx = Math.min(p.x, b.x + b.width - 3);
            width = b.x + b.width - nx;
            x = nx;
          }
          if (corner === 'ne' || edge === 'e') width = Math.max(3, p.x - b.x);
          if (corner === 'sw' || edge === 's') height = Math.max(3, p.y - b.y);
          if (corner === 'nw' || corner === 'ne' || edge === 'n') {
            const ny = Math.min(p.y, b.y + b.height - 3);
            height = b.y + b.height - ny;
            y = ny;
          }
          if (e.evt.shiftKey && corner) {
            const k = Math.max(width / b.width, height / b.height);
            const w2 = b.width * k;
            const h2 = b.height * k;
            if (corner === 'nw') {
              x = b.x + b.width - w2;
              y = b.y + b.height - h2;
            } else if (corner === 'ne') {
              y = b.y + b.height - h2;
            } else if (corner === 'sw') {
              x = b.x + b.width - w2;
            }
            width = w2;
            height = h2;
          }
          st.apply((d) => {
            const ann = d.annotations.find((a) => a.id === it.id);
            if (ann) ann.geometry.rect = { x, y, width, height };
          });
          break;
        }

        case 'freehandResize': {
          const p = it.parent ? canvasToImageLocal(it.parent, world) : world;
          const b = it.base;
          const sx = it.corner === 'ne' || it.corner === 'se' ? 1 : -1;
          const sy = it.corner === 'sw' || it.corner === 'se' ? 1 : -1;
          const anchor =
            it.corner === 'se'
              ? { x: b.x, y: b.y }
              : it.corner === 'nw'
                ? { x: b.x + b.width, y: b.y + b.height }
                : it.corner === 'ne'
                  ? { x: b.x, y: b.y + b.height }
                  : { x: b.x + b.width, y: b.y };
          const w = Math.max(3, sx * (p.x - anchor.x));
          const h = Math.max(3, sy * (p.y - anchor.y));
          const target: RectT = {
            x: sx > 0 ? anchor.x : anchor.x - w,
            y: sy > 0 ? anchor.y : anchor.y - h,
            width: w,
            height: h,
          };
          st.apply((d) => {
            const ann = d.annotations.find((a) => a.id === it.id);
            if (!ann) return;
            ann.geometry.points = scalePoints(it.points, b, target);
            ann.geometry.rect = target;
          });
          break;
        }

        case 'vertex': {
          const p = it.parent ? canvasToImageLocal(it.parent, world) : world;
          st.apply((d) => {
            const ann = d.annotations.find((a) => a.id === it.id);
            if (!ann?.geometry.points) return;
            const pts = it.base.map((q) => ({ ...q }));
            pts[it.index] = p;
            ann.geometry.points = pts;
          });
          break;
        }

        case 'magnifierRadius':
          st.apply((d) => {
            const m = d.magnifiers.find((x) => x.id === it.id);
            if (!m) return;
            const src = d.images.find((i) => i.id === m.sourceImageId);
            if (!src) return;
            // 拖投射圆 = 改取景范围：由投射半径反推 ROI 半径，倍率不变
            const target = clamp(distance(m.destination, world), 8, 8000);
            const center = magnifierRegionCenter(m);
            const next = clamp(
              sourceRadiusFromProjection(m, src, target),
              MIN_SOURCE_RADIUS,
              maxSourceRadiusAt(center, src),
            );
            setRegionRadius(m, next);
          });
          break;

        case 'magnifierRoiRadius':
          st.apply((d) => {
            const m = d.magnifiers.find((x) => x.id === it.id);
            if (!m) return;
            const src = d.images.find((i) => i.id === m.sourceImageId);
            if (!src) return;
            const center = magnifierRegionCenter(m);
            const local = canvasToImageLocal(src, world);
            const next = clamp(
              distance(local, center),
              MIN_SOURCE_RADIUS,
              maxSourceRadiusAt(center, src),
            );
            setRegionRadius(m, next);
          });
          break;

        case 'draw':
          setDraft((prev) => {
            if (!prev) return prev;
            if (prev.kind === 'rect' || prev.kind === 'ellipse' || prev.kind === 'line' || prev.kind === 'arrow') {
              const current = e.evt.shiftKey && prev.kind === 'ellipse' ? forceCircle(prev.start, world) : world;
              return { ...prev, current };
            }
            return prev;
          });
          break;

        case 'freehandDraw':
          setDraft((prev) => {
            if (!prev || prev.kind !== 'freehand') return prev;
            const last = prev.points[prev.points.length - 1];
            if (distance(last, world) < 1.2 / zoom) return prev;
            return { ...prev, points: [...prev.points, world] };
          });
          break;

        case 'magnifierDraw':
          setDraft((prev) => (prev && prev.kind === 'magnifier' ? { ...prev, current: forceCircle(prev.start, world) } : prev));
          break;

        case 'crop': {
          const img = st.project.images.find((i) => i.id === it.imageId);
          if (!img) break;
          const view = cropViewOf(img, it.base);
          const p = canvasToImageLocal(view, world);
          const b = it.base;
          let next: RectT = { ...b };
          if (it.handle === 'move') {
            const dx = p.x - it.grab.x;
            const dy = p.y - it.grab.y;
            next.x = clamp(b.x + dx, 0, img.originalWidth - b.width);
            next.y = clamp(b.y + dy, 0, img.originalHeight - b.height);
          } else {
            const h = it.handle;
            const anchor = cropHandleAnchor(h);
            const ax = b.x + b.width * anchor.ax;
            const ay = b.y + b.height * anchor.ay;
            let left = b.x;
            let top = b.y;
            let right = b.x + b.width;
            let bottom = b.y + b.height;
            if (h === 'nw' || h === 'w' || h === 'sw') left = Math.min(p.x, right - 16);
            if (h === 'ne' || h === 'e' || h === 'se') right = Math.max(p.x, left + 16);
            if (h === 'nw' || h === 'n' || h === 'ne') top = Math.min(p.y, bottom - 16);
            if (h === 'sw' || h === 's' || h === 'se') bottom = Math.max(p.y, top + 16);
            left = clamp(left, 0, img.originalWidth);
            right = clamp(right, 0, img.originalWidth);
            top = clamp(top, 0, img.originalHeight);
            bottom = clamp(bottom, 0, img.originalHeight);
            void ax;
            void ay;
            next = { x: left, y: top, width: Math.max(16, right - left), height: Math.max(16, bottom - top) };
          }
          useUi.getState().setCropDraft(next);
          break;
        }

        default:
          break;
      }
    },
    [pointerWorld, screenToWorld, zoom],
  );

  /* ---------------- 抬起 ---------------- */
  const finishInteraction = useCallback(
    (endPoint?: Point) => {
      const it = interaction.current;
      if (it.type === 'idle') return;
      const st = useProject.getState();
      interaction.current = { type: 'idle' };
      setPanning(false);
      setGuides([]);

      const commitFreehand = (parentImageId: string | null, d: Draft) => {
        if (d.kind !== 'freehand' || d.points.length < 3) return;
        const parent = st.project.images.find((i) => i.id === parentImageId) ?? null;
        const localPts = d.points.map((p) => (parent ? canvasToImageLocal(parent, p) : p));
        const tolerance = 0.6 / (parent ? imageDisplayScale(parent) : 1);
        const smooth = smoothPolyline(simplifyPolyline(localPts, tolerance), 2);
        const ann = createAnnotation(
          'freehand',
          parentImageId,
          { ...useStyle.getState(), ...scaledStyle(useStyle.getState()) },
          nextAnnotationZ(),
        );
        ann.geometry = { points: smooth, rect: boundsOf(smooth) };
        st.applyWithHistory('自由轮廓', (dd) => {
          dd.annotations.push(ann);
        });
        useUi.getState().setSelection([{ id: ann.id, kind: 'annotation' }]);
      };

      switch (it.type) {
        case 'textPlace': {
          const stt = useProject.getState();
          const parent = imageUnderPoint(stt.project, it.at);
          const rawStyle = useStyle.getState();
          const ann = createAnnotation('text', parent?.id ?? null, { ...rawStyle, ...scaledStyle(rawStyle) }, nextAnnotationZ());
          const local = parent ? canvasToImageLocal(parent, it.at) : it.at;
          ann.geometry.position = { x: local.x, y: local.y };
          ann.text = '';
          stt.applyWithHistory('添加文字', (d) => {
            d.annotations.push(ann);
          });
          const ui = useUi.getState();
          ui.setSelection([{ id: ann.id, kind: 'annotation' }]);
          ui.setTool('select');
          ui.setEditingText(ann.id, '');
          break;
        }

        case 'marquee': {
          setMarquee(null);
          const box = normRect(it.start, endPoint ?? it.current);
          if (box.width < 3 && box.height < 3) break;
          const picked: SelectionRef[] = [];
          for (const img of st.project.images) {
            if (!img.visible) continue;
            if (rectsIntersect(box, imageAABB(img))) picked.push({ id: img.id, kind: 'image' });
          }
          for (const ann of st.project.annotations) {
            const parent = st.project.images.find((i) => i.id === ann.parentImageId) ?? null;
            if (!parent && rectsIntersect(box, annWorldRect(ann, null))) picked.push({ id: ann.id, kind: 'annotation' });
          }
          const ui = useUi.getState();
          ui.setSelection(
            it.additive
              ? [...ui.selection, ...picked.filter((p) => !ui.selection.some((s) => s.id === p.id))]
              : picked,
          );
          break;
        }

        case 'move':
          endHistory();
          break;

        case 'draw': {
          const d = draft;
          setDraft(null);
          if (d && (d.kind === 'rect' || d.kind === 'ellipse' || d.kind === 'line' || d.kind === 'arrow')) {
            commitDragDraw(it.tool, endPoint ? { ...d, current: endPoint } : d, it.parentImageId);
          }
          break;
        }

        case 'freehandDraw': {
          const d = draft;
          setDraft(null);
          if (d?.kind === 'freehand') {
            const last = d.points[d.points.length - 1];
            const points = endPoint && last && distance(last, endPoint) > 0.05 ? [...d.points, endPoint] : d.points;
            commitFreehand(it.parentImageId, { ...d, points });
          }
          break;
        }

        case 'magnifierDraw': {
          const d = draft?.kind === 'magnifier' && endPoint ? { ...draft, current: endPoint } : draft;
          setDraft(null);
          if (!d || d.kind !== 'magnifier') break;
          const img = st.project.images.find((i) => i.id === it.imageId);
          if (!img) break;
          const a = canvasToImageLocal(img, d.start);
          const b = canvasToImageLocal(img, d.current);
          const cx = (a.x + b.x) / 2;
          const cy = (a.y + b.y) / 2;
          const center = { x: cx, y: cy };
          // 与拖拽时显示的虚线圆一致：半径 = 方框边长的一半
          const half = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / 2;
          const r = clamp(half, MIN_SOURCE_RADIUS, maxSourceRadiusAt(center, img));
          const sourceRegion: RectT = { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
          const st2 = useStyle.getState();
          const mag = createMagnifier(
            img.id,
            sourceRegion,
            { x: d.current.x, y: d.current.y, radius: 1 },
            nextMagnifierZ(),
          );
          mag.zoom = st2.magnifierZoom;
          mag.roiColor = st2.magnifierRoiColor;
          mag.borderColor = st2.magnifierBorderColor;
          mag.connectorVisible = st2.magnifierConnector;
          mag.borderWidth = clamp(2 * newObjectScale(), 2, 5);
          // 投射圆 = 圈选区 × 倍率，落在圈选区外侧
          const radius = resolveMagnifier(mag, img)?.radius ?? r;
          const dir = Math.atan2(d.current.y - d.start.y, d.current.x - d.start.x);
          const gap = radius + Math.max(28, radius * 0.3);
          mag.destination = {
            x: d.current.x + Math.cos(dir) * gap,
            y: d.current.y + Math.sin(dir) * gap,
            radius,
          };
          st.applyWithHistory('创建圆形放大引用', (dd) => {
            dd.magnifiers.push(mag);
          });
          const ui = useUi.getState();
          ui.setSelection([{ id: mag.id, kind: 'magnifier' }]);
          ui.setTool('select');
          break;
        }

        default:
          endHistory();
          break;
      }
    },
    [commitDragDraw, draft, endHistory],
  );

  const handleUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const pos = stageRef.current?.getPointerPosition();
      if (pos) {
        handleMove(e);
        finishInteraction(screenToWorld(pos));
      } else {
        finishInteraction();
      }
    },
    [finishInteraction, handleMove, screenToWorld],
  );

  const clearTouchTimer = useCallback(() => {
    const sequence = touchSequence.current;
    if (sequence) window.clearTimeout(sequence.timer);
  }, []);

  useEffect(() => {
    const container = stageRef.current?.container();
    if (!container) return;
    const rememberPointerType = (event: Event) => {
      const pointer = event as PointerEvent;
      if (pointer.pointerType !== 'touch' && pointer.pointerType !== 'pen') return;
      recentPointerInput.current = {
        pointerType: pointer.pointerType,
        pointerId: pointer.pointerId,
        clientX: pointer.clientX,
        clientY: pointer.clientY,
        time: performance.now(),
      };
    };
    const forgetPointerType = (event: Event) => {
      const pointer = event as PointerEvent;
      if (recentPointerInput.current?.pointerId === pointer.pointerId) recentPointerInput.current = null;
    };
    container.addEventListener('pointerdown', rememberPointerType, true);
    window.addEventListener('pointerup', forgetPointerType, true);
    window.addEventListener('pointercancel', forgetPointerType, true);
    return () => {
      container.removeEventListener('pointerdown', rememberPointerType, true);
      window.removeEventListener('pointerup', forgetPointerType, true);
      window.removeEventListener('pointercancel', forgetPointerType, true);
    };
  }, []);

  const handleTouchStart = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const evt = e.evt;
    evt.preventDefault();
    stage.setPointersPositions(evt);

    const rect = stage.container().getBoundingClientRect();
    const metrics = touchMetrics(evt, rect, stage);
    if (metrics) {
      clearTouchTimer();
      touchSequence.current = null;
      if (interaction.current.type !== 'idle') finishInteraction();
      interaction.current = { type: 'idle' };
      setDraft(null);
      setMarquee(null);
      setPanning(false);
      pinchGesture.current = metrics;
      return;
    }

    const touch = evt.touches[0];
    if (!touch || pinchGesture.current) return;
    const inputType = touchInputType(touch, recentPointerInput.current);
    const startEvent = e;
    const startClient = { x: touch.clientX, y: touch.clientY };
    const timer = window.setTimeout(() => {
      const current = touchSequence.current;
      if (!current || current.active) return;
      current.longPressed = true;
      stage.setPointersPositions(startEvent.evt);
      const contextEvent = {
        evt: {
          preventDefault: () => undefined,
          clientX: startClient.x,
          clientY: startClient.y,
        },
      } as unknown as Konva.KonvaEventObject<PointerEvent>;
      contextMenuRef.current?.(contextEvent);
    }, 520);
    touchSequence.current = { startEvent, startClient, inputType, active: false, longPressed: false, timer };
  }, [clearTouchTimer, finishInteraction]);

  const handleTouchMove = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const evt = e.evt;
    evt.preventDefault();
    stage.setPointersPositions(evt);
    const rect = stage.container().getBoundingClientRect();
    const metrics = touchMetrics(evt, rect, stage);

    if (metrics) {
      const previous = pinchGesture.current;
      if (!previous) {
        clearTouchTimer();
        touchSequence.current = null;
        if (interaction.current.type !== 'idle') finishInteraction();
        interaction.current = { type: 'idle' };
        setDraft(null);
        setMarquee(null);
        setPanning(false);
        pinchGesture.current = metrics;
        return;
      }
      const dx = metrics.center.x - previous.center.x;
      const dy = metrics.center.y - previous.center.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        const view = useProject.getState().project.canvas;
        useProject.getState().setView({ panX: view.panX + dx, panY: view.panY + dy });
      }
      zoomAt(metrics.center, metrics.distance / previous.distance);
      pinchGesture.current = metrics;
      return;
    }

    if (pinchGesture.current) return;
    const sequence = touchSequence.current;
    const touch = evt.touches[0];
    if (!sequence || !touch || sequence.longPressed) return;
    if (touchInputType(touch, recentPointerInput.current) === 'pen') sequence.inputType = 'pen';
    const delta = Math.hypot(touch.clientX - sequence.startClient.x, touch.clientY - sequence.startClient.y);
    if (!sequence.active && delta > 9) {
      window.clearTimeout(sequence.timer);
      sequence.active = true;
      stage.setPointersPositions(sequence.startEvent.evt);
      handleDown(sequence.startEvent as unknown as Konva.KonvaEventObject<MouseEvent>);
      stage.setPointersPositions(evt);
    }
    if (sequence.active) handleMove(e as unknown as Konva.KonvaEventObject<MouseEvent>);
  }, [clearTouchTimer, finishInteraction, handleDown, handleMove, zoomAt]);

  const handleTouchEnd = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    const stage = stageRef.current;
    const changed = e.evt.changedTouches[0];
    if (stage && changed) {
      stage.setPointersPositions({
        clientX: changed.clientX,
        clientY: changed.clientY,
        pointerId: changed.identifier,
      } as PointerEvent);
    }
    if (e.evt.touches.length === 0) {
      pinchGesture.current = null;
    }
    if (pinchGesture.current) return;
    const sequence = touchSequence.current;
    if (!sequence) return;
    window.clearTimeout(sequence.timer);
    if (!sequence.longPressed) {
      if (!sequence.active) {
        stage?.setPointersPositions(sequence.startEvent.evt);
        handleDown(sequence.startEvent as unknown as Konva.KonvaEventObject<MouseEvent>);
        if (stage && changed) {
          stage.setPointersPositions({
            clientX: changed.clientX,
            clientY: changed.clientY,
            pointerId: changed.identifier,
          } as PointerEvent);
        }
      }
      handleUp(e as unknown as Konva.KonvaEventObject<MouseEvent>);
    }
    touchSequence.current = null;
  }, [handleDown, handleUp]);

  const handleTouchCancel = useCallback(() => {
    clearTouchTimer();
    touchSequence.current = null;
    pinchGesture.current = null;
    finishInteraction();
  }, [clearTouchTimer, finishInteraction]);

  /** 鼠标在画布外抬起时也必须结束手势，否则会卡在拖拽状态 */
  useEffect(() => {
    const onWindowUp = () => finishInteraction();
    const onBlur = () => finishInteraction();
    window.addEventListener('mouseup', onWindowUp);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mouseup', onWindowUp);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [finishInteraction]);

  /* ---------------- 右键 ---------------- */
  const handleContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const world = screenToWorld(pos);
      const ui = useUi.getState();
      const st = useProject.getState();

      if (ui.pendingPolygon) {
        ui.openContextMenu(e.evt.clientX, e.evt.clientY, [
          { id: 'finishPolygon', label: '闭合多边形', shortcut: '双击' },
          { id: 'cancelPolygon', label: '取消绘制', shortcut: 'Esc' },
        ]);
        return;
      }

      const ref = hitTest(st.project, world, { includeLocked: true });
      if (!ref) {
        ui.setSelection([]);
        ui.openContextMenu(e.evt.clientX, e.evt.clientY, [
          { id: 'fit', label: '适应全部', shortcut: `${MOD}0` },
          { id: 'zoom100', label: '实际大小 100%', shortcut: `${MOD}1` },
          { id: 'sep1', label: '', separator: true },
          { id: 'paste', label: '粘贴', shortcut: `${MOD}V`, disabled: !hasClipboard() },
        ]);
        return;
      }

      if (!ui.selection.some((s) => s.id === ref.id)) ui.setSelection([ref]);
      const items: ContextMenuItem[] = [];
      if (ref.kind === 'image') {
        const img = st.project.images.find((i) => i.id === ref.id);
        items.push(
          { id: 'crop', label: '裁切…', shortcut: '双击' },
          { id: 'rotate', label: '旋转 90°' },
          { id: 'front', label: '置于顶层' },
          { id: 'back', label: '置于底层' },
          { id: 'sep1', label: '', separator: true },
          { id: 'toggleAnn', label: img?.annotationsVisible ? '隐藏该图标注' : '显示该图标注' },
          { id: 'dup', label: '复制并偏移', shortcut: `${MOD}D` },
          { id: 'lock', label: img?.locked ? '解锁' : '锁定' },
          { id: 'sep2', label: '', separator: true },
          { id: 'del', label: '删除', shortcut: '⌫', danger: true },
        );
      } else if (ref.kind === 'annotation') {
        const ann = st.project.annotations.find((a) => a.id === ref.id);
        items.push(
          { id: 'front', label: '置于顶层' },
          { id: 'back', label: '置于底层' },
          { id: 'sep1', label: '', separator: true },
          { id: 'dup', label: '复制并偏移', shortcut: `${MOD}D` },
          { id: 'lock', label: ann?.locked ? '解锁' : '锁定' },
          { id: 'sep2', label: '', separator: true },
          { id: 'del', label: '删除', shortcut: '⌫', danger: true },
        );
      } else {
        const m = st.project.magnifiers.find((x) => x.id === ref.id);
        items.push(
          { id: 'front', label: '置于顶层' },
          { id: 'back', label: '置于底层' },
          { id: 'sep1', label: '', separator: true },
          { id: 'connector', label: m?.connectorVisible ? '隐藏连接线' : '显示连接线' },
          { id: 'dup', label: '复制并偏移', shortcut: `${MOD}D` },
          { id: 'sep2', label: '', separator: true },
          { id: 'del', label: '删除', shortcut: '⌫', danger: true },
        );
      }
      ui.openContextMenu(e.evt.clientX, e.evt.clientY, items, ref);
    },
    [screenToWorld],
  );
  contextMenuRef.current = handleContextMenu;

  /* ---------------- 键盘 ---------------- */
  const confirmCrop = useCallback(() => {
    const ui = useUi.getState();
    const { croppingImageId, cropDraft } = ui;
    if (croppingImageId && cropDraft) {
      const img = useProject.getState().project.images.find((item) => item.id === croppingImageId);
      if (img) {
        useProject.getState().applyWithHistory('裁切图片', (draft) => {
          const target = draft.images.find((item) => item.id === img.id);
          if (target) target.crop = { ...cropDraft };
        });
      }
    }
    ui.setCrop(null, null);
  }, []);

  const cancelCrop = useCallback(() => {
    useUi.getState().setCrop(null, null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const ui = useUi.getState();
      if (typing) return;
      if (e.key === 'Escape') {
        if (ui.editingTextId) {
          commitText();
          return;
        }
        if (ui.croppingImageId) {
          cancelCrop();
          return;
        }
        if (ui.pendingPolygon) {
          ui.setPendingPolygon(null);
          setDraft(null);
          setPolyCursor(null);
          return;
        }
        if (ui.contextMenu) {
          ui.closeContextMenu();
          return;
        }
        if (ui.selection.length) ui.setSelection([]);
        return;
      }
      if (e.key === 'Enter') {
        if (ui.croppingImageId && ui.cropDraft) {
          confirmCrop();
          return;
        }
        if (ui.pendingPolygon) finishPolygon();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelCrop, commitText, confirmCrop, finishPolygon]);

  useEffect(() => {
    const onFinish = () => finishPolygon();
    const onCancel = () => {
      useUi.getState().setPendingPolygon(null);
      setDraft(null);
      setPolyCursor(null);
    };
    window.addEventListener('pathlab:finish-polygon', onFinish);
    window.addEventListener('pathlab:cancel-polygon', onCancel);
    return () => {
      window.removeEventListener('pathlab:finish-polygon', onFinish);
      window.removeEventListener('pathlab:cancel-polygon', onCancel);
    };
  }, [finishPolygon]);

  /* ---------------- 拖放 ---------------- */
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name));
    if (files.length) window.dispatchEvent(new CustomEvent('pathlab:import-files', { detail: files }));
  }, []);

  /* ---------------- 渲染数据 ---------------- */
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

  const cropImage = croppingImageId
    ? project.images.find((i) => i.id === croppingImageId) ?? null
    : null;

  /** 当前选中的放大引用：其圈选区需要高亮，方便确认"哪一圈对应哪个投射圆" */
  const emphasizedRoiIds = useMemo(
    () => new Set(selection.filter((s) => s.kind === 'magnifier').map((s) => s.id)),
    [selection],
  );

  // 套索顶点以源图像素存储，预览必须换算回世界坐标，否则会整体偏移
  const activeDraft: Draft | null = useMemo(() => {
    if (draft) return draft;
    if (!pendingPolygon) return null;
    const parent = pendingPolygon.parentImageId
      ? project.images.find((i) => i.id === pendingPolygon.parentImageId) ?? null
      : null;
    return {
      kind: 'polygon',
      points: pendingPolygon.points.map((p) => (parent ? imageLocalToCanvas(parent, p) : p)),
      current: polyCursor,
    };
  }, [draft, pendingPolygon, polyCursor, project.images]);

  // 仅开发环境：把覆盖层草稿暴露给自动化验收脚本，用于断言预览几何
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__pathlabDraft = activeDraft;
  }, [activeDraft]);

  return (
    <div
      ref={hostRef}
      className={`canvas-host ${panning ? 'cursor-grabbing' : spacePressed || tool === 'hand' ? 'cursor-grab' : tool === 'select' ? 'cursor-default' : 'cursor-crosshair'} ${
        dropping ? 'dropping' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
      onContextMenu={(e) => {
        if (e.target === hostRef.current) e.preventDefault();
      }}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={canvasView.panX}
        y={canvasView.panY}
        scaleX={zoom}
        scaleY={zoom}
        onWheel={handleWheel}
        onMouseDown={handleDown}
        onMouseMove={handleMove}
        onMouseUp={handleUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onContextMenu={handleContextMenu}
      >
        <Layer listening={false}>
          {imageOrder.map((img) => (
            <ImageNode
              key={img.id}
              img={img}
              annotations={byImage.get(img.id) ?? EMPTY_ANNOTATIONS}
              rois={roisByImage.get(img.id) ?? EMPTY_MAGNIFIERS}
              editingTextId={editingTextId}
              cropDraft={croppingImageId === img.id ? cropDraft : null}
              hideAnnotations
              showRois={!croppingImageId}
              canvasZoom={zoom}
              emphasizedRoiIds={emphasizedRoiIds}
            />
          ))}
          {magnifierOrder.map((m) => (
            <MagnifierNode key={m.id} magnifier={m} source={project.images.find((i) => i.id === m.sourceImageId) ?? null} />
          ))}
          <AnnotationsOverlay
            project={project}
            editingTextId={editingTextId}
            hideHostedAnnotations={!annotationsGloballyVisible}
            hiddenImageId={croppingImageId}
          />
        </Layer>
        <Layer listening={false}>
          <OverlayLayer
            project={project}
            selection={selection}
            handles={handles}
            zoom={zoom}
            draft={activeDraft}
            marquee={marquee}
            guides={guides}
            strokeColor={style.stroke}
            strokeWidth={style.strokeWidth}
            dash={style.dash}
            cropFrame={croppingImageId ? cropDraft : null}
            cropImage={cropImage}
            hideChrome={Boolean(croppingImageId)}
          />
        </Layer>
      </Stage>

      {!project.images.length && (
        <div className="empty-guide">
          <button
            type="button"
            className="empty-import-button"
            aria-label="导入图片"
            title="导入图片"
            onClick={pickImageFiles}
          >
            <Plus size={92} strokeWidth={1.15} aria-hidden="true" />
          </button>
        </div>
      )}

      {dropping && <div className="drop-veil" />}

      {project.images.length > 0 && !croppingImageId && (
        <button
          type="button"
          className="canvas-badge"
          data-tip="点击适应全部 ⌘0"
          data-tip-side="left"
          aria-label={`当前缩放 ${Math.round(zoom * 100)}%，点击适应全部`}
          onClick={() => viewCommands.fit()}
        >
          {Math.round(zoom * 100)}%
        </button>
      )}

      {editingTextId && <TextEditOverlay onCommit={commitText} worldToScreen={worldToScreen} zoom={zoom} />}

      <SelectionToolbar />

      {cropImage && cropDraft && (
        <div className="crop-hint" role="group" aria-label="裁剪操作">
          <span className="crop-hint-title"><Crop size={17} strokeWidth={1.8} aria-hidden="true" /><span>裁剪</span></span>
          <button type="button" className="crop-control-btn" aria-label="取消裁剪" title="取消裁剪" onClick={cancelCrop}>
            <X size={19} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <button type="button" className="crop-control-btn is-confirm" aria-label="完成裁剪" title="完成裁剪" onClick={confirmCrop}>
            <Check size={19} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

/** 标注在世界坐标下的包围盒（用于框选） */
function annWorldRect(ann: AnnotationObject, parent: ImageObject | null): RectT {
  const conv = (p: Point) => (parent ? imageLocalToCanvas(parent, p) : p);
  const pts: Point[] = [];
  if (ann.geometry.rect) {
    const r = ann.geometry.rect;
    pts.push(conv({ x: r.x, y: r.y }), conv({ x: r.x + r.width, y: r.y + r.height }));
  }
  if (ann.geometry.points) ann.geometry.points.forEach((p) => pts.push(conv(p)));
  if (ann.geometry.position) pts.push(conv(ann.geometry.position));
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
