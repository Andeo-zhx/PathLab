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
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [panelVisible, setPanelVisible] = useState(() => window.innerWidth >= NARROW);
  const narrow = viewportWidth < NARROW;
  const panelWidth = Math.max(0, Math.min(writingWidth, viewportWidth - 24));
  const dragging = useRef(false);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const hidePanel = useCallback(() => {
    document.querySelector<HTMLElement>('.writing-panel [contenteditable="true"]:focus')?.blur();
    setPanelVisible(false);
  }, []);

  const onSplitDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const target = e.currentTarget as HTMLElement;
      const pointerId = e.pointerId;
      target.setPointerCapture(pointerId);
      target.classList.add('dragging');
      const onMove = (ev: MouseEvent) => {
        if ('pointerId' in ev && ev.pointerId !== pointerId) return;
        const region = target.closest('.writing-region');
        const rightEdge = region?.getBoundingClientRect().right ?? window.innerWidth - 14;
        setWritingWidth(rightEdge - ev.clientX);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        target.classList.remove('dragging');
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [setWritingWidth],
  );

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <div className="canvas-region">
          <CanvasWorkspace />
          <ToolRail />
          {!panelVisible && (
            <button
              type="button"
              className="drawer-toggle"
              aria-label="打开观察记录"
              data-tip="观察记录"
              data-tip-side="left"
              onClick={() => setPanelVisible(true)}
            >
              <NotebookPen size={19} strokeWidth={1.7} />
            </button>
          )}
        </div>

        {narrow && panelVisible && <div className="drawer-scrim" onClick={hidePanel} />}

        <div
          className={`writing-region ${narrow ? (panelVisible ? 'open' : 'closed') : (panelVisible ? '' : 'hidden')}`}
          style={{ width: panelWidth, flexBasis: panelWidth }}
        >
          <div
            className="split-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整观察记录宽度"
            aria-valuemin={Math.min(340, viewportWidth - 24)}
            aria-valuemax={Math.min(760, viewportWidth - 24)}
            aria-valuenow={panelWidth}
            tabIndex={0}
            onPointerDown={onSplitDown}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setWritingWidth(writingWidth + 16);
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setWritingWidth(writingWidth - 16);
              }
            }}
          />
          <WritingPanel onHide={hidePanel} />
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
