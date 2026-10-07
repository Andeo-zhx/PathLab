import { useMemo, useState } from 'react';
import {
  TextAlignCenter,
  AlignHorizontalJustifyCenter,
  TextAlignStart,
  TextAlignEnd,
  AlignVerticalJustifyCenter,
  ChevronDown,
  Copy,
  Crop,
  Eye,
  EyeOff,
  LayoutGrid,
  Link2,
  Link2Off,
  Lock,
  Minus,
  Plus,
  RotateCw,
  Trash,
  LockOpen,
  Languages,
  Type,
} from 'lucide-react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import { useStyle } from '../store/styleStore';
import { getSelectionBounds } from '../canvas/handles';
import type { AnnotationObject, SelectionRef } from '../lib/types';
import {
  ANNOTATION_PALETTE,
  MAGNIFIER_BORDER_PALETTE,
  ROI_PALETTE,
  withAlpha,
} from '../lib/colors';
import {
  arrangeImages,
  duplicateSelection,
  deleteSelection,
  rotateImage,
  toggleAnnotationsVisible,
  toggleConnector,
  toggleLock,
} from '../lib/actions';
import { IconButton } from './IconButton';

function ColorPicker({
  value,
  options,
  onChange,
  trackRecent = true,
  maxSwatches = 4,
}: {
  value: string;
  options: string[];
  onChange: (c: string) => void;
  /** 是否把选中的颜色记入「最近使用的标注颜色」 */
  trackRecent?: boolean;
  /** 浮条上直接展示的色块数量，其余放进「更多颜色」 */
  maxSwatches?: number;
}) {
  const [open, setOpen] = useState(false);
  const recent = useStyle((s) => s.recentColors);
  const shown = useMemo(() => {
    const list = [...recent.filter((c) => options.includes(c)), ...options];
    return [...new Set(list)].slice(0, maxSwatches);
  }, [recent, options, maxSwatches]);

  return (
    <div className="swatch-row">
      {shown.map((c) => (
        <button
          key={c}
          type="button"
          className="swatch"
          aria-label={`颜色 ${c}`}
          aria-pressed={value.toLowerCase() === c.toLowerCase()}
          style={{ background: c }}
          onClick={() => {
            onChange(c);
            if (trackRecent) useStyle.getState().useColor(c);
          }}
        />
      ))}
      <IconButton
        size="sm"
        label="更多颜色"
        tip="更多颜色"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronDown size={15} strokeWidth={2} />
      </IconButton>
      {open && (
        <div className="color-popover">
          <div className="cp-grid">
            {ANNOTATION_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                aria-label={`颜色 ${c}`}
                style={{ background: c }}
                onClick={() => {
                  onChange(c);
                  if (trackRecent) useStyle.getState().useColor(c);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <label className="cp-custom">
            <span>自定义</span>
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#e23b3b'}
              onChange={(e) => {
                onChange(e.target.value);
                if (trackRecent) useStyle.getState().useColor(e.target.value);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function WidthPicker({ value, onChange }: { value: number; onChange: (w: number) => void }) {
  const widths = [2, 3, 5, 8];
  return (
    <div className="width-dots">
      {widths.map((w) => (
        <button
          key={w}
          type="button"
          className="width-dot"
          aria-label={`线宽 ${w} 像素`}
          data-tip={`线宽 ${w}px`}
          aria-pressed={Math.abs(value - w) < 0.01}
          onClick={() => onChange(w)}
        >
          <i style={{ width: 15, height: Math.max(2, w * 0.8) }} />
        </button>
      ))}
    </div>
  );
}

export function SelectionToolbar() {
  const images = useProject((s) => s.project.images);
  const annotationsAll = useProject((s) => s.project.annotations);
  const magnifiersAll = useProject((s) => s.project.magnifiers);
  const canvasView = useProject((s) => s.project.canvas);
  const project = useMemo(() => ({ images, annotations: annotationsAll, magnifiers: magnifiersAll }), [images, annotationsAll, magnifiersAll]);
  const selection = useUi((s) => s.selection);
  const cropping = useUi((s) => s.croppingImageId);
  const editingText = useUi((s) => s.editingTextId);
  const setTranslationAnnotation = useUi((s) => s.setTranslationAnnotation);
  const tool = useUi((s) => s.tool);
  const setStyle = useStyle((s) => s.setStyle);
  const duplicateSelected = () => duplicateSelection(selection);
  const deleteSelected = () => deleteSelection(selection);

  const bounds = useMemo(() => getSelectionBounds(project, selection), [project, selection]);

  // 只有在“选择”工具下才显示属性浮条：使用绘制工具时不遮挡画布
  if (!selection.length || !bounds || cropping || editingText || tool !== 'select') return null;

  const v = canvasView;
  const left = bounds.x * v.zoom + v.panX;
  const top = bounds.y * v.zoom + v.panY;
  const width = bounds.width * v.zoom;
  const height = bounds.height * v.zoom;
  const above = top > 56;

  const annotations = selection
    .filter((s) => s.kind === 'annotation')
    .map((s) => project.annotations.find((a) => a.id === s.id))
    .filter((a): a is AnnotationObject => Boolean(a));

  const patch = (label: string, fn: (a: AnnotationObject) => void) => {
    const ids = annotations.map((a) => a.id);
    useProject.getState().applyWithHistory(label, (d) => {
      for (const a of d.annotations) if (ids.includes(a.id)) fn(a);
    });
  };

  const single = selection.length === 1 ? selection[0] : null;
  const singleImage = single?.kind === 'image' ? project.images.find((i) => i.id === single.id) : null;
  const singleAnn = single?.kind === 'annotation' ? annotations[0] : null;
  const singleMag = single?.kind === 'magnifier' ? project.magnifiers.find((m) => m.id === single.id) : null;
  const imageSelection = selection.filter((s) => s.kind === 'image');

  let content: React.ReactNode = null;

  if (singleImage) {
    content = (
      <>
        <IconButton size="sm" label="裁切图片" tip="裁切" onClick={() => useUi.getState().setCrop(singleImage.id, { ...singleImage.crop })}>
          <Crop size={18} strokeWidth={1.7} />
        </IconButton>
        <IconButton size="sm" label="旋转 90 度" tip="旋转 90°" onClick={() => rotateImage(singleImage.id)}>
          <RotateCw size={18} strokeWidth={1.7} />
        </IconButton>
        <IconButton
          size="sm"
          label={singleImage.annotationsVisible ? '隐藏该图标注' : '显示该图标注'}
          tip={singleImage.annotationsVisible ? '隐藏该图标注' : '显示该图标注'}
          active={!singleImage.annotationsVisible}
          onClick={() => toggleAnnotationsVisible({ id: singleImage.id, kind: 'image' })}
        >
          {singleImage.annotationsVisible ? <Eye size={18} strokeWidth={1.7} /> : <EyeOff size={18} strokeWidth={1.7} />}
        </IconButton>
        <span className="sep" />
        <IconButton size="sm" label="复制" tip="复制并偏移 ⌘D" onClick={duplicateSelected}>
          <Copy size={18} strokeWidth={1.7} />
        </IconButton>
        <IconButton
          size="sm"
          label={singleImage.locked ? '解锁' : '锁定'}
          tip={singleImage.locked ? '解锁' : '锁定'}
          active={singleImage.locked}
          onClick={() => toggleLock({ id: singleImage.id, kind: 'image' })}
        >
          {singleImage.locked ? <Lock size={18} strokeWidth={1.7} /> : <LockOpen size={18} strokeWidth={1.7} />}
        </IconButton>
        <IconButton size="sm" label="删除" tip="删除 ⌫" tone="danger" onClick={deleteSelected}>
          <Trash size={18} strokeWidth={1.7} />
        </IconButton>
      </>
    );
  } else if (imageSelection.length >= 2) {
    content = (
      <>
        <IconButton size="sm" label="垂直排列" tip="垂直排列" onClick={() => arrangeImages('vertical')}>
          <AlignVerticalJustifyCenter size={18} strokeWidth={1.7} />
        </IconButton>
        <IconButton size="sm" label="水平排列" tip="水平排列" onClick={() => arrangeImages('horizontal')}>
          <AlignHorizontalJustifyCenter size={18} strokeWidth={1.7} />
        </IconButton>
        <IconButton size="sm" label="网格排列" tip="网格排列" onClick={() => arrangeImages('grid')}>
          <LayoutGrid size={18} strokeWidth={1.7} />
        </IconButton>
        <span className="sep" />
        <IconButton size="sm" label="删除" tip="删除 ⌫" tone="danger" onClick={deleteSelected}>
          <Trash size={18} strokeWidth={1.7} />
        </IconButton>
      </>
    );
  } else if (singleMag) {
    const mag = singleMag;
    content = (
      <>
        <IconButton
          size="sm"
          label="降低倍率"
          tip="降低倍率"
          onClick={() => {
            const z = Math.max(1, Math.round((mag.zoom - 0.5) * 10) / 10);
            useProject.getState().applyWithHistory('调整放大倍率', (d) => {
              const t = d.magnifiers.find((x) => x.id === mag.id);
              if (t) t.zoom = z;
            });
            useStyle.getState().setMagnifier({ zoom: z });
          }}
        >
          <Minus size={16} strokeWidth={2} />
        </IconButton>
        <span className="number-field">
          <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{mag.zoom.toFixed(1)}×</b>
        </span>
        <IconButton
          size="sm"
          label="提高倍率"
          tip="提高倍率"
          onClick={() => {
            const z = Math.min(8, Math.round((mag.zoom + 0.5) * 10) / 10);
            useProject.getState().applyWithHistory('调整放大倍率', (d) => {
              const t = d.magnifiers.find((x) => x.id === mag.id);
              if (t) t.zoom = z;
            });
            useStyle.getState().setMagnifier({ zoom: z });
          }}
        >
          <Plus size={16} strokeWidth={2} />
        </IconButton>
        <span className="sep" />
        <span className="group-label">圈选</span>
        <ColorPicker
          value={mag.roiColor}
          options={ROI_PALETTE}
          trackRecent={false}
          maxSwatches={3}
          onChange={(c) => {
            useProject.getState().applyWithHistory('修改圈选颜色', (d) => {
              const t = d.magnifiers.find((x) => x.id === mag.id);
              if (t) t.roiColor = c;
            });
            useStyle.getState().setMagnifier({ roiColor: c });
          }}
        />
        <span className="sep" />
        <span className="group-label">边框</span>
        <ColorPicker
          value={mag.borderColor}
          options={MAGNIFIER_BORDER_PALETTE}
          maxSwatches={3}
          onChange={(c) => {
            useProject.getState().applyWithHistory('修改边框颜色', (d) => {
              const t = d.magnifiers.find((x) => x.id === mag.id);
              if (t) t.borderColor = c;
            });
            useStyle.getState().setMagnifier({ borderColor: c });
          }}
        />
        <span className="sep" />
        <IconButton
          size="sm"
          label="连接线开关"
          tip={mag.connectorVisible ? '隐藏连接线' : '显示连接线'}
          active={mag.connectorVisible}
          onClick={() => {
            toggleConnector(mag.id);
            useStyle.getState().setMagnifier({ connector: !mag.connectorVisible });
          }}
        >
          {mag.connectorVisible ? <Link2 size={18} strokeWidth={1.7} /> : <Link2Off size={18} strokeWidth={1.7} />}
        </IconButton>
        <IconButton size="sm" label="删除" tip="删除 ⌫" tone="danger" onClick={deleteSelected}>
          <Trash size={18} strokeWidth={1.7} />
        </IconButton>
      </>
    );
  } else if (singleAnn && singleAnn.type === 'text') {
    const ts = singleAnn.textStyle!;
    const textAnnotation = singleAnn;
    content = (
      <>
        <IconButton
          size="sm"
          label="翻译标注"
          tip="使用 DeepSeek 云端翻译"
          disabled={textAnnotation.locked || !textAnnotation.text?.trim()}
          onClick={() => setTranslationAnnotation(textAnnotation.id)}
        >
          <Languages size={18} strokeWidth={1.7} />
        </IconButton>
        <IconButton
          size="sm"
          label="编辑文字"
          tip="修改文字内容"
          disabled={singleAnn.locked}
          onClick={() => useUi.getState().setEditingText(singleAnn.id, singleAnn.text ?? '')}
        >
          <Type size={17} strokeWidth={1.8} />
        </IconButton>
        <span className="sep" />
        <span className="group-label">字号</span>
        <IconButton
          size="sm"
          label="减小字号"
          tip="减小字号"
          onClick={() => {
            const size = Math.max(10, ts.fontSize - 2);
            patch('修改字号', (a) => {
              if (a.textStyle) a.textStyle.fontSize = size;
            });
            setStyle({ fontSize: size });
          }}
        >
          <Minus size={16} strokeWidth={2} />
        </IconButton>
        <span className="number-field">
          <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{Math.round(ts.fontSize)}</b>
        </span>
        <IconButton
          size="sm"
          label="增大字号"
          tip="增大字号"
          onClick={() => {
            const size = Math.min(200, ts.fontSize + 2);
            patch('修改字号', (a) => {
              if (a.textStyle) a.textStyle.fontSize = size;
            });
            setStyle({ fontSize: size });
          }}
        >
          <Plus size={16} strokeWidth={2} />
        </IconButton>
        <span className="sep" />
        <ColorPicker
          value={ts.color}
          options={ANNOTATION_PALETTE}
          onChange={(c) => {
            patch('修改文字颜色', (a) => {
              if (a.textStyle) a.textStyle.color = c;
            });
            setStyle({ stroke: c });
          }}
        />
        <span className="sep" />
        <IconButton
          size="sm"
          label="对齐方式"
          tip={`对齐：${ts.align === 'left' ? '左' : ts.align === 'center' ? '中' : '右'}`}
          onClick={() => {
            const next = ts.align === 'left' ? 'center' : ts.align === 'center' ? 'right' : 'left';
            patch('修改对齐', (a) => {
              if (a.textStyle) a.textStyle.align = next;
            });
            setStyle({ textAlign: next });
          }}
        >
          {ts.align === 'left' ? <TextAlignStart size={18} strokeWidth={1.7} /> : ts.align === 'center' ? <TextAlignCenter size={18} strokeWidth={1.7} /> : <TextAlignEnd size={18} strokeWidth={1.7} />}
        </IconButton>
        <span className="sep" />
        <IconButton size="sm" label="复制" tip="复制并偏移 ⌘D" onClick={duplicateSelected}>
          <Copy size={18} strokeWidth={1.7} />
        </IconButton>
        <IconButton size="sm" label="删除" tip="删除 ⌫" tone="danger" onClick={deleteSelected}>
          <Trash size={18} strokeWidth={1.7} />
        </IconButton>
      </>
    );
  } else if (singleAnn) {
    const hasFill = singleAnn.fill !== null;
    const dashed = singleAnn.dash.length > 0;
    const canFill = singleAnn.type === 'rect' || singleAnn.type === 'ellipse' || singleAnn.type === 'polygon';
    content = (
      <>
        <ColorPicker
          value={singleAnn.stroke}
          options={ANNOTATION_PALETTE}
          onChange={(c) => {
            patch('修改标注颜色', (a) => {
              a.stroke = c;
              if (a.fill) a.fill = withAlpha(c, 0.16);
            });
            setStyle({ stroke: c });
          }}
        />
        <span className="sep" />
        <WidthPicker
          value={singleAnn.strokeWidth}
          onChange={(w) => {
            patch('修改线宽', (a) => {
              a.strokeWidth = w;
            });
            setStyle({ strokeWidth: w });
          }}
        />
        <span className="sep" />
        <IconButton
          size="sm"
          label="虚线"
          tip="虚线 / 实线"
          active={dashed}
          onClick={() => {
            const dash = dashed ? [] : [10, 7];
            patch('切换虚线', (a) => {
              a.dash = [...dash];
            });
            setStyle({ dash });
          }}
        >
          <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
            <line x1="2" y1="9.5" x2="17" y2="9.5" stroke="currentColor" strokeWidth="2" strokeDasharray={dashed ? '0' : '4 3'} strokeLinecap="round" />
          </svg>
        </IconButton>
        {canFill && (
          <IconButton
            size="sm"
            label="填充"
            tip="极淡填充"
            active={hasFill}
            onClick={() => {
              const fill = hasFill ? null : withAlpha(singleAnn.stroke, 0.16);
              patch('切换填充', (a) => {
                a.fill = fill;
              });
              setStyle({ fill });
            }}
          >
            <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
              <rect x="3" y="3" width="13" height="13" rx="2.5" fill={hasFill ? 'currentColor' : 'none'} fillOpacity="0.34" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </IconButton>
        )}
        <span className="sep" />
        <IconButton size="sm" label="复制" tip="复制并偏移 ⌘D" onClick={duplicateSelected}>
          <Copy size={18} strokeWidth={1.7} />
        </IconButton>
        <IconButton size="sm" label="删除" tip="删除 ⌫" tone="danger" onClick={deleteSelected}>
          <Trash size={18} strokeWidth={1.7} />
        </IconButton>
      </>
    );
  } else {
    content = (
      <>
        <span className="group-label">{selection.length} 个对象</span>
        <span className="sep" />
        <IconButton size="sm" label="复制" tip="复制并偏移 ⌘D" onClick={duplicateSelected}>
          <Copy size={18} strokeWidth={1.7} />
        </IconButton>
        <IconButton size="sm" label="删除" tip="删除 ⌫" tone="danger" onClick={deleteSelected}>
          <Trash size={18} strokeWidth={1.7} />
        </IconButton>
      </>
    );
  }

  if (!content) return null;

  return (
    <div
      className="selection-toolbar"
      style={{
        left: left + width / 2,
        top: above ? top - 50 : top + height + 12,
        transform: 'translateX(-50%)',
      }}
    >
      {content}
    </div>
  );
}

export type { SelectionRef };
