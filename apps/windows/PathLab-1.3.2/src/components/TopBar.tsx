import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  FilePlus,
  FolderOpen,
  ImagePlus,
  Keyboard,
  Save,
  Trash2,
  Type,
} from 'lucide-react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import { IconButton } from './IconButton';
import { runCommand } from '../lib/commands';
import { MOD } from '../lib/platform';

function MoreMenu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const annotationsVisible = useUi((s) => s.annotationsGloballyVisible);
  const selectedCount = useUi((s) => s.selection.length);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(target) && !target.closest('[data-menu-trigger="more"]')) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const quickAction = (id: Parameters<typeof runCommand>[0], label: string, Icon: typeof Eye) => (
    <button
      key={id}
      type="button"
      className="menu-quick-action"
      aria-label={label}
      title={label}
      data-tip={label}
      data-tip-side="bottom"
      onClick={() => {
        onClose();
        runCommand(id);
      }}
    >
      <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );

  const settingsAction = (key: string, label: string, Icon: typeof Eye, action: () => void) => (
    <button
      key={key}
      type="button"
      className="menu-quick-action"
      aria-label={label}
      title={label}
      data-tip={label}
      data-tip-side="bottom"
      onClick={() => {
        onClose();
        action();
      }}
    >
      <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );

  return (
    <div ref={ref} className="menu" style={{ right: 14, top: 'calc(var(--topbar-h) - 6px)', left: 'auto' }}>
      <div className="menu-quick-actions" role="group" aria-label="工程操作">
        {quickAction('new', '新建工程', FilePlus)}
        {quickAction('open', '打开工程', FolderOpen)}
        {quickAction('toggleAllAnnotations', annotationsVisible ? '隐藏所有标注' : '显示所有标注', annotationsVisible ? EyeOff : Eye)}
      </div>
      <div className="menu-sep" />
      <div className="menu-quick-actions menu-icon-actions" role="group" aria-label="其他工具">
        {selectedCount > 0 && quickAction('delete', '删除选中对象', Trash2)}
        {settingsAction('shortcuts', '快捷键', Keyboard, () => runCommand('shortcuts'))}
        {settingsAction('text-style', '默认文字样式', Type, () => useUi.getState().setTextSettingsOpen(true))}
      </div>
    </div>
  );
}

export function TopBar() {
  const title = useProject((s) => s.project.title);
  const setTitle = useProject((s) => s.setTitle);
  const savedFlash = useUi((s) => s.savedFlash);
  const moreOpen = useUi((s) => s.moreMenuOpen);
  const setMoreOpen = useUi((s) => s.setMoreMenuOpen);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  const commit = () => {
    setEditing(false);
    const next = draft.trim() || '未命名工程';
    if (next !== title) setTitle(next);
  };

  return (
    <header className="topbar">
      <div className="brand" aria-label="PathLab">
        <span className="brand-mark" aria-hidden>
          <img src="/pathlab-eye-logo.png" alt="" draggable={false} />
        </span>
        <span className="brand-name">PathLab</span>
      </div>

      <div className="title-block">
        {editing ? (
          <input
            className="title-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(title);
                setEditing(false);
              }
            }}
            aria-label="工程名称"
          />
        ) : (
          <button
            type="button"
            className="project-title"
            onClick={() => {
              setDraft(title);
              setEditing(true);
            }}
            data-tip="点击重命名工程"
            data-tip-side="bottom"
          >
            {title}
          </button>
        )}
        <span
          className={`save-flash ${savedFlash ? 'on' : ''}`}
          role="status"
          aria-label="已保存"
          title="已保存"
          data-tip="已保存"
        >
          <Check size={16} strokeWidth={2.2} aria-hidden="true" />
        </span>
      </div>

      <div className="topbar-actions">
        <IconButton label="导入图片" tip="导入图片" onClick={() => runCommand('importImages')}>
          <ImagePlus size={20} strokeWidth={1.7} />
        </IconButton>
        <IconButton label="保存工程" tip={`保存工程 ${MOD}S`} onClick={() => runCommand('save')}>
          <Save size={20} strokeWidth={1.7} />
        </IconButton>
        <IconButton label="导出" tip={`导出 ${MOD}E`} onClick={() => runCommand('exportCanvas')}>
          <Download size={20} strokeWidth={1.7} />
        </IconButton>
        <IconButton
          label="更多"
          tip={moreOpen ? undefined : '更多'}
          data-menu-trigger="more"
          active={moreOpen}
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <Ellipsis size={20} strokeWidth={1.7} />
        </IconButton>
      </div>

      {moreOpen && <MoreMenu onClose={() => setMoreOpen(false)} />}
    </header>
  );
}
