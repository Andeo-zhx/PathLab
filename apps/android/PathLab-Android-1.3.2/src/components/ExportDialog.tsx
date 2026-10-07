import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, FileText, Image, LoaderCircle, StretchVertical, X } from 'lucide-react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import { computeExportLayout, PAGE_MARGIN, PAGE_TITLE_H, type ExportLayout } from '../lib/exportLayout';
import { estimatePngSize, formatFileSize } from '../lib/exportSizeEstimate';
import { downloadBlob, safeFileName } from '../lib/projectFile';
import { ExportStage } from './ExportStage';
import { ExportLayoutEditor } from './ExportLayoutEditor';
import { IconButton } from './IconButton';
import { isIOSApp, isNativeApp } from '../lib/native';
import { createDiagnosticOperationId, emitDiagnosticResponse } from '../lib/diagnostics';

function getObservationText(value: unknown): string {
  if (Array.isArray(value)) return value.map(getObservationText).join('');
  if (!value || typeof value !== 'object') return '';

  const node = value as { type?: unknown; text?: unknown; content?: unknown };
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (node.type === 'hardBreak') return '\n';
  const content = getObservationText(node.content);
  return ['paragraph', 'heading', 'listItem'].includes(String(node.type)) ? `${content}\n` : content;
}

export function ExportDialog() {
  const config = useUi((s) => s.exportConfig);
  const patch = useUi((s) => s.patchExport);
  const closeStore = useUi((s) => s.closeExport);
  const toast = useUi((s) => s.toast);
  const project = useProject((s) => s.project);
  const [pageLayoutDraft, setPageLayoutDraft] = useState<{ key: string; layout: ExportLayout } | null>(null);
  const [renderLayout, setRenderLayout] = useState<ExportLayout | null>(null);
  const [busy, setBusy] = useState(false);
  const exportDiagnostic = useRef<{ operationId: string; startedAt: number; mode: 'canvas' | 'page'; scale: number } | null>(null);

  const close = useCallback(() => {
    setPageLayoutDraft(null);
    setRenderLayout(null);
    setBusy(false);
    closeStore();
  }, [closeStore]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, busy]);

  const observationText = getObservationText(project.textDocument);
  const includeText = observationText.trim().length > 0;
  const layoutKey = config?.mode === 'page'
    ? `${config.pageSize}|${includeText}|${observationText}|${project.title}|${project.images.length}|${project.annotations.length}|${project.magnifiers.length}`
    : '';
  const pageLayout = pageLayoutDraft?.key === layoutKey ? pageLayoutDraft.layout : null;
  const layout = config?.mode === 'page'
    ? pageLayout ?? computeExportLayout(project, 'page', config.pageSize, config.scale, config.transparent, includeText)
    : null;

  if (!config) return null;

  const start = () => {
    const operationId = createDiagnosticOperationId('canvas-export');
    const startedAt = Date.now();
    emitDiagnosticResponse({ operationId, operation: 'canvas-export', phase: 'start', exportMode: config.mode, scale: config.scale });
    if (!project.images.length) {
      emitDiagnosticResponse({ operationId, operation: 'canvas-export', phase: 'failure', durationMs: Date.now() - startedAt, reason: 'no-images', exportMode: config.mode, scale: config.scale });
      toast('画布上还没有图片', 'error');
      return;
    }
    const exportLayout =
      config.mode === 'canvas'
        ? computeExportLayout(project, 'canvas', config.pageSize, config.scale, config.transparent, includeText)
        : layout;
    if (!exportLayout) {
      emitDiagnosticResponse({ operationId, operation: 'canvas-export', phase: 'failure', durationMs: Date.now() - startedAt, reason: 'unknown', exportMode: config.mode, scale: config.scale });
      return;
    }
    exportDiagnostic.current = { operationId, startedAt, mode: config.mode, scale: config.scale };
    setBusy(true);
    setRenderLayout({ ...exportLayout, scale: config.scale });
  };

  const finish = async (image: Blob) => {
    const diagnostic = exportDiagnostic.current;
    const suffix = config.mode === 'canvas' ? `画布@${config.scale}x` : `整页图文@${config.scale}x`;
    try {
      await downloadBlob(image, `${safeFileName(project.title)}_${suffix}.png`);
    } catch {
      if (diagnostic) emitDiagnosticResponse({ operationId: diagnostic.operationId, operation: 'canvas-export', phase: 'failure', durationMs: Date.now() - diagnostic.startedAt, reason: 'share-failed', bytes: image.size, exportMode: diagnostic.mode, scale: diagnostic.scale });
      exportDiagnostic.current = null;
      setRenderLayout(null);
      setBusy(false);
      toast('无法写入或分享导出文件，请检查可用空间后重试', 'error');
      return;
    }
    if (diagnostic) emitDiagnosticResponse({ operationId: diagnostic.operationId, operation: 'canvas-export', phase: 'success', durationMs: Date.now() - diagnostic.startedAt, bytes: image.size, exportMode: diagnostic.mode, scale: diagnostic.scale });
    exportDiagnostic.current = null;
    setRenderLayout(null);
    setBusy(false);
    close();
    toast(
      isIOSApp()
        ? 'PNG 已存入“文件”>“我的 iPad”>“PathLab”>“Exports”，分享面板也已打开'
        : isNativeApp()
          ? '已打开分享面板，可保存或分享 PNG'
          : '已导出 PNG',
      'success',
    );
  };

  const fail = () => {
    const diagnostic = exportDiagnostic.current;
    if (diagnostic) emitDiagnosticResponse({ operationId: diagnostic.operationId, operation: 'canvas-export', phase: 'failure', durationMs: Date.now() - diagnostic.startedAt, reason: 'unknown', exportMode: diagnostic.mode, scale: diagnostic.scale });
    exportDiagnostic.current = null;
    setRenderLayout(null);
    setBusy(false);
    toast('导出失败；可降低倍率后重试', 'error');
  };

  const updateLayout = (next: ExportLayout) => {
    const boardBottom = next.blockY + next.contentRect.height * next.blockScale;
    const textBottom = next.textY + (next.textLayout?.height ?? 0);
    const contentBottom = Math.max(next.titleY + PAGE_TITLE_H, boardBottom, textBottom);
    setPageLayoutDraft({
      key: layoutKey,
      layout: {
        ...next,
        overflow: next.pageSize === 'a4' && contentBottom + PAGE_MARGIN > next.pageHeight,
      },
    });
  };

  const activeLayout = config.mode === 'canvas'
    ? computeExportLayout(project, 'canvas', config.pageSize, config.scale, config.transparent, includeText)
    : layout;
  const estimate = activeLayout
    ? {
        width: Math.round(activeLayout.pageWidth * config.scale),
        height: Math.round(activeLayout.pageHeight * config.scale),
        fileSize: estimatePngSize(project, activeLayout, config.scale),
        overlap: Boolean(
          activeLayout.mode === 'page' &&
          activeLayout.textLayout &&
            activeLayout.blockX < activeLayout.textX + activeLayout.textWidth &&
            activeLayout.blockX + activeLayout.contentRect.width * activeLayout.blockScale > activeLayout.textX &&
            activeLayout.blockY < activeLayout.textY + (activeLayout.textLayout?.height ?? 0) &&
            activeLayout.blockY + activeLayout.contentRect.height * activeLayout.blockScale > activeLayout.textY,
        ),
        overflow: activeLayout.overflow,
      }
    : null;

  return (
    <div className="dialog-scrim" onMouseDown={(event) => event.target === event.currentTarget && !busy && close()}>
      <div className={`dialog export-dialog-layout ${config.mode === 'page' ? 'is-page' : 'is-canvas'}`} role="dialog" aria-modal="true" aria-label="导出">
        <div className="dialog-head">
          <div className="export-mode-icons" role="group" aria-label="导出模式">
            <button
              type="button"
              className="export-mode-icon"
              aria-label="导出白板"
              title="导出白板"
              aria-pressed={config.mode === 'canvas'}
              onClick={() => patch({ mode: 'canvas' })}
            >
              <Image size={18} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="export-mode-icon"
              aria-label="A4 页面排版"
              title="A4 页面排版"
              aria-pressed={config.mode === 'page'}
              onClick={() => patch({ mode: 'page', scale: Math.max(8, config.scale) })}
            >
              <FileText size={18} strokeWidth={1.8} />
            </button>
          </div>
          <div style={{ flex: 1 }} />
          <IconButton size="sm" label="关闭" tip="关闭" onClick={close} disabled={busy}>
            <X size={18} strokeWidth={1.8} />
          </IconButton>
        </div>

        <div className="export-dialog-body">
          <div className="export-toolbar">
            {config.mode === 'page' && (
              <div className="export-page-options">
                <div className="segmented" role="group" aria-label="页面尺寸">
                  <button type="button" aria-pressed={config.pageSize === 'a4'} onClick={() => patch({ pageSize: 'a4' })}>
                    A4
                  </button>
                  <button
                    type="button"
                    aria-pressed={config.pageSize === 'auto'}
                    onClick={() => patch({ pageSize: 'auto' })}
                    aria-label="自适应长图"
                    title="自适应长图"
                  >
                    <StretchVertical size={16} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            <div className="segmented export-scale-options" role="group" aria-label="输出倍率">
                {[1, 2, 4, 6, 8].map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    aria-pressed={config.scale === scale}
                    onClick={() => patch({ scale })}
                  >
                    {`${scale}×`}
                  </button>
                ))}
            </div>

          </div>

          {config.mode === 'page' && layout && (
            <ExportLayoutEditor project={project} layout={layout} onChange={updateLayout} />
          )}

          {estimate && (
            <div className="export-resolution-meta" aria-live="polite">
              <span>{estimate.width.toLocaleString('en-US')} × {estimate.height.toLocaleString('en-US')} px</span>
              <span aria-hidden="true">·</span>
              <span>{formatFileSize(estimate.fileSize.minBytes)}–{formatFileSize(estimate.fileSize.maxBytes)}</span>
              {estimate.overlap && <span className="export-warn" role="img" aria-label="Text and image areas overlap" title="Text and image areas overlap"><AlertTriangle size={15} /></span>}
              {estimate.overflow && <span className="export-warn" role="img" aria-label="Content may exceed the page" title="Content may exceed the page"><AlertTriangle size={15} /></span>}
            </div>
          )}
        </div>

        <div className="dialog-foot">
          <button type="button" className="export-confirm-icon" onClick={start} disabled={busy} aria-label={busy ? '正在渲染' : '导出 PNG'} title={busy ? '正在渲染' : '导出 PNG'}>
            {busy ? <LoaderCircle size={20} className="export-spinner" /> : <Download size={19} strokeWidth={1.9} />}
          </button>
        </div>
      </div>

      {renderLayout && <ExportStage project={project} layout={renderLayout} onRendered={finish} onError={fail} />}
    </div>
  );
}
