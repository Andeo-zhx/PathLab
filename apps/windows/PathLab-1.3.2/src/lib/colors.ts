export const DEFAULT_ANNOTATION_COLOR = '#000000';

/** #RRGGBB -> rgba(r,g,b,a)，非 6 位十六进制原样返回 */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export const ANNOTATION_PALETTE: string[] = [
  '#000000',
  '#E23B3B',
  '#F08A24',
  '#E8C22A',
  '#2FA36B',
  '#2F7FD4',
  '#7B5BD6',
  '#FFFFFF',
];

export const MAGNIFIER_BORDER_PALETTE: string[] = ['#FFFFFF', '#E5E7EB', '#111827', '#E23B3B'];

/** 圈选区虚线框可选颜色：都在 H&E 粉紫背景上有足够对比 */
export const ROI_PALETTE: string[] = [
  '#2E6C68',
  '#0EA5E9',
  '#E23B3B',
  '#F59E0B',
  '#7C3AED',
  '#111827',
  '#FFFFFF',
];

export const DEFAULT_ROI_COLOR = '#2E6C68';

const ROI_KEY = 'pathlab.roiColor';

export function loadRoiColor(): string {
  try {
    return localStorage.getItem(ROI_KEY) || DEFAULT_ROI_COLOR;
  } catch {
    return DEFAULT_ROI_COLOR;
  }
}

export function saveRoiColor(color: string): void {
  try {
    localStorage.setItem(ROI_KEY, color);
  } catch {
    /* ignore */
  }
}

const RECENT_KEY = 'pathlab.recentColors';

export function loadRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [DEFAULT_ANNOTATION_COLOR];
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr) && arr.every((v) => typeof v === 'string')) return arr.slice(0, 4);
  } catch {
    /* ignore */
  }
  return [DEFAULT_ANNOTATION_COLOR];
}

export function pushRecentColor(color: string): string[] {
  const next = [color, ...loadRecentColors().filter((c) => c.toLowerCase() !== color.toLowerCase())].slice(0, 4);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
