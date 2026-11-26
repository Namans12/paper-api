import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { openStore, type Store } from '../store/db';

interface StoreCtx { store: Store; version: number; bump(): void }
const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    let cancelled = false;
    openStore().then(
      (s) => { if (!cancelled) setStore(s); },
      (e) => { if (!cancelled) setError(String(e?.message ?? e)); },
    );
    const ch = new BroadcastChannel('paper-api');
    channel.current = ch;
    ch.onmessage = (ev) => { if (ev.data === 'changed') setVersion((v) => v + 1); };
    return () => { cancelled = true; ch.close(); channel.current = null; };
  }, []);

  const bump = useCallback(() => {
    setVersion((v) => v + 1);
    channel.current?.postMessage('changed');
  }, []);

  const value = useMemo(() => (store ? { store, version, bump } : null), [store, version, bump]);

  if (error) return <p role="alert" className="status-msg">Could not open the local database: {error}</p>;
  if (!value) return <p className="status-msg" role="status">Opening local database…</p>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}
