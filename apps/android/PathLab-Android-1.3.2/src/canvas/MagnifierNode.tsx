import { memo } from 'react';
import { Circle, Group, Image as KImage } from 'react-konva';
import type { ImageObject, MagnifierObject } from '../lib/types';
import { cropForBitmap, getResource } from '../lib/resources';
import { resolveMagnifier } from '../lib/magnifier';

export interface MagnifierNodeProps {
  magnifier: MagnifierObject;
  source: ImageObject | null;
  hiRes?: boolean;
}

/**
 * 圆形放大引用：把 sourceRegion（圈选区）按 zoom 倍投影到目标圆。
 * 投射圆半径 = 圈选区在画布上的半径 × zoom，因此在任何倍率下
 * 圆内看到的正好是圈选区本身（见 lib/magnifier.ts 的两条不变式）。
 */
function MagnifierNodeInner({ magnifier: m, source, hiRes = false }: MagnifierNodeProps) {
  if (!source || !m.visible || !source.visible) return null;
  const res = getResource(source.resourceId);
  if (!res) return null;
  const r = resolveMagnifier(m, source);
  if (!r) return null;

  const bitmap = hiRes ? res.hiRes : res.display;
  const crop = source.crop;
  const bitmapCrop = cropForBitmap(res, crop, hiRes);

  return (
    <Group x={m.destination.x} y={m.destination.y} rotation={source.rotation} listening={false}>
      <Group
        clipFunc={(ctx) => {
          ctx.arc(0, 0, Math.max(1, r.radius), 0, Math.PI * 2, false);
        }}
        listening={false}
      >
        <KImage
          image={bitmap}
          x={-(r.centerSource.x - crop.x) * r.mScale}
          y={-(r.centerSource.y - crop.y) * r.mScale}
          width={crop.width * r.mScale}
          height={crop.height * r.mScale}
          crop={{ x: bitmapCrop.x, y: bitmapCrop.y, width: bitmapCrop.width, height: bitmapCrop.height }}
          listening={false}
        />
      </Group>
      <Circle
        radius={Math.max(1, r.radius)}
        stroke={m.borderColor}
        strokeWidth={m.borderWidth}
        shadowColor="#0F172A"
        shadowOpacity={0.22}
        shadowBlur={12}
        shadowOffsetY={2}
        listening={false}
      />
    </Group>
  );
}

export const MagnifierNode = memo(MagnifierNodeInner);
