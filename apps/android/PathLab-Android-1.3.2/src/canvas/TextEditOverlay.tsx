import { useEffect, useLayoutEffect, useRef } from 'react';
import { useProject } from '../store/projectStore';
import { DEFAULT_TEXT_COLOR } from '../lib/factory';
import { useUi } from '../store/uiStore';
import { imageLocalToCanvas } from '../lib/geometry';
import type { Point } from '../lib/types';
import { DEFAULT_TEXT_FONT_FAMILY, fitTextBlock } from '../lib/textPreferences';

export interface TextEditOverlayProps {
  onCommit: () => void;
  worldToScreen: (p: Point) => Point;
  zoom: number;
}

export function TextEditOverlay({ onCommit, worldToScreen, zoom }: TextEditOverlayProps) {
  const editingTextId = useUi((s) => s.editingTextId);
  const textDraft = useUi((s) => s.textDraft);
  const project = useProject((s) => s.project);
  const ref = useRef<HTMLTextAreaElement>(null);

  const ann = project.annotations.find((a) => a.id === editingTextId);
  const parent = ann?.parentImageId ? project.images.find((i) => i.id === ann.parentImageId) ?? null : null;
  const fontSize = (ann?.textStyle?.fontSize ?? 20) * zoom;
  const fontFamily = ann?.textStyle?.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY;
  const fontWeight = ann?.textStyle?.fontWeight ?? 400;
  const fontStyle = ann?.textStyle?.fontStyle ?? 'normal';
  const layout = fitTextBlock(textDraft ?? '', ann?.textStyle?.fontSize ?? 20, fontFamily, fontWeight, fontStyle);
  const horizontalPadding = fontSize * 0.34;
  const editorWidth = layout.width * zoom + horizontalPadding * 2;
  const maxEditorHeight = Math.max(fontSize * 1.8, Math.min(720, window.innerHeight * 0.7));

  useEffect(() => {
    // 浏览器在 mousedown 之后还会做一次“焦点修正”，会把焦点抢回 body，
    // 因此这里在随后的两个时机各聚焦一次，确保输入框真正拿到焦点。
    const grab = () => {
      const el = ref.current;
      if (!el || document.activeElement === el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    };
    grab();
    const raf = requestAnimationFrame(grab);
    const timer = window.setTimeout(grab, 70);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTextId]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxEditorHeight)}px`;
    if (el.selectionStart === el.value.length && el.scrollHeight > maxEditorHeight) {
      el.scrollTop = el.scrollHeight;
    }
  }, [textDraft, zoom, editorWidth, fontSize, maxEditorHeight]);

  if (!ann || !ann.geometry.position) return null;

  const world = parent ? imageLocalToCanvas(parent, ann.geometry.position) : ann.geometry.position;
  const screen = worldToScreen(world);
  const color = ann.textStyle?.color ?? DEFAULT_TEXT_COLOR;
  const background = ann.textStyle?.background ?? 'rgba(255,255,255,0.86)';

  return (
    <textarea
      ref={ref}
      className="text-edit-overlay"
      value={textDraft ?? ''}
      rows={1}
      wrap="soft"
      spellCheck={false}
      onChange={(e) => useUi.getState().setEditingText(editingTextId, e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCommit();
        }
        e.stopPropagation();
      }}
      style={{
        position: 'absolute',
        left: screen.x - fontSize * 0.3,
        top: screen.y - fontSize * 0.3,
        boxSizing: 'border-box',
        width: editorWidth,
        minWidth: Math.max(120, fontSize * 7),
        maxWidth: layout.maxWidth * zoom + horizontalPadding * 2,
        maxHeight: maxEditorHeight,
        fontSize,
        lineHeight: 1.35,
        fontFamily,
        fontWeight,
        fontStyle,
        color,
        background,
        padding: `${fontSize * 0.3}px ${horizontalPadding}px`,
        borderRadius: 6,
        border: 'none',
        outline: '2px solid rgba(46,108,104,0.5)',
        outlineOffset: '1px',
        resize: 'none',
        overflow: 'auto',
        overflowX: 'hidden',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        zIndex: 70,
      }}
    />
  );
}
