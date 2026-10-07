import { Circle, Hand, Lasso, Minus, MousePointer2, Pencil, Scan, Square, Type } from 'lucide-react';
import { MoveUpRight } from 'lucide-react';
import { useUi } from '../store/uiStore';
import type { Tool } from '../lib/types';

interface ToolDef {
  id: Tool;
  label: string;
  key: string;
  Icon: typeof Circle;
}

const GROUP_A: ToolDef[] = [
  { id: 'select', label: '鼠标选择', key: 'V', Icon: MousePointer2 },
  { id: 'hand', label: '抓手漫游', key: 'H', Icon: Hand },
];
const GROUP_B: ToolDef[] = [
  { id: 'rect', label: '矩形', key: 'R', Icon: Square },
  { id: 'ellipse', label: '椭圆', key: 'O', Icon: Circle },
  { id: 'polygon', label: '多边形套索', key: 'P', Icon: Lasso },
  { id: 'freehand', label: '自由轮廓', key: 'F', Icon: Pencil },
];
const GROUP_C: ToolDef[] = [
  { id: 'arrow', label: '箭头', key: 'A', Icon: MoveUpRight },
  { id: 'line', label: '直线', key: 'L', Icon: Minus },
];
const GROUP_D: ToolDef[] = [
  { id: 'text', label: '文字', key: 'T', Icon: Type },
  { id: 'magnifier', label: '圆形放大引用', key: 'M', Icon: Scan },
];

export function ToolRail() {
  const tool = useUi((s) => s.tool);
  const setTool = useUi((s) => s.setTool);

  const renderGroup = (list: ToolDef[]) =>
    list.map(({ id, label, key, Icon }) => (
      <button
        key={id}
        type="button"
        className="tool-btn"
        aria-label={label}
        aria-pressed={tool === id}
        data-tip={`${label}  ${key}`}
        data-tip-side="right"
        onClick={() => setTool(id)}
      >
        <Icon size={21} strokeWidth={1.6} aria-hidden />
      </button>
    ));

  return (
    <div className="tool-rail" role="toolbar" aria-label="标注工具">
      {renderGroup(GROUP_A)}
      <div className="rail-gap" />
      {renderGroup(GROUP_B)}
      <div className="rail-gap" />
      {renderGroup(GROUP_C)}
      <div className="rail-gap" />
      {renderGroup(GROUP_D)}
    </div>
  );
}
