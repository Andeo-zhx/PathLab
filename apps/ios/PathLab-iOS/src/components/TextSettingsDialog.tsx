import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Type, X } from 'lucide-react';
import { CHINESE_FONT_CHOICES, ENGLISH_FONT_CHOICES } from '../lib/textPreferences';
import { useStyle } from '../store/styleStore';
import { useUi } from '../store/uiStore';
import { IconButton } from './IconButton';

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 80;

function clampSize(value: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)));
}

function pointerAngle(event: ReactPointerEvent<HTMLDivElement>): number {
  const bounds = event.currentTarget.getBoundingClientRect();
  return Math.atan2(event.clientY - (bounds.top + bounds.height / 2), event.clientX - (bounds.left + bounds.width / 2)) * 180 / Math.PI;
}

function normalizeDelta(delta: number): number {
  return ((delta + 540) % 360) - 180;
}

function FontSizeKnob({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const drag = useRef<{ pointerId: number; angle: number; value: number } | null>(null);
  const progress = (value - MIN_FONT_SIZE) / (MAX_FONT_SIZE - MIN_FONT_SIZE);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = value + 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = value - 1;
    if (event.key === 'PageUp') next = value + 10;
    if (event.key === 'PageDown') next = value - 10;
    if (event.key === 'Home') next = MIN_FONT_SIZE;
    if (event.key === 'End') next = MAX_FONT_SIZE;
    if (next !== null) {
      event.preventDefault();
      onChange(clampSize(next));
    }
  };

  return (
    <div
      className="font-size-knob"
      role="slider"
      tabIndex={0}
      aria-label="默认字号"
      aria-valuemin={MIN_FONT_SIZE}
      aria-valuemax={MAX_FONT_SIZE}
      aria-valuenow={value}
      aria-valuetext={`${value} px`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, angle: pointerAngle(event), value };
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        const angle = pointerAngle(event);
        const delta = normalizeDelta(angle - drag.current.angle);
        drag.current.angle = angle;
        drag.current.value = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, drag.current.value + delta * (MAX_FONT_SIZE - MIN_FONT_SIZE) / 270));
        onChange(clampSize(drag.current.value));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
      }}
      onLostPointerCapture={() => { drag.current = null; }}
    >
      <svg className="font-size-knob-arcs" viewBox="0 0 56 56" aria-hidden="true">
        <path className="font-size-knob-track" d="M 11.74 11.74 A 23 23 0 1 1 44.26 44.26" pathLength={100} />
        <path
          className="font-size-knob-progress"
          d="M 11.74 11.74 A 23 23 0 1 1 44.26 44.26"
          pathLength={100}
          strokeDasharray={`${progress * 75} 100`}
        />
      </svg>
      <span className="font-size-knob-value">{value}</span>
    </div>
  );
}

export function TextSettingsDialog() {
  const open = useUi((state) => state.textSettingsOpen);
  const setOpen = useUi((state) => state.setTextSettingsOpen);
  const chineseFontFamily = useStyle((state) => state.chineseFontFamily);
  const englishFontFamily = useStyle((state) => state.englishFontFamily);
  const fontSize = useStyle((state) => state.fontSize);
  const setFontPair = useStyle((state) => state.setFontPair);
  const setStyle = useStyle((state) => state.setStyle);

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
    <div className="dialog-scrim" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <section className="dialog text-settings-dialog" role="dialog" aria-modal="true" aria-label="默认文字样式">
        <div className="dialog-head">
          <span className="text-settings-icon" aria-hidden="true"><Type size={17} /></span>
          <h2>默认文字样式</h2>
          <div style={{ flex: 1 }} />
          <IconButton size="sm" label="关闭" tip="关闭" onClick={() => setOpen(false)}>
            <X size={18} strokeWidth={1.8} />
          </IconButton>
        </div>

        <div className="dialog-body text-settings-body">
          <div className="text-settings-font-pair">
            <label className="text-settings-font-field">
              <span>中文</span>
              <select
                className="text-settings-select"
                aria-label="中文字体"
                value={chineseFontFamily}
                onChange={(event) => setFontPair({ chineseFontFamily: event.target.value })}
              >
                {CHINESE_FONT_CHOICES.map((choice) => (
                  <option key={choice.family} value={choice.family}>{choice.label}</option>
                ))}
              </select>
            </label>
            <label className="text-settings-font-field">
              <span>English</span>
              <select
                className="text-settings-select"
                aria-label="英文字体"
                value={englishFontFamily}
                onChange={(event) => setFontPair({ englishFontFamily: event.target.value })}
              >
                {ENGLISH_FONT_CHOICES.map((choice) => (
                  <option key={choice.family} value={choice.family}>{choice.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="font-size-knob-wrap">
            <FontSizeKnob value={fontSize} onChange={(value) => setStyle({ fontSize: value })} />
          </div>
        </div>

        <div className="dialog-foot text-settings-foot">
          <button type="button" className="text-settings-confirm" aria-label="完成" title="完成" onClick={() => setOpen(false)}>
            <Check size={21} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}
