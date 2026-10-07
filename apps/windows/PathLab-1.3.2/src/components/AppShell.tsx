import { useCallback, useEffect, useRef, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { useUi } from '../store/uiStore';
import { TopBar } from './TopBar';
import { ToolRail } from './ToolRail';
import { CanvasWorkspace } from '../canvas/CanvasWorkspace';
import { WritingPanel } from './WritingPanel';
import { ContextMenu } from './ContextMenu';
import { ExportDialog } from './ExportDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Toasts } from './Toasts';
import { TranslationDialog } from './TranslationDialog';
import { TextSettingsDialog } from './TextSettingsDialog';

const NARROW = 980;

export function AppShell() {
  const translationAnnotationId = useUi((s) => s.translationAnnotationId);
  const writingWidth = useUi((s) => s.writingWidth);
  const setWritingWidth = useUi((s) => s.setWritingWidth);
  const drawerOpen = useUi((s) => s.writingDrawerOpen);
  const setDrawerOpen = useUi((s) => s.setWritingDrawer);
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
  const [desktopPanelOpen, setDesktopPanelOpen] = useState(true);
  const dragging = useRef(false);
  const panelOpen = narrow ? drawerOpen : desktopPanelOpen;

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onSplitDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const target = e.currentTarget as HTMLElement;
      target.classList.add('dragging');
      const onMove = (ev: MouseEvent) => {
        setWritingWidth(window.innerWidth - ev.clientX);
      };
      const onUp = () => {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        target.classList.remove('dragging');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [setWritingWidth],
  );

  const hideWritingPanel = useCallback(() => {
    if (narrow) setDrawerOpen(false);
    else setDesktopPanelOpen(false);
  }, [narrow, setDrawerOpen]);

  const showWritingPanel = () => {
    if (narrow) setDrawerOpen(true);
    else setDesktopPanelOpen(true);
  };

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <div className="canvas-region">
          <CanvasWorkspace />
          <ToolRail />
          {!panelOpen && (
            <button
              type="button"
              className="drawer-toggle"
              aria-label="打开观察记录"
              data-tip="观察记录"
              data-tip-side="left"
              onClick={showWritingPanel}
            >
              <NotebookPen size={19} strokeWidth={1.7} />
            </button>
          )}
        </div>

        <div
          className={`writing-region ${narrow ? (drawerOpen ? 'open' : 'closed') : desktopPanelOpen ? '' : 'hidden'}`}
          style={narrow ? undefined : { width: writingWidth, flexBasis: writingWidth }}
        >
          {!narrow && (
            <div
              className="split-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整观察记录宽度"
              onMouseDown={onSplitDown}
            />
          )}
          <WritingPanel onHide={hideWritingPanel} />
          {narrow && drawerOpen && <div className="drawer-scrim" onMouseDown={() => setDrawerOpen(false)} />}
        </div>
      </div>

      <ContextMenu />
      <ExportDialog />
      <ShortcutsDialog />
      <TranslationDialog key={translationAnnotationId ?? 'closed'} />
      <TextSettingsDialog />
      <Toasts />
    </div>
  );
}
