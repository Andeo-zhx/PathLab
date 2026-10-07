export type DiagnosticOperation =
  | 'image-picker'
  | 'image-import'
  | 'project-picker'
  | 'project-open'
  | 'project-save'
  | 'canvas-export'
  | 'clipboard-import'
  | 'draft-restore'
  | 'new-project';

export type DiagnosticPhase = 'start' | 'selected' | 'success' | 'partial' | 'failure' | 'cancelled' | 'empty' | 'no-change' | 'visual-check';

export type DiagnosticReason =
  | 'superseded'
  | 'no-files'
  | 'decode-failed'
  | 'asset-storage'
  | 'commit-failed'
  | 'unpack-failed'
  | 'autosave-failed'
  | 'picker-failed'
  | 'share-failed'
  | 'no-images'
  | 'no-clipboard-image'
  | 'clipboard-unavailable'
  | 'no-draft'
  | 'invalid-draft'
  | 'canvas-not-mounted'
  | 'outside-viewport'
  | 'unknown';

export interface DiagnosticVisualCheck {
  canvasMounted: boolean;
  viewportWidth: number;
  viewportHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  subjectImageCount: number;
  visibleSubjectImageCount: number;
  projectImageCount: number;
}

export interface DiagnosticResponse {
  operationId: string;
  parentOperationId?: string;
  operation: DiagnosticOperation;
  phase: DiagnosticPhase;
  durationMs?: number;
  source?: 'picker' | 'drop' | 'paste' | 'clipboard' | 'native-files' | 'shortcut' | 'unknown';
  requestedCount?: number;
  selectedCount?: number;
  successCount?: number;
  failureCount?: number;
  annotationCount?: number;
  magnifierCount?: number;
  bytes?: number;
  mimeType?: string;
  reason?: DiagnosticReason;
  exportMode?: 'canvas' | 'page';
  scale?: number;
  hasDraft?: boolean;
  visualCheck?: DiagnosticVisualCheck;
}

export type DiagnosticNotificationTone = 'info' | 'success' | 'error';
export type DiagnosticNotificationCategory =
  | 'import'
  | 'project'
  | 'export'
  | 'clipboard'
  | 'draft'
  | 'translation'
  | 'history'
  | 'diagnostics'
  | 'other';

const DIAGNOSTIC_EVENT = 'pathlab:diagnostic-response';
const NOTIFICATION_EVENT = 'pathlab:diagnostic-notification';
let operationSequence = 0;

export function createDiagnosticOperationId(prefix: DiagnosticOperation): string {
  operationSequence += 1;
  return `${prefix}-${Date.now()}-${operationSequence}`;
}

export function emitDiagnosticResponse(response: DiagnosticResponse): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<DiagnosticResponse>(DIAGNOSTIC_EVENT, { detail: response }));
}

export function emitDiagnosticNotification(tone: DiagnosticNotificationTone, category: DiagnosticNotificationCategory): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: { tone, category } }));
}

export function diagnosticEventNames() {
  return { response: DIAGNOSTIC_EVENT, notification: NOTIFICATION_EVENT } as const;
}

export function categorizeNotification(message: string): DiagnosticNotificationCategory {
  if (/交互记录/.test(message)) return 'diagnostics';
  if (/导入|选择图片/.test(message)) return 'import';
  if (/导出|PNG/.test(message)) return 'export';
  if (/剪贴板/.test(message)) return 'clipboard';
  if (/草稿|自动保存/.test(message)) return 'draft';
  if (/翻译|译文/.test(message)) return 'translation';
  if (/撤销|重做|复制|粘贴/.test(message)) return 'history';
  if (/工程|保存|打开|新建/.test(message)) return 'project';
  return 'other';
}
