// The data assistant: a floating button (bottom right) that opens a chat panel.
//
// It answers from the data imported in this browser with the rule-based engine in lib/assistant. It is not a generative AI
// model and it sends nothing anywhere (no key, no network call), and the panel says so. If it cannot match a question it
// says that instead of inventing a figure. Every answer shows the period and dealers it used, the figures it is built from,
// and links to the records. The dashboard works the same without it.
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, MessageCircle, RotateCcw, SendHorizontal, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { useData } from '../state/DataContext';
import { useGrowthState } from '../pages/growth/shared';
import { Answer, EXAMPLE_QUESTIONS, ask } from '../lib/assistant/engine';

type Msg = { id: number; from: 'user'; text: string } | { id: number; from: 'bot'; answer: Answer } | { id: number; from: 'error'; text: string; question: string } | { id: number; from: 'loading' };

const GREETING = 'Hello. I answer questions from the data imported in this browser, for the periods and filters on screen. Try one of these:';

export function Assistant() {
  const { data, settings, asOf, period } = useData();
  const { input } = useGrowthState();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(1);
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const asked = useRef<string[]>([]);
  const recall = useRef(-1);

  // the figures follow whatever is on screen when the question is asked
  const ctx = useMemo(() => ({ data, settings, asOf, period, input }), [data, settings, asOf, period, input]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    if (open) window.setTimeout(() => field.current?.focus(), 30);
  }, [open]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  const send = useCallback((question: string) => {
    const q = question.trim();
    if (!q) return;
    asked.current.push(q);
    recall.current = -1;
    const uid = seq.current++;
    const lid = seq.current++;
    setMsgs((m) => [...m, { id: uid, from: 'user', text: q }, { id: lid, from: 'loading' }]);
    setText('');
    setBusy(true);
    // answer on the next tick so the "Calculating" state paints before a heavy calculation starts
    window.setTimeout(() => {
      let reply: Msg;
      try {
        reply = { id: lid, from: 'bot', answer: ask(q, ctxRef.current) };
      } catch (e) {
        reply = { id: lid, from: 'error', text: e instanceof Error ? e.message : 'Unknown error', question: q };
      }
      setMsgs((m) => m.map((x) => (x.id === lid ? reply : x)));
      setBusy(false);
    }, 30);
  }, []);

  const go = (to: string) => {
    nav(to);
    if (window.matchMedia('(max-width: 639px)').matches) setOpen(false);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) send(text);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    const h = asked.current;
    if (e.key === 'ArrowUp' && h.length) {
      e.preventDefault();
      recall.current = recall.current < 0 ? h.length - 1 : Math.max(0, recall.current - 1);
      setText(h[recall.current]);
    } else if (e.key === 'ArrowDown' && recall.current >= 0) {
      e.preventDefault();
      recall.current = recall.current + 1 >= h.length ? -1 : recall.current + 1;
      setText(recall.current < 0 ? '' : h[recall.current]);
    }
  };
  const clear = () => {
    setMsgs([]);
    asked.current = [];
    recall.current = -1;
    setBusy(false);
  };

  return (
    <div className="print:hidden">
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label="Open the data assistant" className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-hero-600 px-4 py-3 text-sm font-semibold text-white shadow-pop transition-colors hover:bg-hero-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600 focus-visible:ring-offset-2">
          <MessageCircle size={18} aria-hidden />
          <span className="hidden sm:inline">Ask the data</span>
        </button>
      )}
      {open && (
        <section role="dialog" aria-label="Data assistant" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} className="fixed bottom-3 right-3 z-40 flex h-[min(640px,calc(100vh-1.5rem))] w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
          <header className="flex items-start justify-between gap-2 border-b border-slate-200 bg-hero-600 px-4 py-3 text-white">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold leading-tight">Data assistant</h2>
              <p className="text-[11px] leading-snug text-white/85">Answers from the data in this browser. Rule-based, not generative AI; nothing leaves your computer.</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={clear} disabled={!msgs.length} aria-label="Clear the conversation" title="Clear the conversation" className="rounded p-1.5 hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40">
                <Trash2 size={16} aria-hidden />
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close the assistant" className="rounded p-1.5 hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
                <X size={16} aria-hidden />
              </button>
            </div>
          </header>

          <div ref={log} role="log" aria-live="polite" aria-label="Conversation" className="flex-1 space-y-3 overflow-y-auto bg-surface-2 px-3 py-3">
            <Bubble>
              <p className="text-sm text-ink">{GREETING}</p>
              <Chips items={EXAMPLE_QUESTIONS} onPick={send} disabled={busy} />
            </Bubble>
            {msgs.map((m) => {
              if (m.from === 'user') return <div key={m.id} className="ml-8 rounded-lg rounded-br-sm bg-hero-50 px-3 py-2 text-sm text-ink">{m.text}</div>;
              if (m.from === 'loading') return (
                <Bubble key={m.id}>
                  <p className="flex items-center gap-2 text-sm text-ink-2" role="status">
                    <Loader2 size={14} className="animate-spin" aria-hidden /> Calculating from the data…
                  </p>
                </Bubble>
              );
              if (m.from === 'error') return (
                <Bubble key={m.id} tone="bad">
                  <p className="text-sm font-semibold text-bad-text">That calculation failed.</p>
                  <p className="mt-0.5 break-words text-xs text-ink-2">{m.text}</p>
                  <button type="button" disabled={busy} onClick={() => send(m.question)} className="btn btn-sm mt-2"><RotateCcw size={12} aria-hidden /> Try again</button>
                </Bubble>
              );
              return <AnswerView key={m.id} a={m.answer} go={go} send={send} busy={busy} />;
            })}
          </div>

          <form onSubmit={submit} className="flex items-center gap-2 border-t border-slate-200 bg-white p-2.5">
            <label htmlFor="assistant-input" className="sr-only">Ask a question about the data</label>
            <input ref={field} id="assistant-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} placeholder="Ask about growth, a dealer, complaints…" autoComplete="off" className="input min-w-0 flex-1 py-2 text-sm" />
            <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="btn btn-primary btn-sm h-9 w-9 shrink-0 justify-center p-0">
              <SendHorizontal size={16} aria-hidden />
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

function Bubble({ children, tone }: { children: React.ReactNode; tone?: 'bad' }) {
  return <div className={clsx('mr-4 rounded-lg rounded-bl-sm border bg-white px-3 py-2.5 shadow-card', tone === 'bad' ? 'border-bad/40' : 'border-slate-200')}>{children}</div>;
}

function Chips({ items, onPick, disabled }: { items: string[]; onPick: (q: string) => void; disabled?: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((q) => (
        <button key={q} type="button" disabled={disabled} onClick={() => onPick(q)} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-left text-xs font-medium text-ink-2 hover:border-hero-600 hover:text-hero-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600 disabled:opacity-50">
          {q}
        </button>
      ))}
    </div>
  );
}

function AnswerView({ a, go, send, busy }: { a: Answer; go: (to: string) => void; send: (q: string) => void; busy: boolean }) {
  const showMeta = a.period !== '—' || a.scope !== '—';
  return (
    <Bubble>
      <h3 className="text-sm font-semibold leading-snug text-ink">{a.title}</h3>
      <div className="mt-1 space-y-1.5">
        {a.paragraphs.map((p, i) => (
          <p key={i} className="text-xs leading-relaxed text-ink-2">{p}</p>
        ))}
      </div>
      {a.figures.length > 0 && (
        <dl className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 bg-slate-50 text-xs" aria-label="Figures used">
          {a.figures.map((f, i) => (
            <div key={`${f.label}-${i}`} className="flex items-start justify-between gap-3 px-2.5 py-1.5">
              <dt className="min-w-0 text-ink-2">
                {f.label}
                {f.note && <span className="block text-[11px] leading-snug text-ink-3">{f.note}</span>}
              </dt>
              <dd className="tnum shrink-0 text-right font-semibold text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {showMeta && (
        <p className="mt-2 text-[11px] leading-snug text-ink-3">
          <strong className="font-semibold text-ink-2">Period:</strong> {a.period}
          <br />
          <strong className="font-semibold text-ink-2">Dealers:</strong> {a.scope}
        </p>
      )}
      {(a.records.length > 0 || a.actions.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...a.actions, ...a.records].map((l) => (
            <button key={`${l.label}-${l.to}`} type="button" onClick={() => go(l.to)} className="inline-flex items-center gap-1 rounded-md bg-hero-50 px-2 py-1 text-xs font-semibold text-hero-700 hover:bg-hero-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-600">
              {l.label} <ArrowRight size={11} aria-hidden />
            </button>
          ))}
        </div>
      )}
      {a.suggestions && <Chips items={a.suggestions} onPick={send} disabled={busy} />}
    </Bubble>
  );
}
