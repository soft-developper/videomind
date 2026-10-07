"use client";
// vm_signin: shown on every page while a wallet is connected but not yet
// signed in. One place to sign in, instead of a prompt on each page.
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useAuth } from "./AuthProvider";

export function SignInNotice() {
  const { connected, account } = useWallet();
  const { signedIn, signing, error, signIn } = useAuth();

  if (!connected || !account || signedIn) return null;

  return (
    <div className="fixed bottom-5 left-1/2 lg:left-[calc(50%+118px)] -translate-x-1/2 z-30 w-full max-w-md px-4">
      <div className="popover">
        <div className="flex items-center gap-3 p-3">
          <span className={signing ? "dot dot-work" : "dot dot-off"} />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-sans text-paper">
              {signing ? "Check your wallet" : "Sign in to open your library"}
            </p>
            <p className="text-[12px] font-sans text-dim mt-0.5 leading-relaxed">
              {error ?? "One signature proves this wallet is yours. No gas, no funds moved."}
            </p>
          </div>
          <button
            onClick={() => void signIn()}
            disabled={signing}
            className="btn btn-signal px-3.5 h-9 shrink-0"
          >
            {signing ? "Waiting" : error ? "Try again" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
