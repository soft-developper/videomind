"use client";
// vm_signin: who is signed in.
//
// Connecting a wallet only tells the page an address. Signing in proves
// the visitor controls it: the wallet signs a one time message and the
// API answers with a session. Everything that reads or changes a
// library needs that session.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { api } from "@/lib/api";
import { getSession, setSession, subscribe, sameWallet } from "@/lib/session";
import { performSignIn } from "@/lib/signin";

interface AuthState {
  /** wallet connected AND signed in as that wallet */
  signedIn: boolean;
  /** a sign in is waiting on the wallet or the API */
  signing: boolean;
  /** why the last sign in attempt failed, if it did */
  error: string | null;
  /** the connected address, but only once signed in */
  wallet: string | undefined;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** call just before a visitor picks a wallet, to sign in right after it connects */
  armSignIn: () => void;
}

const Ctx = createContext<AuthState | null>(null);

function readable(e: any): string {
  const m = String(e?.message ?? e ?? "");
  if (/reject|denied|cancel/i.test(m)) return "Sign in was cancelled in the wallet.";
  return m || "Sign in failed. Please try again.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { connected, account, signMessage } = useWallet();
  const address = account?.address?.toString();
  const session = useSyncExternalStore(subscribe, getSession, () => null);

  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = useRef(false);
  const busy = useRef(false);

  const signedIn = !!(connected && address && session && sameWallet(session.wallet, address));

  const signIn = useCallback(async () => {
    if (!connected || !account || !address || busy.current) return;
    busy.current = true; setSigning(true); setError(null);
    try {
      const next = await performSignIn({
        http: api,
        address,
        publicKey: account.publicKey,
        signMessage: (input) => signMessage(input) as any,
      });
      setSession(next);
    } catch (e) {
      setError(readable(e));
    } finally {
      busy.current = false; setSigning(false);
    }
  }, [connected, account, address, signMessage]);

  const signOut = useCallback(async () => {
    armed.current = false;
    if (getSession()) await api.post("/api/auth/logout").catch(() => {});
    setSession(null);
    setError(null);
  }, []);

  const armSignIn = useCallback(() => { armed.current = true; }, []);

  // A stored session for a different wallet than the one now connected is dropped.
  useEffect(() => {
    if (connected && address && session && !sameWallet(session.wallet, address)) setSession(null);
  }, [connected, address, session]);

  // Sign in straight after a connect the visitor started. A wallet that
  // reconnects by itself on page load never opens a signature request:
  // the prompt at the bottom of the page offers it instead.
  useEffect(() => {
    if (connected && address && armed.current && !signedIn) {
      armed.current = false;
      void signIn();
    }
  }, [connected, address, signedIn, signIn]);

  // Confirm a stored session is still good. A 401 clears it (see lib/api.ts).
  useEffect(() => {
    if (signedIn) api.get("/api/auth/me").catch(() => {});
  }, [signedIn]);

  useEffect(() => { if (!connected) setError(null); }, [connected]);

  const value = useMemo<AuthState>(() => ({
    signedIn, signing, error,
    wallet: signedIn ? address : undefined,
    signIn, signOut, armSignIn,
  }), [signedIn, signing, error, address, signIn, signOut, armSignIn]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

/** The connected wallet address, but only once it has signed in. */
export function useSessionWallet(): string | undefined {
  return useAuth().wallet;
}
