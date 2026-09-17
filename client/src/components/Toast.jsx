import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

export function useToast(initial = '') {
  const [toast, setToast] = useState(initial);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  return { toast, showToast: setToast };
}

export default function Toast({ message }) {
  if (!message) return null;
  return (
    <div role="status" className="fixed bottom-6 left-1/2 z-[1200] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-[#0f172a] px-4 py-3 text-sm text-white shadow-lg ring-1 ring-white/10">
      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
      {message}
    </div>
  );
}
