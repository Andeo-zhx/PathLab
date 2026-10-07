import type { TextStyle } from './types';

export const DEFAULT_CHINESE_FONT_FAMILY = 'Noto Serif SC';
export const DEFAULT_ENGLISH_FONT_FAMILY = 'Times New Roman';
export const DEFAULT_TEXT_FONT_FAMILY = '"Times New Roman", "Noto Serif SC", serif';
export const DEFAULT_TEXT_FONT_SIZE = 20;

export const CHINESE_FONT_CHOICES = [
  { label: 'Noto Serif SC', family: 'Noto Serif SC' },
  { label: '微软雅黑', family: 'Microsoft YaHei' },
  { label: '宋体', family: 'SimSun' },
  { label: '黑体', family: 'SimHei' },
] as const;

export const ENGLISH_FONT_CHOICES = [
  { label: 'Times New Roman', family: 'Times New Roman' },
  { label: 'Arial', family: 'Arial' },
  { label: 'Georgia', family: 'Georgia' },
  { label: 'Consolas', family: 'Consolas' },
] as const;

export function makeTextFontFamily(englishFamily: string, chineseFamily: string): string {
  return `"${englishFamily}", "${chineseFamily}", serif`;
}

const MIN_TEXT_WIDTH_EM = 7;
const MAX_TEXT_WIDTH_EM = 24;
const MAX_TEXT_WIDTH_PX = 640;
let measureContext: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext !== undefined) return measureContext;
  if (typeof document === 'undefined') {
    measureContext = null;
    return measureContext;
  }
  measureContext = document.createElement('canvas').getContext('2d');
  return measureContext;
}

function fontSpec(fontSize: number, fontFamily: string, fontWeight: number, fontStyle: string): string {
  return `${fontStyle === 'italic' ? 'italic ' : ''}${fontWeight} ${fontSize}px ${fontFamily}`;
}

function fallbackCharWidth(char: string, fontSize: number): number {
  return /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF\uAC00-\uD7AF]/u.test(char)
    ? fontSize
    : char === ' '
      ? fontSize * 0.3
      : fontSize * 0.56;
}

function measureLine(line: string, fontSize: number, context: CanvasRenderingContext2D | null): number {
  if (!line) return 0;
  if (context) return context.measureText(line).width;
  return Array.from(line).reduce((sum, char) => sum + fallbackCharWidth(char, fontSize), 0);
}

export interface TextBlockLayout {
  width: number;
  lineCount: number;
  maxWidth: number;
}

/** Measure a label and let it grow up to 24 em (capped at 640 canvas pixels) before wrapping. */
export function fitTextBlock(
  text: string,
  fontSize: number,
  fontFamily = DEFAULT_TEXT_FONT_FAMILY,
  fontWeight = 400,
  fontStyle = 'normal',
): TextBlockLayout {
  const size = Math.max(1, fontSize || DEFAULT_TEXT_FONT_SIZE);
  const minWidth = size * MIN_TEXT_WIDTH_EM;
  const maxWidth = Math.max(minWidth, Math.min(size * MAX_TEXT_WIDTH_EM, MAX_TEXT_WIDTH_PX));
  const context = getMeasureContext();
  if (context) context.font = fontSpec(size, fontFamily, fontWeight, fontStyle);

  const sourceLines = text.split('\n');
  let widestLine = 0;
  let wrappedLineCount = 0;
  for (const line of sourceLines) {
    const lineWidth = measureLine(line, size, context);
    widestLine = Math.max(widestLine, lineWidth);
    if (!line) {
      wrappedLineCount += 1;
      continue;
    }

    const chars = Array.from(line);
    let currentWidth = 0;
    let visualLines = 1;
    for (const char of chars) {
      const charWidth = measureLine(char, size, context);
      if (currentWidth > 0 && currentWidth + charWidth > maxWidth) {
        visualLines += 1;
        currentWidth = 0;
      }
      currentWidth += charWidth;
    }
    wrappedLineCount += visualLines;
  }

  return {
    width: Math.min(maxWidth, Math.max(minWidth, widestLine)),
    lineCount: Math.max(1, wrappedLineCount),
    maxWidth,
  };
}

export interface StoredTextDefaults extends Pick<TextStyle, 'fontFamily' | 'fontSize'> {
  chineseFontFamily: string;
  englishFontFamily: string;
}

const DEFAULT_FONT_PAIR = {
  chineseFontFamily: DEFAULT_CHINESE_FONT_FAMILY,
  englishFontFamily: DEFAULT_ENGLISH_FONT_FAMILY,
};

export function readStoredTextDefaults(): StoredTextDefaults {
  try {
    const stored = localStorage.getItem('pathlab:text-defaults:v2');
    const value = stored ? JSON.parse(stored) as Record<string, unknown> : {};
    const legacy = stored ? {} : JSON.parse(localStorage.getItem('pathlab:text-defaults:v1') ?? '{}') as Record<string, unknown>;
    const legacyFamily = typeof legacy.fontFamily === 'string' ? legacy.fontFamily : '';
    const legacyChinese = /Songti|STSong|SimSun|serif/i.test(legacyFamily) ? 'SimSun' : DEFAULT_CHINESE_FONT_FAMILY;
    const legacyEnglish = /Mono|Consolas|Menlo/i.test(legacyFamily)
      ? 'Consolas'
      : /Songti|STSong|SimSun|serif/i.test(legacyFamily)
        ? 'Times New Roman'
        : DEFAULT_ENGLISH_FONT_FAMILY;
    const storedChineseFamily = value.chineseFontFamily === 'Microsoft YaHei'
      ? DEFAULT_CHINESE_FONT_FAMILY
      : value.chineseFontFamily;
    const storedEnglishFamily = value.englishFontFamily === 'Arial'
      ? DEFAULT_ENGLISH_FONT_FAMILY
      : value.englishFontFamily;
    const chineseFontFamily = CHINESE_FONT_CHOICES.find((choice) => choice.family === storedChineseFamily)?.family
      ?? (stored ? DEFAULT_FONT_PAIR.chineseFontFamily : legacyChinese);
    const englishFontFamily = ENGLISH_FONT_CHOICES.find((choice) => choice.family === storedEnglishFamily)?.family
      ?? (stored ? DEFAULT_FONT_PAIR.englishFontFamily : legacyEnglish);
    const storedSize = value.fontSize ?? legacy.fontSize;
    const fontSize = typeof storedSize === 'number' && Number.isFinite(storedSize)
      ? Math.min(80, Math.max(10, storedSize))
      : DEFAULT_TEXT_FONT_SIZE;
    if (stored && (value.chineseFontFamily !== chineseFontFamily || value.englishFontFamily !== englishFontFamily)) {
      try {
        localStorage.setItem('pathlab:text-defaults:v2', JSON.stringify({ chineseFontFamily, englishFontFamily, fontSize }));
      } catch {
        // Keep the new defaults active for this session if storage is unavailable.
      }
    }
    return {
      chineseFontFamily,
      englishFontFamily,
      fontFamily: makeTextFontFamily(englishFontFamily, chineseFontFamily),
      fontSize,
    };
  } catch {
    return {
      ...DEFAULT_FONT_PAIR,
      fontFamily: DEFAULT_TEXT_FONT_FAMILY,
      fontSize: DEFAULT_TEXT_FONT_SIZE,
    };
  }
}

export function persistTextDefaults(chineseFontFamily: string, englishFontFamily: string, fontSize: number): void {
  try {
    localStorage.setItem('pathlab:text-defaults:v2', JSON.stringify({ chineseFontFamily, englishFontFamily, fontSize }));
  } catch {
    // Preferences remain active for this session even if storage is unavailable.
  }
}
