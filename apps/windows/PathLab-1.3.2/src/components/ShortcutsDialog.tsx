import { X } from 'lucide-react';
import { useUi } from '../store/uiStore';
import { IconButton } from './IconButton';
import { MOD, MOD_SHIFT } from '../lib/platform';
import { getDisplayInfo, zoomOutHint, EMBEDDED_HINT } from '../lib/display';

interface ShortcutSection {
  title: string;
  rows: [string, string][];
}

function sections(): ShortcutSection[] {
  return [
    {
      title: '工具',
      rows: [
        ['鼠标选择对象', 'V'],
        ['抓手漫游画布', 'H'],
        ['矩形', 'R'],
        ['椭圆', 'O'],
        ['多边形套索', 'P'],
        ['自由轮廓', 'F'],
        ['箭头', 'A'],
        ['直线', 'L'],
        ['文字', 'T'],
        ['圆形放大引用', 'M'],
      ],
    },
    {
      title: '对象',
      rows: [
        ['删除', 'Delete'],
        ['复制对象', `${MOD}C`],
        ['粘贴对象', `${MOD}V`],
        ['复制并偏移', `${MOD}D`],
        ['全选', `${MOD}A`],
        ['移动图片时对齐吸附', '拖动'],
        ['保持比例缩放', 'Shift 拖动'],
        ['自由缩放（图片）', 'Alt 拖动'],
      ],
    },
    {
      title: '视图与工程',
      rows: [
        ['撤销', `${MOD}Z`],
        ['重做', `${MOD_SHIFT}Z`],
        ['保存工程', `${MOD}S`],
        ['适应全部', `${MOD}0`],
        ['实际大小 100%', `${MOD}1`],
        ['导出 PNG', `${MOD}E`],
        ['临时平移', 'Space 拖动'],
        ['缩放画布', '滚轮'],
        ['退出当前模式', 'Esc'],
      ],
    },
  ];
}

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  if (!open) return null;

  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="快捷键">
        <div className="dialog-head">
          <h2>快捷键</h2>
          <span className="dh-sub">界面不常驻显示，只在这里出现</span>
          <div style={{ flex: 1 }} />
          <IconButton size="sm" label="关闭" tip="关闭" onClick={() => setOpen(false)}>
            <X size={18} strokeWidth={1.8} />
          </IconButton>
        </div>
        <div className="dialog-body" style={{ paddingBottom: 22 }}>
          {sections().map((sec) => (
            <div className="field-group" key={sec.title}>
              <span className="field-label">{sec.title}</span>
              <div className="shortcut-grid">
                {sec.rows.map(([label, key]) => (
                  <div className="row" key={label}>
                    <span>{label}</span>
                    <span>{key}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {(() => {
            const info = getDisplayInfo();
            const pct = Math.round(info.devicePixelRatio * 100);
            return (
              <div className="display-note">
                <div className="dn-row">
                  <span>界面显示比例</span>
                  <span>{pct}%（系统缩放 × 浏览器缩放）</span>
                </div>
                {(info.zoomedOut || info.embedded) && (
                  <div className="dn-warn">{info.zoomedOut ? zoomOutHint(info) : EMBEDDED_HINT}</div>
                )}
              </div>
            );
          })()}
          <p style={{ fontSize: 13.5, color: 'var(--ink-3)', margin: '10px 0 0' }}>
            图片与工程保存在本机。翻译使用 DeepSeek 云端服务；点击发送后，当前标注文字会提交给 DeepSeek。API Key 加密保存在本机。
          </p>
        </div>
      </div>
    </div>
  );
}
