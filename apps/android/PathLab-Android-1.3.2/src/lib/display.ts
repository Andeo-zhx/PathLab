import { IS_MAC } from './platform';

export interface DisplayInfo {
  /** 设备像素比：等于「系统缩放 × 浏览器页面缩放」 */
  devicePixelRatio: number;
  /** 页面被缩小显示（1 CSS px 不足 1 设备像素），界面会显得偏小 */
  zoomedOut: boolean;
  /** 运行在 iframe / 嵌入式预览里 */
  embedded: boolean;
}

export function getDisplayInfo(): DisplayInfo {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  let embedded = false;
  try {
    embedded = window.self !== window.top;
  } catch {
    embedded = true;
  }
  return { devicePixelRatio: dpr, zoomedOut: dpr < 0.8, embedded };
}

export function zoomOutHint(info: DisplayInfo): string {
  const pct = Math.round(info.devicePixelRatio * 100);
  return `检测到页面被缩小到约 ${pct}%，界面会显得偏小 · 按 ${IS_MAC ? '⌘' : 'Ctrl'}+0 恢复浏览器 100% 缩放`;
}

export const EMBEDDED_HINT = '正在嵌入式预览中打开，界面可能被整体缩放 · 建议在新标签页中打开本页获得 1:1 显示';
