import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { useProject } from './store/projectStore';
import { useUi } from './store/uiStore';
import { runCommand } from './lib/commands';
import { hasClipboard, importFiles, importFromClipboard, openProjectFromFile, pasteObjects } from './lib/actions';
import { restoreLatestDraft, startAutosave } from './store/autosave';
import { getDisplayInfo, zoomOutHint, EMBEDDED_HINT } from './lib/display';
import { isNativeApp } from './lib/native';
import { watchForOpenedPathLabProject } from './lib/nativeFiles';
import type { Tool } from './lib/types';
import { createDiagnosticOperationId, emitDiagnosticResponse } from './lib/diagnostics';
import {
  getInteractionRecordingEnabled,
  setInteractionRecordingEnabled,
  subscribeToInteractionRecordingPreference,
} from './lib/interactionRecordingPreference';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  r: 'rect',
  o: 'ellipse',
  p: 'polygon',
  f: 'freehand',
  a: 'arrow',
  l: 'line',
  t: 'text',
  m: 'magnifier',
};

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export default function App() {
  /* Interaction recording is opt-in and stays idle until the user enables it. */
  useEffect(() => {
    let disposed = false;
    let loading = false;
    let stopRecording: (() => void) | undefined;

    const syncRecording = async () => {
      if (!getInteractionRecordingEnabled()) {
        stopRecording?.();
        stopRecording = undefined;
        return;
      }
      if (loading || stopRecording) return;

      loading = true;
      try {
        const { startInteractionRecording } = await import('./lib/interactionLog');
        if (disposed || !getInteractionRecordingEnabled()) return;
        stopRecording = startInteractionRecording();
      } catch {
        setInteractionRecordingEnabled(false);
        if (!disposed) useUi.getState().toast('交互记录模块未能启动', 'error');
      } finally {
        loading = false;
      }
    };

    const unsubscribe = subscribeToInteractionRecordingPreference(() => void syncRecording());
    void syncRecording();
    return () => {
      disposed = true;
      unsubscribe();
      stopRecording?.();
    };
  }, []);

  /* App startup, autosave, and native file listeners. */
  useEffect(() => {
    let disposed = false;
    let stopWatchingProjects: (() => void) | undefined;
    const stop = startAutosave();
    void (async () => {
      if (disposed) return;

      if (isNativeApp()) {
        void watchForOpenedPathLabProject(
          (file) => (disposed ? undefined : openProjectFromFile(file)),
          (message) => {
            if (!disposed) useUi.getState().toast(message, 'error');
          },
        ).then((stopWatching) => {
          stopWatchingProjects = stopWatching;
          if (disposed) stopWatching();
        }).catch((error: unknown) => {
          if (!disposed) useUi.getState().toast(error instanceof Error ? error.message : '无法监听 Files 中打开的工程。', 'error');
        });
      }

      const restoreOperationId = createDiagnosticOperationId('draft-restore');
      const restoreStartedAt = Date.now();
      emitDiagnosticResponse({ operationId: restoreOperationId, operation: 'draft-restore', phase: 'start' });
      void restoreLatestDraft().then((restored) => {
        emitDiagnosticResponse({
          operationId: restoreOperationId,
          operation: 'draft-restore',
          phase: restored ? 'success' : 'no-change',
          durationMs: Date.now() - restoreStartedAt,
        });
        if (restored && !disposed) useUi.getState().toast('已恢复上次未保存的草稿', 'info');
      }).catch(() => {
        emitDiagnosticResponse({ operationId: restoreOperationId, operation: 'draft-restore', phase: 'failure', durationMs: Date.now() - restoreStartedAt, reason: 'invalid-draft' });
      });
    })();
    return () => {
      disposed = true;
      stopWatchingProjects?.();
      stop();
    };
  }, []);

  /* 显示环境自检：页面被缩小 / 处于嵌入式预览时给出一次性提示 */
  useEffect(() => {
    const info = getDisplayInfo();
    if (info.zoomedOut) {
      useUi.getState().toast(zoomOutHint(info), 'info');
    } else if (info.embedded) {
      useUi.getState().toast(EMBEDDED_HINT, 'info');
    }
  }, []);

  /* 文件导入事件（拖放 / 文件选择器） */
  useEffect(() => {
    const onImport = (e: Event) => {
      const detail = (e as CustomEvent<File[]>).detail;
      if (detail?.length) void importFiles(detail, undefined, 'drop');
    };
    window.addEventListener('pathlab:import-files', onImport);
    return () => window.removeEventListener('pathlab:import-files', onImport);
  }, []);

  /* 粘贴图片（截图 / 复制的图片） */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditor = target && (target.tagName === 'TEXTAREA' || target.isContentEditable);
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      void importFiles(files, undefined, 'paste');
      void inEditor;
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  /* 全局快捷键 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const mod = e.metaKey || e.ctrlKey;
      const typing = isTypingTarget(e.target);
      const k = e.key.toLowerCase();

      if (mod) {
        if (k === 's') {
          e.preventDefault();
          runCommand('save');
          return;
        }
        if (e.key === '0') {
          e.preventDefault();
          runCommand('fit');
          return;
        }
        if (e.key === '1') {
          e.preventDefault();
          runCommand('zoom100');
          return;
        }
        if (k === 'e') {
          e.preventDefault();
          runCommand('exportCanvas');
          return;
        }
        if (typing) return;
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) useProject.getState().redo();
          else useProject.getState().undo();
          return;
        }
        if (k === 'y') {
          e.preventDefault();
          useProject.getState().redo();
          return;
        }
        if (k === 'c') {
          e.preventDefault();
          runCommand('copy');
          return;
        }
        if (k === 'd') {
          e.preventDefault();
          runCommand('duplicate');
          return;
        }
        if (k === 'a') {
          e.preventDefault();
          runCommand('selectAll');
          return;
        }
        if (k === 'v') {
          e.preventDefault();
          if (hasClipboard()) pasteObjects();
          else
            void importFromClipboard().then((ok) => {
              if (!ok) useUi.getState().toast('剪贴板内容未导入，请确认剪贴板包含可用内容后重试', 'info');
            });
          return;
        }
        if (k === 'o') {
          e.preventDefault();
          runCommand('open');
          return;
        }
        if (k === 'n') {
          e.preventDefault();
          runCommand('new');
        }
        return;
      }

      if (typing) return;

      if (e.key === ' ') {
        e.preventDefault();
        ui.setSpace(true);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ui.editingTextId || ui.croppingImageId) return;
        e.preventDefault();
        runCommand('delete');
        return;
      }
      if (e.key === 'Escape') return;

      const tool = TOOL_KEYS[k];
      if (tool && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        ui.setTool(tool);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') useUi.getState().setSpace(false);
    };
    const onBlur = () => useUi.getState().setSpace(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return <AppShell />;
}
