import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Download, MousePointer2, RefreshCw, Trash2, X } from 'lucide-react';
import { useUi } from '../store/uiStore';
import {
  getInteractionRecordingEnabled,
  setInteractionRecordingEnabled,
} from '../lib/interactionRecordingPreference';
import {
  clearInteractionLog,
  exportInteractionLog,
  getInteractionLogStats,
  getRecentInteractionRecords,
  type InteractionLogStats,
  type InteractionRecord,
} from '../lib/interactionLog';
import { IconButton } from './IconButton';

interface InteractionLogDialogProps {
  onClose: () => void;
}

function formatTime(value: string | null): string {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function targetDescription(record: InteractionRecord): string {
  const path = record.targetPath ?? [];
  const meaningful = path.find((node) => node.label || node.controlText || node.title || node.action || node.tool || node.id);
  if (!meaningful) return path[0]?.tag ?? '未知目标';
  return meaningful.label ?? meaningful.controlText ?? meaningful.title ?? meaningful.action ?? meaningful.tool ?? `#${meaningful.id}`;
}

function pointerDescription(value: string | null): string {
  if (value === 'pen') return '触控笔';
  if (value === 'touch') return '手指';
  if (value === 'mouse') return '鼠标';
  return '未识别';
}

function responseDescription(record: InteractionRecord): { title: string; detail: string } {
  if (record.kind === 'app-response' && record.response) {
    const operationNames: Record<string, string> = {
      'image-picker': '图片选择器',
      'image-import': '图片导入',
      'project-picker': '工程选择器',
      'project-open': '.pathlab 工程打开',
      'project-save': '工程保存',
      'canvas-export': '图片导出',
      'clipboard-import': '剪贴板导入',
      'draft-restore': '草稿恢复',
      'new-project': '新建工程',
    };
    const phaseNames: Record<string, string> = {
      start: '开始', selected: '已选择', success: '成功', partial: '部分成功',
      failure: '失败', cancelled: '已取消', empty: '无内容', 'no-change': '无变化', 'visual-check': '视口检查',
    };
    const sourceNames: Record<string, string> = {
      picker: '图片选择器', drop: '拖放', paste: '粘贴', clipboard: '剪贴板',
      'native-files': 'iOS 文件打开', shortcut: '快捷操作', unknown: '未知来源',
    };
    const reasonNames: Record<string, string> = {
      superseded: '被后续文件操作取代', 'no-files': '没有可导入的图片文件',
      'decode-failed': '图片解码失败', 'asset-storage': '本地图片资源写入失败',
      'commit-failed': '图片未能写入工程', 'unpack-failed': '工程文件解包或校验失败',
      'autosave-failed': '草稿保存失败', 'picker-failed': '文件选择器无法打开',
      'share-failed': '保存或分享失败', 'no-images': '工程内没有图片',
      'no-clipboard-image': '剪贴板没有图片', 'clipboard-unavailable': '剪贴板读取失败或无权限',
      'no-draft': '没有待恢复草稿', 'invalid-draft': '草稿校验失败',
      'canvas-not-mounted': '画布尚未挂载', 'outside-viewport': '图片落在当前视口之外', unknown: '未分类错误',
    };
    const response = record.response;
    const metrics = [
      response.durationMs !== undefined ? `${response.durationMs} ms` : '',
      response.source ? `来源 ${sourceNames[response.source] ?? response.source}` : '',
      response.requestedCount !== undefined ? `请求 ${response.requestedCount}` : '',
      response.selectedCount !== undefined ? `选中 ${response.selectedCount}` : '',
      response.successCount !== undefined ? `成功 ${response.successCount}` : '',
      response.failureCount !== undefined ? `失败 ${response.failureCount}` : '',
      response.annotationCount !== undefined ? `标注 ${response.annotationCount}` : '',
      response.magnifierCount !== undefined ? `放大镜 ${response.magnifierCount}` : '',
      response.bytes !== undefined ? `${response.bytes.toLocaleString()} B` : '',
      response.reason ? `原因 ${reasonNames[response.reason] ?? response.reason}` : '',
      response.parentOperationId ? `关联 ${response.parentOperationId}` : '',
      response.visualCheck
        ? `视口可见 ${response.visualCheck.visibleSubjectImageCount}/${response.visualCheck.subjectImageCount} · 画布${response.visualCheck.canvasMounted ? '已挂载' : '未挂载'} · ${response.visualCheck.viewportWidth}×${response.visualCheck.viewportHeight}`
        : '',
    ].filter(Boolean);
    return {
      title: operationNames[response.operation] ?? response.operation,
      detail: [phaseNames[response.phase] ?? response.phase, ...metrics].join(' · '),
    };
  }
  if (record.kind === 'notification') {
    const categoryNames: Record<string, string> = {
      import: '导入提示', project: '工程提示', export: '导出提示', clipboard: '剪贴板提示',
      draft: '草稿提示', translation: '翻译提示', history: '编辑提示', diagnostics: '诊断工具提示', other: '应用提示',
    };
    const toneNames: Record<string, string> = { info: '信息', success: '成功', error: '错误' };
    return { title: categoryNames[record.notification?.category ?? 'other'] ?? '应用提示', detail: toneNames[record.notification?.tone ?? 'info'] ?? '信息' };
  }
  if (record.kind === 'runtime-error') {
    const sourceNames = { 'window-error': '运行时脚本错误', 'unhandled-rejection': '未处理的异步错误' };
    return {
      title: sourceNames[record.runtimeError?.source ?? 'window-error'],
      detail: record.runtimeError?.name ?? 'Error',
    };
  }
  if (record.kind === 'project-state' || record.kind === 'ui-state') {
    const isProject = record.kind === 'project-state';
    return {
      title: isProject ? '工程状态变化' : '界面状态变化',
      detail: (record.changes ?? []).map((change) => ({
        'project-id': '工程切换', 'project-transition': '工程转换', 'object-counts': '对象数量', history: '撤销/重做记录',
        'active-tool': '工具切换', selection: '选区变化', 'export-mode': '导出模式', 'more-menu': '更多菜单',
        'shortcuts-dialog': '快捷键窗口', 'text-settings-dialog': '文字设置窗口', 'translation-dialog': '翻译窗口',
        'text-editor': '文字编辑状态', 'annotation-visibility': '标注显示状态',
      }[change] ?? change)).join(' · ') || '状态已更新',
    };
  }
  const phase = record.kind.replace(/^canvas-/, '');
  const eventLabels: Record<string, string> = {
    click: '点击',
    pointerdown: '按下', pointerup: '抬起', pointercancel: '取消',
    touchstart: '触控开始', touchend: '触控结束', touchcancel: '触控取消',
  };
  const inputLabel = `${record.kind.startsWith('canvas-') ? '画布' : '界面'}${eventLabels[phase] ?? phase}`;
  return {
    title: targetDescription(record),
    detail: `${inputLabel} · ${pointerDescription(record.pointerType ?? null)} · ${record.state.activeTool}`,
  };
}

export function InteractionLogDialog({ onClose }: InteractionLogDialogProps) {
  const toast = useUi((state) => state.toast);
  const [stats, setStats] = useState<InteractionLogStats>({ count: 0, latestAt: null, storageError: null });
  const [recent, setRecent] = useState<InteractionRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [recordingEnabled, setRecordingEnabled] = useState(getInteractionRecordingEnabled);

  const refresh = useCallback(async () => {
    try {
      const [nextStats, nextRecent] = await Promise.all([
        getInteractionLogStats(),
        getRecentInteractionRecords(10),
      ]);
      setStats(nextStats);
      setRecent(nextRecent);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '无法读取交互记录');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, onClose, refresh]);

  const exportJson = async () => {
    setBusy(true);
    try {
      await exportInteractionLog();
      toast('交互记录 JSON 已准备好', 'success');
    } catch (error) {
      toast(error instanceof Error ? `导出失败：${error.message}` : '交互记录导出失败', 'error');
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const clearRecords = async () => {
    setBusy(true);
    try {
      await clearInteractionLog();
      await refresh();
      setConfirmClear(false);
      toast('交互记录已清除', 'success');
    } catch (error) {
      toast(error instanceof Error ? `清除失败：${error.message}` : '无法清除交互记录', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleRecording = () => {
    const next = !recordingEnabled;
    setRecordingEnabled(next);
    setInteractionRecordingEnabled(next);
  };

  return createPortal(
    <div className="dialog-scrim interaction-log-scrim" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="dialog interaction-log-dialog" role="dialog" aria-modal="true" aria-labelledby="interaction-log-title">
        <header className="interaction-log-head">
          <div className="interaction-log-title-group">
            <span className="interaction-log-icon"><Activity size={18} strokeWidth={1.8} /></span>
            <h2 id="interaction-log-title">交互记录</h2>
          </div>
          <IconButton label="关闭交互记录" tip="关闭" size="sm" onClick={onClose} disabled={busy}>
            <X size={18} />
          </IconButton>
        </header>

        <div className="interaction-log-body">
          <div className="interaction-log-overview">
            <div className="interaction-log-count">
              <strong>{stats.count.toLocaleString()}</strong>
              <span>条事件</span>
            </div>
            <div className="interaction-log-latest">
              <span>最近记录</span>
              <strong>{formatTime(stats.latestAt)}</strong>
            </div>
            <IconButton label="刷新记录" tip="刷新" size="sm" onClick={() => void refresh()} disabled={busy}>
              <RefreshCw size={16} />
            </IconButton>
          </div>

          {(loadError || stats.storageError) && (
            <div className="interaction-log-error" role="status">
              {loadError ?? `本机存储错误：${stats.storageError}`}
            </div>
          )}

          <div className="interaction-log-list-heading">
            <span>最近事件</span>
          </div>
          <ol className="interaction-log-list">
            {recent.length ? recent.map((record) => {
              const point = record.local ?? record.client ?? null;
              const location = record.local ? '画布' : record.client ? '屏幕' : null;
              const description = responseDescription(record);
              return (
                <li key={`${record.sessionId}-${record.sequence ?? record.timestamp}`}>
                  <span className="interaction-log-event-icon">
                    {record.kind === 'click' || record.kind.includes('pointer') || record.kind.includes('touch')
                      ? <MousePointer2 size={15} />
                      : <Activity size={15} />}
                  </span>
                  <div className="interaction-log-event-main">
                    <strong>{description.title}</strong>
                    <span>{description.detail}</span>
                  </div>
                  <time dateTime={record.timestamp}>{new Date(record.timestamp).toLocaleTimeString()}</time>
                  {point && location ? <code>{location} {Math.round(point.x)}, {Math.round(point.y)}</code> : (
                    <code>{record.state.objectCounts.images} 图 · {record.state.objectCounts.annotations} 标注 · {record.state.objectCounts.magnifiers} 放大镜</code>
                  )}
                </li>
              );
            }) : (
              <li className="interaction-log-empty">
                {recordingEnabled ? '尚无事件。开启后操作应用，记录会显示在这里。' : '记录已关闭。开启开关后，后续操作会记录在这里。'}
              </li>
            )}
          </ol>
        </div>

        <footer className="interaction-log-foot">
          <button
            type="button"
            className={`interaction-log-record-toggle${recordingEnabled ? ' is-on' : ''}`}
            role="switch"
            aria-checked={recordingEnabled}
            aria-label={`交互记录采集${recordingEnabled ? '已开启' : '已关闭'}`}
            title={`交互记录采集${recordingEnabled ? '已开启' : '已关闭'}`}
            onClick={toggleRecording}
            disabled={busy}
          >
            <span>记录开关</span>
            <span className="interaction-log-switch-track" aria-hidden="true"><i /></span>
          </button>
          <div className="interaction-log-actions">
            {confirmClear ? (
              <div className="interaction-log-clear-confirm" role="group" aria-label="确认清除交互记录">
                <span>清除 {stats.count.toLocaleString()} 条本机记录？</span>
                <button type="button" className="btn ghost" onClick={() => setConfirmClear(false)} disabled={busy}>保留</button>
                <button type="button" className="btn primary" onClick={() => void clearRecords()} disabled={busy}>清除</button>
              </div>
            ) : (
              <IconButton
                label="清除交互记录"
                tip="清除记录"
                size="sm"
                onClick={() => setConfirmClear(true)}
                disabled={busy || stats.count === 0}
              >
                <Trash2 size={16} />
              </IconButton>
            )}
            <IconButton label="导出交互记录 JSON" tip="导出 JSON" size="sm" onClick={() => void exportJson()} disabled={busy}>
              <Download size={17} />
            </IconButton>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
