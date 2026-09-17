import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, Loader2 } from 'lucide-react';
import { api, notifyDataChanged } from '../api';
import { useAuth } from '../context/AuthContext';

// **kalın** yazımı destekleyen basit metin gösterimi
function RichText({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  );
}

export default function Assistant() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function send(text) {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const r = await api('/assistant', {
        method: 'POST',
        body: { messages: next.map(({ role, content: c }) => ({ role, content: c })) },
      });
      setMessages([...next, { role: 'assistant', content: r.reply || 'Yanıt alınamadı.' }]);
      if (r.changed) notifyDataChanged();
    } catch (err) {
      setMessages([...next, { role: 'assistant', content: err.message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Asistanı kapat' : 'Asistanı aç'}
        className="fixed bottom-6 right-6 z-[1150] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-teal-500 text-white shadow-lg transition hover:scale-105"
      >
        {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Asistan"
          className="fixed bottom-24 right-6 z-[1150] flex h-[min(560px,calc(100vh-8rem))] w-[min(380px,calc(100vw-3rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
        >
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-teal-500 text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            <p className="font-semibold text-slate-900">GLYDE Asistan</p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="text-sm text-slate-500">Merhaba {user.name.split(' ')[0]}, size nasıl yardımcı olabilirim?</p>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm ${
                    m.role === 'user'
                      ? 'bg-gradient-to-r from-sky-500 to-teal-500 text-white'
                      : m.error ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  <RichText text={m.content} />
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Yanıt hazırlanıyor
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="flex items-center gap-2 border-t border-slate-100 p-3"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Mesajınızı yazın"
              aria-label="Mesaj"
              maxLength={500}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Gönder"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-r from-sky-500 to-teal-500 text-white disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
