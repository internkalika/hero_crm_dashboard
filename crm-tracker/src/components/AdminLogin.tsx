import { FormEvent, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Card, Notice } from './ui';
import { useAdmin } from '../state/AdminContext';
import { loginErrorMessage } from '../lib/sync/admin';

/**
 * The administrator's sign-in: the fixed email address and the administrator password. Nothing is remembered by the page:
 * the password lives in this field until it is sent, then it is cleared; the session is an HttpOnly cookie the page cannot read.
 */
export function AdminLogin({ compact }: { compact?: boolean }) {
  const { signIn } = useAdmin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      setPassword('');
    } catch (e) {
      setPassword('');
      setError(loginErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3" aria-label="Administrator sign-in" autoComplete="on">
        {!compact && <p className="text-sm text-ink-2">Only the administrator can import, validate, publish, view the version history or restore data. Everyone can view the dashboards.</p>}
        <div className="flex max-w-3xl flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="label" htmlFor="admin-email">Administrator email</label>
            <input id="admin-email" name="email" type="email" autoComplete="username" spellCheck={false} className="input mt-1 w-full" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="min-w-[16rem] flex-1">
            <label className="label" htmlFor="admin-password">Password</label>
            <input id="admin-password" name="password" type="password" autoComplete="current-password" className="input mt-1 w-full" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={!email || !password || busy}><ShieldCheck size={14} /> {busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
        {error && <Notice tone="bad" title="Sign-in failed">{error}</Notice>}
      </form>
    </Card>
  );
}
