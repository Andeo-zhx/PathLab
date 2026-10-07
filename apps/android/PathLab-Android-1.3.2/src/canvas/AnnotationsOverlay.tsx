import { useMemo } from 'react';
import { Group } from 'react-konva';
import type { AnnotationObject, ImageObject, ProjectDoc } from '../lib/types';
import { imageDisplayScale } from '../lib/geometry';
import { AnnotationShape } from './AnnotationShape';

const EMPTY_ANNOTATIONS: AnnotationObject[] = [];

/** Draw annotations above magnifiers while keeping image-hosted annotations in source coordinates. */
export function AnnotationsOverlay({
  project,
  editingTextId = null,
  hideHostedAnnotations = false,
  hiddenImageId = null,
}: {
  project: Pick<ProjectDoc, 'images' | 'annotations'>;
  editingTextId?: string | null;
  hideHostedAnnotations?: boolean;
  hiddenImageId?: string | null;
}) {
  const imageOrder = useMemo(
    () => [...project.images].sort((a, b) => a.zIndex - b.zIndex),
    [project.images],
  );
  const byImage = useMemo(() => {
    const map = new Map<string, AnnotationObject[]>();
    const loose: AnnotationObject[] = [];
    for (const annotation of project.annotations) {
      if (!annotation.parentImageId) {
        loose.push(annotation);
        continue;
      }
      const list = map.get(annotation.parentImageId);
      if (list) list.push(annotation);
      else map.set(annotation.parentImageId, [annotation]);
    }
    for (const list of map.values()) list.sort((a, b) => a.zIndex - b.zIndex);
    loose.sort((a, b) => a.zIndex - b.zIndex);
    map.set('__loose__', loose);
    return map;
  }, [project.annotations]);

  return (
    <>
      {!hideHostedAnnotations &&
        imageOrder.map((img: ImageObject) => {
          if (!img.visible || !img.annotationsVisible || img.id === hiddenImageId) return null;
          const annotations = byImage.get(img.id) ?? EMPTY_ANNOTATIONS;
          if (!annotations.length) return null;
          const scale = imageDisplayScale(img);
          return (
            <Group key={img.id} x={img.x} y={img.y} rotation={img.rotation} opacity={img.opacity} listening={false}>
              <Group
                x={-img.crop.x * scale}
                y={-img.crop.y * scale}
                scaleX={scale}
                scaleY={scale}
                listening={false}
              >
                {annotations.map((ann) => (
                  <AnnotationShape key={ann.id} ann={ann} unit={1 / scale} hideText={editingTextId === ann.id} />
                ))}
              </Group>
            </Group>
          );
        })}
      {byImage.get('__loose__')?.map((ann) => (
        <AnnotationShape key={ann.id} ann={ann} unit={1} hideText={editingTextId === ann.id} />
      ))}
    </>
  );
}
