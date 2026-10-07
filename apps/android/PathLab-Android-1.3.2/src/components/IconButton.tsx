import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** tooltip 文案 */
  tip?: string;
  tipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** 无障碍名称（必填） */
  label: string;
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
  tone?: 'default' | 'danger';
  children: ReactNode;
}

export function IconButton({
  tip,
  tipSide = 'bottom',
  label,
  size = 'md',
  active = false,
  tone = 'default',
  className = '',
  children,
  ...rest
}: IconButtonProps) {
  const sizeClass = size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : '';
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      data-tip={tip}
      data-tip-side={tip ? tipSide : undefined}
      className={`icon-btn ${sizeClass} ${active ? 'active' : ''} ${tone === 'danger' ? 'danger' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
