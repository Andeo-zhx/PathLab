import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUi } from '../store/uiStore';
import { runCommand, type CommandId } from '../lib/commands';

export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  const close = useUi((s) => s.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu) return;
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 220;
    const x = Math.min(menu.x, window.innerWidth - w - 10);
    const y = Math.min(menu.y, window.innerHeight - h - 10);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = () => close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onScroll, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onScroll);
    };
  }, [menu, close]);

  if (!menu) return null;

  return (
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {menu.items.map((item) =>
        item.separator ? (
          <div key={item.id} className="menu-sep" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`menu-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              close();
              runCommand(item.id as CommandId, menu.target ?? null);
            }}
          >
            <span className="mi-label">{item.label}</span>
            {item.shortcut && <span className="mi-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
