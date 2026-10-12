import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, onAuthProblem } from './api';

export interface User {
  id: number;
  login: string;
  full_name: string;
  position: string | null;
  role_code: string;
  role_name: string;
  permissions: string[];
  sections: string[];
  must_change_password: boolean;
}

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'int' | 'enum' | 'yesno';
  core?: boolean;
  unit?: string;
  source?: string;
  confidential?: boolean;
  filter?: boolean;
  required?: boolean;
  table?: boolean;
  valueMap?: Record<string, string>;
  hint?: string;
}

export interface Category {
  code: string;
  domain: string;
  name: string;
  short_name: string;
  description: string;
  uid_prefix: string;
  fields: FieldDef[];
  count: number;
  is_public: number;
}

export interface Meta {
  domains: { code: string; name: string; sort: number }[];
  categories: Category[];
  relations: Record<string, { label: string; reverse: string }>;
}

interface Session {
  user: User | null;
  loading: boolean;
  meta: Meta | null;
  can: (perm: string) => boolean;
  reload: () => Promise<void>;
  reloadMeta: () => Promise<void>;
  cat: (code: string) => Category | undefined;
}

const Ctx = createContext<Session>(null as unknown as Session);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadMeta = useCallback(async () => {
    try {
      setMeta(await api.get<Meta>('/categories'));
    } catch {
      setMeta(null);
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const me = await api.get<{ user: User }>('/auth/me');
      setUser(me.user);
      if (!me.user.must_change_password) await reloadMeta();
    } catch {
      setUser(null);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [reloadMeta]);

  useEffect(() => {
    reload();
    return onAuthProblem((status) => {
      if (status === 401) {
        setUser(null);
        setMeta(null);
      } else reload();
    });
  }, [reload]);

  const value: Session = {
    user,
    loading,
    meta,
    can: (p) => !!user?.permissions.includes(p),
    reload,
    reloadMeta,
    cat: (code) => meta?.categories.find((c) => c.code === code),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
