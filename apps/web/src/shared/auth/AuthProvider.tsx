import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch, configureApiClient } from '../api/client';
import { decodeClaims, getAccessToken, setAccessToken } from './session';
import type { AccessClaims } from '../api/types';
let didRestoreSession = false;
interface AuthState {
  ready: boolean;
  claims: AccessClaims | null;
  isAuthenticated: boolean;
  isPlatform: boolean;
  signIn: (email: string, password: string, totp?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

type LoginResponse = { data: { accessToken: string } };
type RefreshResponse = { data: { accessToken: string } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [claims, setClaims] = useState<AccessClaims | null>(() => {
    const token = getAccessToken();
    return token ? (decodeClaims(token) as AccessClaims | null) : null;
  });

  const apply = useCallback((token: string | null) => {
    setAccessToken(token);
    setClaims(token ? (decodeClaims(token) as AccessClaims | null) : null);
  }, []);

  // Configura el cliente HTTP una sola vez.
  useEffect(() => {
    configureApiClient({
      getAccessToken,
      setAccessToken: (t) => apply(t),
      onUnauthorized: () => apply(null),
    });
  }, [apply]);

  const signIn = useCallback(
    async (email: string, password: string, totp?: string) => {
      const res = await apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email, password, ...(totp ? { twoFactorCode: totp } : {}) },
        skipAuth: true,
      });
      apply(res.data.accessToken);
    },
    [apply],
  );
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      // Si ya tenemos un accessToken de sessionStorage, no refrescamos.
      if (getAccessToken()) {
        setReady(true);
        return;
      }
      // Sólo la primera invocación intenta el refresh (evita StrictMode doble).
      if (didRestoreSession) {
        setReady(true);
        return;
      }
      didRestoreSession = true;

      const res = await apiFetch<RefreshResponse>('/auth/refresh', {
        method: 'POST',
        skipAuth: true,
      });
      if (!cancelled) apply(res.data.accessToken);
    } catch {
      /* sin sesión restaurable */
    } finally {
      if (!cancelled) setReady(true);
    }
  })();
  return () => {
    cancelled = true;
  };
}, [apply]);
  const signOut = useCallback(async () => {
    try {
      await apiFetch<void>('/auth/logout', { method: 'POST' });
    } catch {
      /* ignorar: la sesión local se limpia igual */
    }
    apply(null);
    didRestoreSession = false;
  }, [apply]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      claims,
      isAuthenticated: claims !== null,
      isPlatform: claims?.plat === true,
      signIn,
      signOut,
    }),
    [ready, claims, signIn, signOut],
    
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return v;
}