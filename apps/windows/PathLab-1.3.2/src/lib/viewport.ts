/** 画布可视区尺寸（由 CanvasWorkspace 维护），供适应视图等命令使用 */
export const viewport = { width: 1000, height: 700 };

/** 由 CanvasWorkspace 注入的视图命令，供工具栏/菜单调用 */
export const viewCommands = {
  fit: () => {},
  zoom100: () => {},
  zoomTo: (_z: number) => {},
};
