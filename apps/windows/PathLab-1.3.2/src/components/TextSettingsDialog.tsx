import { useEffect, type CSSProperties } from 'react';
import { ChevronDown, RotateCcw, Type, X } from 'lucide-react';
import {
  CHINESE_FONT_CHOICES,
  DEFAULT_CHINESE_FONT_FAMILY,
  DEFAULT_ENGLISH_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  ENGLISH_FONT_CHOICES,
} from '../lib/textPreferences';
import { DEFAULT_ANNOTATION_COLOR } from '../lib/colors';
import { useStyle } from '../store/styleStore';
import { useUi } from '../store/uiStore';
import { IconButton } from './IconButton';

export function TextSettingsDialog() {
  const open = useUi((state) => state.textSettingsOpen);
  const setOpen = useUi((state) => state.setTextSettingsOpen);
  const fontFamily = useStyle((state) => state.fontFamily);
  const chineseFontFamily = useStyle((state) => state.chineseFontFamily);
  const englishFontFamily = useStyle((state) => state.englishFontFamily);
  const fontSize = useStyle((state) => state.fontSize);
  const setStyle = useStyle((state) => state.setStyle);
  const setFontPair = useStyle((state) => state.setFontPair);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="dialog-scrim text-settings-scrim" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <section className="dialog text-settings-dialog" role="dialog" aria-modal="true" aria-label="默认文字样式">
        <div className="dialog-head text-settings-head">
          <span className="text-settings-icon" aria-hidden="true"><Type size={19} strokeWidth={1.8} /></span>
          <div className="text-settings-heading">
            <h2>默认文字样式</h2>
            <p>只影响之后新建的标注，不改动现有文字</p>
          </div>
          <IconButton size="sm" label="关闭" tip="关闭" onClick={() => setOpen(false)}>
            <X size={18} strokeWidth={1.8} />
          </IconButton>
        </div>

        <div className="dialog-body text-settings-body">
          <div className="text-settings-font-pair">
            <div className="field-group">
              <div className="text-settings-label-row">
                <label className="field-label" htmlFor="text-default-chinese-font">中文字体</label>
              </div>
              <div className="text-settings-select-wrap">
                <select
                  id="text-default-chinese-font"
                  className="text-settings-select"
                  value={chineseFontFamily}
                  onChange={(event) => setFontPair({ chineseFontFamily: event.target.value })}
                >
                  {CHINESE_FONT_CHOICES.map((choice) => (
                    <option key={choice.family} value={choice.family}>{choice.label}</option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </div>
            </div>
            <div className="field-group">
              <div className="text-settings-label-row">
                <label className="field-label" htmlFor="text-default-english-font">英文字体</label>
              </div>
              <div className="text-settings-select-wrap">
                <select
                  id="text-default-english-font"
                  className="text-settings-select"
                  value={englishFontFamily}
                  onChange={(event) => setFontPair({ englishFontFamily: event.target.value })}
                >
                  {ENGLISH_FONT_CHOICES.map((choice) => (
                    <option key={choice.family} value={choice.family}>{choice.label}</option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </div>
            </div>
          </div>

          <div className="field-group">
            <div className="text-settings-label-row text-settings-size-label">
              <label className="field-label" htmlFor="text-default-size">默认字号</label>
              <span>10–80 px</span>
            </div>
            <div className="text-settings-size-row">
              <input
                id="text-default-size"
                type="range"
                min="10"
                max="80"
                step="1"
                value={fontSize}
                style={{ '--range-progress': `${((fontSize - 10) / 70) * 100}%` } as CSSProperties}
                onChange={(event) => setStyle({ fontSize: Number(event.target.value) })}
              />
              <label className="text-settings-number-wrap">
                <input
                  className="text-settings-number"
                  type="number"
                  min="10"
                  max="80"
                  step="1"
                  value={fontSize}
                  aria-label="默认字号数值"
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) setStyle({ fontSize: Math.min(80, Math.max(10, value)) });
                  }}
                />
                <span>px</span>
              </label>
            </div>
          </div>

          <div className="text-settings-preview-card">
            <div className="text-settings-preview-head">
              <span className="text-settings-preview-dot" />
              <span>实时预览</span>
              <span className="text-settings-preview-meta">双语标注</span>
            </div>
            <div className="text-settings-preview" style={{ fontFamily, fontSize }}>
              病理图像观察标注 <span>·</span> Pathology annotation
            </div>
          </div>
        </div>

        <div className="dialog-foot text-settings-foot">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setFontPair({
                chineseFontFamily: DEFAULT_CHINESE_FONT_FAMILY,
                englishFontFamily: DEFAULT_ENGLISH_FONT_FAMILY,
              });
              setStyle({ fontSize: DEFAULT_TEXT_FONT_SIZE, stroke: DEFAULT_ANNOTATION_COLOR });
            }}
          >
            <RotateCcw size={15} /> 恢复默认
          </button>
          <button type="button" className="btn primary text-settings-done" onClick={() => setOpen(false)}>完成</button>
        </div>
      </section>
    </div>
  );
}
