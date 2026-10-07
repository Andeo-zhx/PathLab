import { X } from 'lucide-react';
import { useUi } from '../store/uiStore';
import { IconButton } from './IconButton';
import { MOD, MOD_SHIFT } from '../lib/platform';

interface ShortcutSection {
  rows: [string, string][];
}

function sections(): ShortcutSection[] {
  return [
    {
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
      rows: [
        ['删除', 'Delete'],
        ['复制对象', `${MOD}C`],
        ['粘贴对象', `${MOD}V`],
        ['复制并偏移', `${MOD}D`],
        ['全选', `${MOD}A`],
        ['移动图片时对齐吸附', 'Drag'],
        ['保持比例缩放', 'Shift + Drag'],
        ['自由缩放（图片）', 'Alt + Drag'],
      ],
    },
    {
      rows: [
        ['撤销', `${MOD}Z`],
        ['重做', `${MOD_SHIFT}Z`],
        ['保存工程', `${MOD}S`],
        ['适应全部', `${MOD}0`],
        ['实际大小 100%', `${MOD}1`],
        ['导出 PNG', `${MOD}E`],
        ['临时平移', 'Space + Drag'],
        ['缩放画布', 'Wheel'],
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
          <div style={{ flex: 1 }} />
          <IconButton size="sm" label="关闭" tip="关闭" onClick={() => setOpen(false)}>
            <X size={18} strokeWidth={1.8} />
          </IconButton>
        </div>
        <div className="dialog-body" style={{ paddingBottom: 22 }}>
          {sections().map((sec, index) => (
            <div className="shortcut-section" key={index}>
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
        </div>
      </div>
    </div>
  );
}
