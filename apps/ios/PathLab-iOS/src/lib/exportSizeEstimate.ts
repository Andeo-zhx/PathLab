import { getResource } from './resources';
import type { ExportLayout } from './exportLayout';
import type { ProjectDoc } from './types';

export interface PngSizeEstimate {
  minBytes: number;
  maxBytes: number;
}

function rasterCompressionRange(project: ProjectDoc, imageId: string): { lowBpp: number; highBpp: number } {
  const image = project.images.find((candidate) => candidate.id === imageId);
  if (!image) return { lowBpp: 1.05, highBpp: 3.9 };
  const resource = getResource(image.resourceId);
  const isPng = image.mimeType.toLowerCase().includes('png') || resource?.blob.type.toLowerCase().includes('png');
  if (!isPng) return { lowBpp: 1.05, highBpp: 3.9 };

  const sourcePixels = Math.max(1, image.originalWidth * image.originalHeight);
  const sourceBpp = resource?.blob.size ? resource.blob.size / sourcePixels : 2;
  return {
    // PNG output can compress much further than the source after scaling and compositing.
    // Keep the low estimate deliberately conservative so it remains a useful lower bound.
    lowBpp: Math.max(0.16, Math.min(2.2, sourceBpp * 0.32)),
    highBpp: Math.max(0.9, Math.min(3.9, sourceBpp * 1.35 + 0.2)),
  };
}

/**
 * Estimate the PNG file size from the output pixel count and visible raster area.
 * PNG compression depends heavily on image content, so this intentionally returns a range.
 */
export function estimatePngSize(project: ProjectDoc, layout: ExportLayout, scale: number): PngSizeEstimate {
  const outputScale = Math.max(1, scale);
  const totalPixels = Math.max(1, layout.pageWidth * layout.pageHeight * outputScale * outputScale);
  const sceneScale = outputScale * (layout.mode === 'page' ? layout.blockScale : 1);
  const rasterSources: { area: number; lowBpp: number; highBpp: number }[] = [];

  for (const image of project.images) {
    if (!image.visible || image.opacity <= 0) continue;
    const { lowBpp, highBpp } = rasterCompressionRange(project, image.id);

    rasterSources.push({
      area: image.width * image.height * sceneScale * sceneScale,
      lowBpp,
      highBpp,
    });
  }

  for (const magnifier of project.magnifiers) {
    if (!magnifier.visible) continue;
    const source = project.images.find((image) => image.id === magnifier.sourceImageId);
    const radius = layout.mode === 'page' ? magnifier.destination.radius * sceneScale : magnifier.destination.radius * outputScale;
    if (!source || radius <= 0) continue;
    const { lowBpp, highBpp } = rasterCompressionRange(project, source.id);
    rasterSources.push({
      area: Math.PI * radius * radius,
      lowBpp,
      highBpp,
    });
  }

  const rasterArea = Math.min(totalPixels, rasterSources.reduce((sum, item) => sum + item.area, 0));
  const sourceArea = rasterSources.reduce((sum, item) => sum + item.area, 0);
  const averageLowBpp = sourceArea
    ? rasterSources.reduce((sum, item) => sum + item.area * item.lowBpp, 0) / sourceArea
    : 0;
  const averageHighBpp = sourceArea
    ? rasterSources.reduce((sum, item) => sum + item.area * item.highBpp, 0) / sourceArea
    : 0;
  const nonRasterArea = Math.max(0, totalPixels - rasterArea);

  return {
    minBytes: Math.ceil(rasterArea * averageLowBpp + nonRasterArea * 0.015 + 2048),
    maxBytes: Math.ceil(rasterArea * averageHighBpp + nonRasterArea * 0.12 + 2048),
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
