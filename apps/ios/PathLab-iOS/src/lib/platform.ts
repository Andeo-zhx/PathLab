/** 平台相关的修饰键显示：macOS 用 ⌘，其余用 Ctrl */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

export const MOD = IS_MAC ? '⌘' : 'Ctrl';
export const MOD_SHIFT = IS_MAC ? '⌘⇧' : 'Ctrl+Shift';
