const STYLUS_MODE_KEY = 'pathlab.stylusModeEnabled';

export function loadStylusModeEnabled(): boolean {
  try {
    const saved = localStorage.getItem(STYLUS_MODE_KEY);
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch {
    // Browser storage may be unavailable in private or restricted contexts.
  }
  return true;
}

export function saveStylusModeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STYLUS_MODE_KEY, enabled ? '1' : '0');
  } catch {
    // Keep the in-memory toggle usable even when browser storage is unavailable.
  }
}
