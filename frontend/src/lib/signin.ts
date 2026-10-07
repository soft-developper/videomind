// src/lib/signin.ts
// vm_signin: the wallet sign in exchange, with no React in it.
//
//   1. ask the API for a one time nonce and the message to sign
//   2. have the wallet sign it (signMessage, supported by every Aptos wallet)
//   3. send the signature back; the API answers with a session token
//
// The wallet is asked to stamp its address, the site address and the
// chain id on the message. The API refuses a message that the wallet did
// not stamp with this site's address, which is what stops another site
// from collecting a signature and using it here.
import type { Session } from "./session";

/** Minimal HTTP surface, so this file does not depend on axios. */
export interface SignInHttp {
  get(path: string): Promise<{ data: any }>;
  post(path: string, body: unknown): Promise<{ data: any }>;
}

export interface SignMessageFn {
  (input: { message: string; nonce: string; address?: boolean; application?: boolean; chainId?: boolean }): Promise<{
    fullMessage: string;
    signature: unknown;
  }>;
}

/**
 * Hex of a key or signature as the wallet returned it. Wallets return SDK
 * objects (which serialize to BCS), and a few return bytes or hex text.
 */
export function toHex(v: unknown): string {
  const anyV = v as any;
  if (anyV && typeof anyV.bcsToHex === "function") return String(anyV.bcsToHex().toString());
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) return "0x" + Array.from(v).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (anyV && anyV.data instanceof Uint8Array) return toHex(anyV.data);
  if (anyV && typeof anyV.toString === "function") return String(anyV.toString());
  throw new Error("The wallet returned a signature in a form VideoMind cannot read.");
}

export async function performSignIn(args: {
  http: SignInHttp;
  address: string;
  publicKey: unknown;
  signMessage: SignMessageFn;
}): Promise<Session> {
  const { data: issued } = await args.http.get("/api/auth/nonce");
  const signed = await args.signMessage({
    message: issued.message,
    nonce: issued.nonce,
    address: true,
    application: true,
    chainId: true,
  });
  const { data } = await args.http.post("/api/auth/verify", {
    address: args.address,
    nonce: issued.nonce,
    fullMessage: signed.fullMessage,
    signature: toHex(signed.signature),
    publicKey: toHex(args.publicKey),
  });
  return { token: data.token, wallet: data.wallet, expiresAt: data.expiresAt };
}
