const STORAGE_KEY = 'pathlab:interaction-recording-enabled:v1';
const CHANGE_EVENT = 'pathlab:interaction-recording-preference-change';

let inMemoryValue: boolean | undefined;

export function getInteractionRecordingEnabled(): boolean {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'true') return true;
    if (saved === 'false') return false;
  } catch {
    // Fall back to the in-memory value when browser storage is unavailable.
  }
  return inMemoryValue ?? false;
}

export function setInteractionRecordingEnabled(enabled: boolean): void {
  inMemoryValue = enabled;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Recording remains available for this app session if storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeToInteractionRecordingPreference(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
