import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useUi, type ToastItem } from '../store/uiStore';

function ToastRow({ item }: { item: ToastItem }) {
  const dismiss = useUi((s) => s.dismissToast);
  useEffect(() => {
    const t = setTimeout(() => dismiss(item.id), item.tone === 'error' ? 5200 : 3200);
    return () => clearTimeout(t);
  }, [dismiss, item.id, item.tone]);

  const Icon = item.tone === 'error' ? AlertCircle : item.tone === 'success' ? CheckCircle2 : Info;
  return (
    <div className={`toast ${item.tone}`} role="status">
      <Icon size={17} strokeWidth={1.8} aria-hidden />
      <span>{item.message}</span>
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastRow key={t.id} item={t} />
      ))}
    </div>
  );
}
