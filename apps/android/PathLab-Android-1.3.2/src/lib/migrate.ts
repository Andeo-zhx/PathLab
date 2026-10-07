import { DEFAULT_ROI_COLOR, normalizeMagnifierRadii } from './magnifier';
import { PROJECT_VERSION, type ProjectDoc } from './types';

/**
 * 版本迁移。当前只处理 1 → 2：
 *  - magnifier 增加 roiColor（圈选区颜色）；
 *  - destination.radius 由派生缓存改为“以 sourceRegion 为准”重新计算
 *    （旧文件的 radius 是「ROI 尺寸 × 1.2」，重算后变成「ROI 尺寸 × zoom」）。
 */
export function migrateProject(raw: unknown): ProjectDoc {
  const p = raw as ProjectDoc;
  if (!Array.isArray(p.images)) p.images = [];
  if (!Array.isArray(p.annotations)) p.annotations = [];
  if (!Array.isArray(p.magnifiers)) p.magnifiers = [];
  if (!p.canvas) p.canvas = { zoom: 1, panX: 0, panY: 0 };

  for (const m of p.magnifiers) {
    if (!m.roiColor) m.roiColor = DEFAULT_ROI_COLOR;
    if (!Number.isFinite(m.zoom) || m.zoom <= 0) m.zoom = 2;
    if (!m.destination) m.destination = { x: 0, y: 0, radius: 1 };
  }
  // 丢掉无法解析的宿主引用
  const ids = new Set(p.images.map((i) => i.id));
  p.magnifiers = p.magnifiers.filter((m) => ids.has(m.sourceImageId));

  normalizeMagnifierRadii(p);
  p.version = PROJECT_VERSION;
  return p;
}
