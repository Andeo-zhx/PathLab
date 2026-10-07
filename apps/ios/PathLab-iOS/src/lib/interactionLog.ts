import { downloadBlob } from './projectFile';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import {
  diagnosticEventNames,
  type DiagnosticNotificationCategory,
  type DiagnosticNotificationTone,
  type DiagnosticResponse,
} from './diagnostics';

const DATABASE_NAME = 'pathlab-1.3.2-interactions';
const DATABASE_VERSION = 1;
const EVENT_STORE = 'events';
const startedAt = Date.now();
const sessionId = globalThis.crypto?.randomUUID?.() ?? `session-${startedAt}-${Math.random().toString(36).slice(2, 10)}`;

export type InteractionKind =
  | 'click'
  | 'pointerdown'
  | 'pointerup'
  | 'pointercancel'
  | 'canvas-pointerdown'
  | 'canvas-pointerup'
  | 'canvas-pointercancel'
  | 'touchstart'
  | 'touchend'
  | 'touchcancel'
  | 'canvas-touchstart'
  | 'canvas-touchend'
  | 'canvas-touchcancel'
  | 'app-response'
  | 'notification'
  | 'project-state'
  | 'ui-state'
  | 'runtime-error';

export interface InteractionTargetNode {
  tag: string;
  id?: string;
  role?: string;
  label?: string;
  controlText?: string;
  controlType?: string;
  title?: string;
  classes?: string[];
  action?: string;
  tool?: string;
}

export interface InteractionRecord {
  sequence?: number;
  sessionId: string;
  timestamp: string;
  elapsedMs: number;
  kind: InteractionKind;
  pointerType?: string | null;
  pointerId?: number;
  isPrimary?: boolean;
  pressure?: number;
  buttons?: number;
  button?: number;
  clickCount?: number;
  screen?: { x: number; y: number };
  client?: { x: number; y: number };
  local?: { x: number; y: number } | null;
  targetRect?: { left: number; top: number; width: number; height: number };
  canvasRect?: { left: number; top: number; width: number; height: number };
  touchPoints?: { identifier: number; clientX: number; clientY: number; screenX: number; screenY: number; touchType?: string; force?: number }[];
  viewport?: {
    width: number;
    height: number;
    devicePixelRatio: number;
    scrollX: number;
    scrollY: number;
    visualOffsetLeft: number;
    visualOffsetTop: number;
    visualWidth: number;
    visualHeight: number;
    visualScale: number;
  };
  targetPath?: InteractionTargetNode[];
  response?: DiagnosticResponse;
  notification?: { tone: DiagnosticNotificationTone; category: DiagnosticNotificationCategory };
  runtimeError?: { source: 'window-error' | 'unhandled-rejection'; name: string };
  changes?: string[];
  previousState?: InteractionStateSnapshot;
  state: {
    projectId: string;
    projectTransition: number;
    activeTool: string;
    objectCounts: { images: number; annotations: number; magnifiers: number };
    selection: { id: string; kind: string }[];
    ui: {
      exportMode: string | null;
      moreMenuOpen: boolean;
      shortcutsOpen: boolean;
      textSettingsOpen: boolean;
      translationOpen: boolean;
      textEditing: boolean;
      annotationsVisible: boolean;
    };
  };
}

type InteractionStateSnapshot = InteractionRecord['state'];

export interface InteractionLogStats {
  count: number;
  latestAt: string | null;
  storageError: string | null;
}

interface InteractionLogEnvelope {
  format: 'pathlab-interaction-log';
  schemaVersion: 3;
  appVersion: '1.3.2-test';
  exportedAt: string;
  sessionIds: string[];
  environment: {
    userAgent: string;
    language: string;
    viewport: NonNullable<InteractionRecord['viewport']>;
    screen: { width: number; height: number; orientation: string | null };
  };
  eventCount: number;
  storageError: string | null;
  events: InteractionRecord[];
}

let databasePromise: Promise<IDBDatabase> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let storageError: string | null = null;
let recording = false;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVENT_STORE)) {
        const store = db.createObjectStore(EVENT_STORE, { keyPath: 'sequence', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp');
        store.createIndex('sessionId', 'sessionId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开交互记录数据库'));
    request.onblocked = () => reject(new Error('交互记录数据库正被另一个窗口占用'));
  });
  const cached = opening.catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
  databasePromise = cached;
  return cached;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('交互记录写入失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('交互记录写入已取消'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('交互记录读取失败'));
  });
}

function safeAttribute(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name)?.trim();
  if (!value || value.length > 160) return undefined;
  return value;
}

function targetPath(target: Element): InteractionTargetNode[] {
  const result: InteractionTargetNode[] = [];
  let element: Element | null = target;
  for (let depth = 0; element && depth < 6; depth += 1, element = element.parentElement) {
    const node: InteractionTargetNode = { tag: element.tagName.toLowerCase() };
    if (element.id) node.id = element.id.slice(0, 100);
    const role = safeAttribute(element, 'role');
    const label = safeAttribute(element, 'aria-label');
    const title = safeAttribute(element, 'title');
    const action = safeAttribute(element, 'data-action');
    const tool = safeAttribute(element, 'data-tool');
    const controlType = element instanceof HTMLInputElement || element instanceof HTMLButtonElement
      ? element.type
      : element instanceof HTMLTextAreaElement
        ? 'textarea'
        : element instanceof HTMLSelectElement
          ? 'select'
          : undefined;
    const controlText = element instanceof HTMLButtonElement || role === 'button'
      ? element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120)
      : undefined;
    const classes = Array.from(element.classList).slice(0, 6);
    if (role) node.role = role;
    if (label) node.label = label;
    if (controlText) node.controlText = controlText;
    if (controlType) node.controlType = controlType;
    if (title) node.title = title;
    if (action) node.action = action;
    if (tool) node.tool = tool;
    if (classes.length) node.classes = classes;
    result.push(node);
    if (element === document.body) break;
  }
  return result;
}

function snapshotState(): InteractionStateSnapshot {
  const project = useProject.getState();
  const ui = useUi.getState();
  return {
    projectId: project.project.id,
    projectTransition: project.projectTransition,
    activeTool: ui.tool,
    objectCounts: {
      images: project.project.images.length,
      annotations: project.project.annotations.length,
      magnifiers: project.project.magnifiers.length,
    },
    selection: ui.selection.map(({ id, kind }) => ({ id, kind })),
    ui: {
      exportMode: ui.exportConfig?.mode ?? null,
      moreMenuOpen: ui.moreMenuOpen,
      shortcutsOpen: ui.shortcutsOpen,
      textSettingsOpen: ui.textSettingsOpen,
      translationOpen: Boolean(ui.translationAnnotationId),
      textEditing: Boolean(ui.editingTextId),
      annotationsVisible: ui.annotationsGloballyVisible,
    },
  };
}

function queueSupplementalRecord(
  kind: Extract<InteractionKind, 'app-response' | 'notification' | 'project-state' | 'ui-state' | 'runtime-error'>,
  extra: Pick<InteractionRecord, 'response' | 'notification' | 'runtimeError' | 'changes' | 'previousState'> = {},
): void {
  queueRecord({
    sessionId,
    timestamp: new Date().toISOString(),
    elapsedMs: Math.max(0, Date.now() - startedAt),
    kind,
    state: snapshotState(),
    ...extra,
  });
}

function queueRecord(record: InteractionRecord): void {
  writeQueue = writeQueue.then(async () => {
    const db = await openDatabase();
    const transaction = db.transaction(EVENT_STORE, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(EVENT_STORE).add(record);
    await done;
    storageError = null;
  }).catch((error: unknown) => {
    storageError = error instanceof Error ? error.message : '交互记录保存失败';
  });
}

type CapturedInputEvent = MouseEvent | PointerEvent | TouchEvent;

function rectSnapshot(rect: DOMRect): NonNullable<InteractionRecord['targetRect']> {
  return {
    left: Math.round(rect.left * 100) / 100,
    top: Math.round(rect.top * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
  };
}

function captureInteraction(event: CapturedInputEvent, kind: InteractionKind): void {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const target = event.target;
  const canvasRoot = target.closest('.konvajs-content') ?? (target instanceof HTMLCanvasElement ? target : null);
  const isCanvasRecord = kind.startsWith('canvas-');
  if (isCanvasRecord && !canvasRoot) return;
  if (!isCanvasRecord && kind !== 'click' && canvasRoot) return;
  if (kind === 'click' && canvasRoot) return;

  const targetRect = target.getBoundingClientRect();
  const canvasRect = canvasRoot?.getBoundingClientRect() ?? null;
  const changedTouches = 'changedTouches' in event ? event.changedTouches : null;
  const liveTouches = 'touches' in event ? event.touches : null;
  const touchList = changedTouches?.length ? changedTouches : liveTouches;
  const primaryTouch = touchList?.[0] ?? null;
  const coordinateEvent = 'clientX' in event ? event : null;
  const clientX = primaryTouch?.clientX ?? coordinateEvent?.clientX ?? Number.NaN;
  const clientY = primaryTouch?.clientY ?? coordinateEvent?.clientY ?? Number.NaN;
  const screenX = primaryTouch?.screenX ?? coordinateEvent?.screenX ?? Number.NaN;
  const screenY = primaryTouch?.screenY ?? coordinateEvent?.screenY ?? Number.NaN;
  const touchPoints = touchList
    ? Array.from(touchList).slice(0, 2).map((touch) => ({
      identifier: touch.identifier,
      clientX: Math.round(touch.clientX * 100) / 100,
      clientY: Math.round(touch.clientY * 100) / 100,
      screenX: Math.round(touch.screenX * 100) / 100,
      screenY: Math.round(touch.screenY * 100) / 100,
      touchType: (touch as Touch & { touchType?: string }).touchType,
      force: typeof touch.force === 'number' ? Math.round(touch.force * 1000) / 1000 : undefined,
    }))
    : undefined;
  const visualViewport = window.visualViewport;
  const rect = canvasRect ?? targetRect;
  const pointerType = 'pointerType' in event && typeof event.pointerType === 'string' ? event.pointerType : null;
  const timestamp = new Date().toISOString();
  queueRecord({
    sessionId,
    timestamp,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    kind,
    pointerType: pointerType ?? (primaryTouch ? 'touch' : null),
    pointerId: 'pointerId' in event ? event.pointerId : undefined,
    isPrimary: 'isPrimary' in event ? event.isPrimary : undefined,
    pressure: 'pressure' in event ? Math.round(event.pressure * 1000) / 1000 : undefined,
    buttons: 'buttons' in event ? event.buttons : undefined,
    button: 'button' in event ? event.button : undefined,
    clickCount: kind === 'click' ? event.detail : undefined,
    screen: Number.isFinite(screenX) && Number.isFinite(screenY)
      ? { x: Math.round(screenX * 100) / 100, y: Math.round(screenY * 100) / 100 }
      : undefined,
    client: Number.isFinite(clientX) && Number.isFinite(clientY)
      ? { x: Math.round(clientX * 100) / 100, y: Math.round(clientY * 100) / 100 }
      : undefined,
    local: canvasRoot
      ? { x: Math.round((clientX - rect.left) * 100) / 100, y: Math.round((clientY - rect.top) * 100) / 100 }
      : null,
    targetRect: rectSnapshot(targetRect),
    canvasRect: canvasRect ? rectSnapshot(canvasRect) : undefined,
    touchPoints,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      scrollX: Math.round(window.scrollX * 100) / 100,
      scrollY: Math.round(window.scrollY * 100) / 100,
      visualOffsetLeft: Math.round((visualViewport?.offsetLeft ?? 0) * 100) / 100,
      visualOffsetTop: Math.round((visualViewport?.offsetTop ?? 0) * 100) / 100,
      visualWidth: Math.round((visualViewport?.width ?? window.innerWidth) * 100) / 100,
      visualHeight: Math.round((visualViewport?.height ?? window.innerHeight) * 100) / 100,
      visualScale: Math.round((visualViewport?.scale ?? 1) * 1000) / 1000,
    },
    targetPath: targetPath(target),
    state: snapshotState(),
  });
}

function captureDiagnosticEvents(): () => void {
  const names = diagnosticEventNames();
  const onResponse = (event: Event) => {
    const response = (event as CustomEvent<DiagnosticResponse>).detail;
    if (response) queueSupplementalRecord('app-response', { response });
  };
  const onNotification = (event: Event) => {
    const notification = (event as CustomEvent<{ tone: DiagnosticNotificationTone; category: DiagnosticNotificationCategory }>).detail;
    if (notification && notification.category !== 'diagnostics') queueSupplementalRecord('notification', { notification });
  };
  const onRuntimeError = (event: Event) => {
    const errorEvent = event as ErrorEvent;
    queueSupplementalRecord('runtime-error', {
      runtimeError: { source: 'window-error', name: errorEvent.error instanceof Error ? errorEvent.error.name : 'Error' },
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    queueSupplementalRecord('runtime-error', {
      runtimeError: { source: 'unhandled-rejection', name: reason instanceof Error ? reason.name : 'UnhandledRejection' },
    });
  };
  window.addEventListener(names.response, onResponse);
  window.addEventListener(names.notification, onNotification);
  window.addEventListener('error', onRuntimeError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  const stopProject = useProject.subscribe((current, previous) => {
    const changes: string[] = [];
    if (current.project.id !== previous.project.id) changes.push('project-id');
    if (current.projectTransition !== previous.projectTransition) changes.push('project-transition');
    if (
      current.project.images.length !== previous.project.images.length ||
      current.project.annotations.length !== previous.project.annotations.length ||
      current.project.magnifiers.length !== previous.project.magnifiers.length
    ) changes.push('object-counts');
    if (current.past.length !== previous.past.length || current.future.length !== previous.future.length) changes.push('history');
    if (changes.length) {
      queueSupplementalRecord('project-state', {
        changes,
        previousState: {
          ...snapshotState(),
          projectId: previous.project.id,
          projectTransition: previous.projectTransition,
          objectCounts: {
            images: previous.project.images.length,
            annotations: previous.project.annotations.length,
            magnifiers: previous.project.magnifiers.length,
          },
        },
      });
    }
  });

  const stopUi = useUi.subscribe((current, previous) => {
    const changes: string[] = [];
    if (current.tool !== previous.tool) changes.push('active-tool');
    if (JSON.stringify(current.selection) !== JSON.stringify(previous.selection)) changes.push('selection');
    if (current.exportConfig?.mode !== previous.exportConfig?.mode) changes.push('export-mode');
    if (current.moreMenuOpen !== previous.moreMenuOpen) changes.push('more-menu');
    if (current.shortcutsOpen !== previous.shortcutsOpen) changes.push('shortcuts-dialog');
    if (current.textSettingsOpen !== previous.textSettingsOpen) changes.push('text-settings-dialog');
    if (current.translationAnnotationId !== previous.translationAnnotationId) changes.push('translation-dialog');
    if (Boolean(current.editingTextId) !== Boolean(previous.editingTextId)) changes.push('text-editor');
    if (current.annotationsGloballyVisible !== previous.annotationsGloballyVisible) changes.push('annotation-visibility');
    if (changes.length) {
      queueSupplementalRecord('ui-state', {
        changes,
        previousState: {
          ...snapshotState(),
          activeTool: previous.tool,
          selection: previous.selection.map(({ id, kind }) => ({ id, kind })),
          ui: {
            exportMode: previous.exportConfig?.mode ?? null,
            moreMenuOpen: previous.moreMenuOpen,
            shortcutsOpen: previous.shortcutsOpen,
            textSettingsOpen: previous.textSettingsOpen,
            translationOpen: Boolean(previous.translationAnnotationId),
            textEditing: Boolean(previous.editingTextId),
            annotationsVisible: previous.annotationsGloballyVisible,
          },
        },
      });
    }
  });

  return () => {
    window.removeEventListener(names.response, onResponse);
    window.removeEventListener(names.notification, onNotification);
    window.removeEventListener('error', onRuntimeError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    stopProject();
    stopUi();
  };
}

export function startInteractionRecording(): () => void {
  if (recording) return () => undefined;
  recording = true;
  const onClick = (event: MouseEvent) => captureInteraction(event, 'click');
  const onPointer = (event: PointerEvent) => {
    const target = event.target;
    const isCanvasTarget = target instanceof Element && Boolean(target.closest('.konvajs-content'));
    const phase = event.type.slice('pointer'.length) as 'down' | 'up' | 'cancel';
    const kind = `${isCanvasTarget ? 'canvas-' : ''}pointer${phase}` as InteractionKind;
    captureInteraction(event, kind);
  };
  const onTouch = (event: TouchEvent) => {
    const target = event.target;
    const isCanvasTarget = target instanceof Element && Boolean(target.closest('.konvajs-content'));
    const kind = `${isCanvasTarget ? 'canvas-' : ''}${event.type}` as InteractionKind;
    captureInteraction(event, kind);
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('pointerup', onPointer, true);
  document.addEventListener('pointercancel', onPointer, true);
  document.addEventListener('touchstart', onTouch, { capture: true, passive: true });
  document.addEventListener('touchend', onTouch, { capture: true, passive: true });
  document.addEventListener('touchcancel', onTouch, { capture: true, passive: true });
  const stopSupplemental = captureDiagnosticEvents();
  return () => {
    if (!recording) return;
    recording = false;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('pointerup', onPointer, true);
    document.removeEventListener('pointercancel', onPointer, true);
    document.removeEventListener('touchstart', onTouch, true);
    document.removeEventListener('touchend', onTouch, true);
    document.removeEventListener('touchcancel', onTouch, true);
    stopSupplemental();
  };
}

export async function getInteractionLogStats(): Promise<InteractionLogStats> {
  await writeQueue;
  const db = await openDatabase();
  const transaction = db.transaction(EVENT_STORE, 'readonly');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(EVENT_STORE);
  const countRequest = requestResult(store.count());
  const latestRequest = new Promise<InteractionRecord | null>((resolve, reject) => {
    const cursorRequest = store.openCursor(null, 'prev');
    cursorRequest.onsuccess = () => resolve(cursorRequest.result?.value as InteractionRecord | undefined ?? null);
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('无法读取最新交互记录'));
  });
  const [count, latest] = await Promise.all([countRequest, latestRequest]);
  await done;
  return { count, latestAt: latest?.timestamp ?? null, storageError };
}

export async function getRecentInteractionRecords(limit = 8): Promise<InteractionRecord[]> {
  await writeQueue;
  const db = await openDatabase();
  const transaction = db.transaction(EVENT_STORE, 'readonly');
  const done = transactionDone(transaction);
  const records = await new Promise<InteractionRecord[]>((resolve, reject) => {
    const result: InteractionRecord[] = [];
    const request = transaction.objectStore(EVENT_STORE).openCursor(null, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || result.length >= limit) {
        resolve(result.reverse());
        return;
      }
      result.push(cursor.value as InteractionRecord);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('无法读取交互记录'));
  });
  await done;
  return records;
}

async function readAllInteractionRecords(): Promise<InteractionRecord[]> {
  await writeQueue;
  const db = await openDatabase();
  const transaction = db.transaction(EVENT_STORE, 'readonly');
  const done = transactionDone(transaction);
  const records = await requestResult(transaction.objectStore(EVENT_STORE).getAll()) as InteractionRecord[];
  await done;
  return records;
}

export async function exportInteractionLog(): Promise<void> {
  const events = await readAllInteractionRecords();
  const exportedAt = new Date().toISOString();
  const envelope: InteractionLogEnvelope = {
    format: 'pathlab-interaction-log',
    schemaVersion: 3,
    appVersion: '1.3.2-test',
    exportedAt,
    sessionIds: Array.from(new Set(events.map((event) => event.sessionId))),
    environment: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollX: Math.round(window.scrollX * 100) / 100,
        scrollY: Math.round(window.scrollY * 100) / 100,
        visualOffsetLeft: Math.round((window.visualViewport?.offsetLeft ?? 0) * 100) / 100,
        visualOffsetTop: Math.round((window.visualViewport?.offsetTop ?? 0) * 100) / 100,
        visualWidth: Math.round((window.visualViewport?.width ?? window.innerWidth) * 100) / 100,
        visualHeight: Math.round((window.visualViewport?.height ?? window.innerHeight) * 100) / 100,
        visualScale: Math.round((window.visualViewport?.scale ?? 1) * 1000) / 1000,
      },
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        orientation: window.screen.orientation?.type ?? null,
      },
    },
    eventCount: events.length,
    storageError,
    events,
  };
  const timeLabel = exportedAt.replace(/[:.]/g, '-');
  await downloadBlob(
    new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }),
    `PathLab-1.3.2-interactions-${timeLabel}.json`,
  );
}

export async function clearInteractionLog(): Promise<void> {
  await writeQueue;
  const db = await openDatabase();
  const transaction = db.transaction(EVENT_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(EVENT_STORE).clear();
  await done;
  storageError = null;
}
