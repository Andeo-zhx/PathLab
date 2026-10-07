import type {
  AnnotationObject,
  AnnotationType,
  ImageObject,
  MagnifierObject,
  Rect,
  TextStyle,
} from './types';
import type { ImageResource } from './resources';
import { uid } from './id';
import { DEFAULT_ROI_COLOR } from './magnifier';
import { DEFAULT_TEXT_FONT_FAMILY, DEFAULT_TEXT_FONT_SIZE } from './textPreferences';

export function createImageObject(
  res: ImageResource,
  box: Rect,
  zIndex: number,
  fileName = 'image',
): ImageObject {
  return {
    id: uid('img'),
    resourceId: res.id,
    fileName,
    mimeType: res.blob.type || 'image/png',
    originalWidth: res.originalWidth,
    originalHeight: res.originalHeight,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    crop: {
      x: 0,
      y: 0,
      width: res.originalWidth,
      height: res.originalHeight,
    },
    zIndex,
    locked: false,
    visible: true,
    opacity: 1,
    cornerRadius: 3,
    annotationsVisible: true,
  };
}

export interface AnnotationStyle {
  stroke: string;
  strokeWidth: number;
  dash: number[];
  fill: string | null;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right';
  textBackground: string | null;
  textOutline: string | null;
}

export const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = {
  stroke: '#E23B3B',
  strokeWidth: 3,
  dash: [],
  fill: null,
  fontSize: DEFAULT_TEXT_FONT_SIZE,
  fontFamily: DEFAULT_TEXT_FONT_FAMILY,
  fontWeight: 600,
  fontStyle: 'normal',
  textAlign: 'left',
  textBackground: null,
  textOutline: 'rgba(255,255,255,0.9)',
};

const DEFAULT_TEXT_COLOR = '#000000';

export function createAnnotation(
  type: AnnotationType,
  parentImageId: string | null,
  style: AnnotationStyle,
  zIndex: number,
): AnnotationObject {
  const base: AnnotationObject = {
    id: uid('ann'),
    type,
    parentImageId,
    geometry: {},
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    dash: [...style.dash],
    fill: type === 'rect' || type === 'ellipse' ? style.fill : null,
    zIndex,
    visible: true,
    locked: false,
  };
  if (type === 'text') {
    const textStyle: TextStyle = {
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      align: style.textAlign,
      color: DEFAULT_TEXT_COLOR,
      background: style.textBackground,
      outline: style.textOutline,
    };
    base.text = '';
    base.textStyle = textStyle;
  }
  return base;
}

export function createMagnifier(
  sourceImageId: string,
  sourceRegion: Rect,
  destination: { x: number; y: number; radius: number },
  zIndex: number,
): MagnifierObject {
  return {
    id: uid('mag'),
    sourceImageId,
    sourceRegion,
    destination,
    zoom: 2,
    roiColor: DEFAULT_ROI_COLOR,
    borderColor: '#FFFFFF',
    borderWidth: 2,
    connectorVisible: true,
    visible: true,
    zIndex,
    locked: false,
  };
}
