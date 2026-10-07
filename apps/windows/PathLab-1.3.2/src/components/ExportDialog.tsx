import { useCallback, useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import { computeExportLayout, PAGE_MARGIN, PAGE_TITLE_H, type ExportLayout } from '../lib/exportLayout';
import { estimatePngSize, formatFileSize } from '../lib/exportSizeEstimate';
import { downloadBlob, safeFileName } from '../lib/projectFile';
import { ExportStage } from './ExportStage';
import { ExportLayoutEditor } from './ExportLayoutEditor';
import { IconButton } from './IconButton';

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
  const observationText = getObservationText(project.textDocument);
  const includeText = Boolean(config?.includeText && observationText.trim());

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

  const layoutKey = config?.mode === 'page'
    ? `${config.pageSize}|${includeText}|${observationText}|${project.title}|${project.images.length}|${project.annotations.length}|${project.magnifiers.length}`
    : '';
  const pageLayout = pageLayoutDraft?.key === layoutKey ? pageLayoutDraft.layout : null;
  const layout = config?.mode === 'page'
    ? pageLayout ?? computeExportLayout(project, 'page', config.pageSize, config.scale, config.transparent, includeText)
    : null;

  if (!config) return null;

  const start = () => {
    if (!project.images.length) {
      toast('画布上还没有图片', 'error');
      return;
    }
    const exportLayout =
      config.mode === 'canvas'
        ? computeExportLayout(project, 'canvas', config.pageSize, config.scale, config.transparent, includeText)
        : layout;
    if (!exportLayout) return;
    setBusy(true);
    setRenderLayout({ ...exportLayout, scale: config.scale });
  };

  const finish = async (image: Blob) => {
    const suffix = config.mode === 'canvas' ? `画布@${config.scale}x` : `整页图文@${config.scale}x`;
    try {
      await downloadBlob(image, `${safeFileName(project.title)}_${suffix}.png`);
    } catch {
      setRenderLayout(null);
      setBusy(false);
      toast('无法写入导出文件，请检查可用空间后重试', 'error');
      return;
    }
    setRenderLayout(null);
    setBusy(false);
    close();
    toast('已导出 PNG', 'success');
  };

  const fail = () => {
    setRenderLayout(null);
    setBusy(false);
    toast('导出失败；可降低倍率后重试', 'error');
  };

  const resetLayout = () => {
    setPageLayoutDraft({
      key: layoutKey,
      layout: computeExportLayout(project, 'page', config.pageSize, config.scale, config.transparent, includeText),
    });
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
      <div className="dialog export-dialog-layout" role="dialog" aria-modal="true" aria-label="导出与页面排版">
        <div className="dialog-head">
          <h2>导出与排版</h2>
          <span className="dh-sub">矢量重绘，不截屏</span>
          <div style={{ flex: 1 }} />
          <IconButton size="sm" label="关闭" tip="关闭" onClick={close} disabled={busy}>
            <X size={18} strokeWidth={1.8} />
          </IconButton>
        </div>

        <div className="export-dialog-body">
          <div className="export-toolbar">
            <div className="field-group">
              <span className="field-label">导出内容</span>
              <div className="segmented wide">
                <button
                  type="button"
                  aria-pressed={config.mode === 'canvas'}
                  onClick={() => patch({ mode: 'canvas' })}
                >
                  导出白板
                </button>
                <button
                  type="button"
                  aria-pressed={config.mode === 'page'}
                  onClick={() => patch({ mode: 'page', scale: Math.max(8, config.scale) })}
                >
                  A4 排版
                </button>
              </div>
            </div>

            {config.mode === 'page' && (
              <div className="field-group">
                <span className="field-label">页面</span>
                <div className="segmented">
                  <button type="button" aria-pressed={config.pageSize === 'a4'} onClick={() => patch({ pageSize: 'a4' })}>
                    A4 纵向
                  </button>
                  <button
                    type="button"
                    aria-pressed={config.pageSize === 'auto'}
                    onClick={() => patch({ pageSize: 'auto' })}
                  >
                    自适应长图
                  </button>
                </div>
              </div>
            )}

            <div className="field-group">
              <span className="field-label">输出清晰度</span>
              <div className="segmented export-scale-options">
                {[1, 2, 4, 6, 8].map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    aria-pressed={config.scale === scale}
                    onClick={() => patch({ scale })}
                  >
                    {scale === 8 ? '8× 超高清' : `${scale}×`}
                  </button>
                ))}
              </div>
            </div>

            {config.mode === 'canvas' ? (
              <div className="field-group">
                <span className="field-label">背景</span>
                <div className="segmented">
                  <button
                    type="button"
                    aria-pressed={!config.transparent}
                    onClick={() => patch({ transparent: false })}
                  >
                    白色
                  </button>
                  <button
                    type="button"
                    aria-pressed={config.transparent}
                    onClick={() => patch({ transparent: true })}
                  >
                    透明
                  </button>
                </div>
              </div>
            ) : (
              <label className="checkbox-row export-include-text">
                <input
                  type="checkbox"
                  checked={config.includeText}
                  onChange={(event) => patch({ includeText: event.target.checked })}
                />
                包含观察记录
              </label>
            )}
          </div>

          {config.mode === 'page' && layout && (
            <ExportLayoutEditor project={project} layout={layout} onChange={updateLayout} onReset={resetLayout} />
          )}

          {estimate && (
            <div className="export-meta export-resolution-meta">
              预计输出 <b>{estimate.width.toLocaleString('zh-CN')}</b> × <b>{estimate.height.toLocaleString('zh-CN')}</b> 像素
              <span className="export-file-estimate">PNG 预计占用 <b>{formatFileSize(estimate.fileSize.minBytes)}–{formatFileSize(estimate.fileSize.maxBytes)}</b></span>
              {config.scale >= 6 && <span className="export-quality-tag">高精度文字重绘</span>}
              {estimate.overlap && <span className="export-warn">· 白板与文字区重叠</span>}
              {estimate.overflow && <span className="export-warn">· 页面内容可能超出纸张</span>}
              <small>
                {config.mode === 'canvas' && '白板内容按所选倍率重绘；'}
                文字与矢量标注按输出倍率重新绘制，位图清晰度取决于原图像素。文件大小为按图像面积估算的范围，纹理越复杂通常越大。
              </small>
            </div>
          )}
        </div>

        <div className="dialog-foot">
          <button type="button" className="btn ghost" onClick={close} disabled={busy}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={start} disabled={busy}>
            <Download size={17} strokeWidth={1.8} />
            {busy ? '正在渲染…' : '导出 PNG'}
          </button>
        </div>
      </div>

      {renderLayout && <ExportStage project={project} layout={renderLayout} onRendered={finish} onError={fail} />}
    </div>
  );
}
