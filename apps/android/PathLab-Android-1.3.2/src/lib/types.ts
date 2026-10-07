/**
 * PathLab — 核心数据结构
 * 所有持久化数据均为可 JSON 序列化的纯数据（图片二进制单独存放于资源表）。
 */

/** 1 → 2：magnifier 增加 roiColor，且 destination.radius 改为派生缓存（以 sourceRegion 为准） */
export const PROJECT_VERSION = 2;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AnnotationType =
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'freehand'
  | 'arrow'
  | 'line'
  | 'text';

export type Tool =
  | 'select'
  | 'hand'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'freehand'
  | 'arrow'
  | 'line'
  | 'text'
  | 'magnifier';

/** 图像对象：只保存几何与元信息，位图放在 resourceRegistry / IndexedDB 中 */
export interface ImageObject {
  id: string;
  resourceId: string;
  fileName: string;
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  /** 画布坐标：显示框左上角（旋转前） */
  x: number;
  y: number;
  /** 显示框尺寸（画布像素） */
  width: number;
  height: number;
  /** 旋转角度（度），绕显示框左上角，通常为 0 / 90 / 180 / 270 */
  rotation: number;
  /** 原始像素坐标下的裁切矩形 */
  crop: Rect;
  zIndex: number;
  locked: boolean;
  visible: boolean;
  opacity: number;
  cornerRadius: number;
  /** 该图上的标注是否显示（便于查看“裸图”） */
  annotationsVisible: boolean;
}

export interface TextStyle {
  fontSize: number;
  /** 字体栈；缺失时使用系统默认字体以兼容旧工程 */
  fontFamily?: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  align: 'left' | 'center' | 'right';
  color: string;
  /** null 表示无背景 */
  background: string | null;
  /** 文字描边（用于在组织图上保持可读性），null 表示无 */
  outline: string | null;
}

export interface AnnotationGeometry {
  /** rect / ellipse / freehand 使用；freehand 的 rect 为其包围盒缓存 */
  rect?: Rect;
  /** polygon / freehand / line / arrow 使用，坐标位于宿主坐标系 */
  points?: Point[];
  /** text 使用 */
  position?: Point;
}

export interface AnnotationObject {
  id: string;
  type: AnnotationType;
  /** 宿主图片；null 表示直接位于画布坐标系 */
  parentImageId: string | null;
  /** 坐标系：宿主图片的原始像素坐标，或画布坐标（parentImageId 为 null 时） */
  geometry: AnnotationGeometry;
  stroke: string;
  strokeWidth: number;
  dash: number[];
  fill: string | null;
  text?: string;
  textStyle?: TextStyle;
  zIndex: number;
  visible: boolean;
  locked: boolean;
}

export interface MagnifierObject {
  id: string;
  sourceImageId: string;
  /**
   * 圈选区 ROI 的包围盒（宿主图片原始像素坐标）——**唯一真相**。
   * 投射圆的大小与内容一律由它和 zoom 派生，见 lib/magnifier.ts。
   */
  sourceRegion: Rect;
  /**
   * 投射圆（画布坐标）。radius 是派生缓存，请勿直接读写，
   * 一律使用 resolveMagnifier()；写回由 normalizeMagnifierRadii() 负责。
   */
  destination: { x: number; y: number; radius: number };
  /** 倍率：投射图相对圈选区在屏幕上的放大倍数 */
  zoom: number;
  /** 圈选区（原始图上的虚线圆）颜色，用户可从调色板自选 */
  roiColor: string;
  borderColor: string;
  borderWidth: number;
  connectorVisible: boolean;
  visible: boolean;
  zIndex: number;
  locked: boolean;
}

export interface CanvasView {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ProjectDoc {
  version: number;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  canvas: CanvasView;
  images: ImageObject[];
  annotations: AnnotationObject[];
  magnifiers: MagnifierObject[];
  /** Tiptap JSON */
  textDocument: unknown;
}

/** 画布场景数据（不含文字文档），用于精细订阅避免文字输入时重绘画布 */
export type SceneDoc = Pick<ProjectDoc, 'images' | 'annotations' | 'magnifiers'>;

export type SelectedKind = 'image' | 'annotation' | 'magnifier';

export interface SelectionRef {
  id: string;
  kind: SelectedKind;
}

export function createEmptyProject(title = '未命名工程'): ProjectDoc {
  const now = new Date().toISOString();
  return {
    version: PROJECT_VERSION,
    id: `p_${Math.random().toString(36).slice(2, 10)}`,
    title,
    createdAt: now,
    updatedAt: now,
    canvas: { zoom: 1, panX: 0, panY: 0 },
    images: [],
    annotations: [],
    magnifiers: [],
    textDocument: { type: 'doc', content: [{ type: 'paragraph' }] },
  };
}

export const EMPTY_TEXT_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };
