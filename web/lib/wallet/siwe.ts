"use client";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { api } from "@/lib/api/rest";

const JWT_KEY = "perplex.jwt";
const JWT_EXP_KEY = "perplex.jwt.expiresAt";
const JWT_EVENT = "perplex.jwt.change";

export function readStoredJwt(): { jwt: string; expiresAt: string } | null {
  if (typeof window === "undefined") return null;
  const jwt = window.localStorage.getItem(JWT_KEY);
  const expiresAt = window.localStorage.getItem(JWT_EXP_KEY);
  if (!jwt || !expiresAt) return null;
  if (Date.parse(expiresAt) <= Date.now()) {
    window.localStorage.removeItem(JWT_KEY);
    window.localStorage.removeItem(JWT_EXP_KEY);
    return null;
  }
  return { jwt, expiresAt };
}

function emitJwtChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(JWT_EVENT));
  }
}

function writeJwt(jwt: string, expiresAt: string) {
  window.localStorage.setItem(JWT_KEY, jwt);
  window.localStorage.setItem(JWT_EXP_KEY, expiresAt);
  emitJwtChange();
}

export function clearJwt() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(JWT_KEY);
  window.localStorage.removeItem(JWT_EXP_KEY);
  emitJwtChange();
}

// useSyncExternalStore needs a stable snapshot reference. Cache the result of
// readStoredJwt() and only return a new object when the underlying value
// actually changes — otherwise React would treat every snapshot as new and
// loop endlessly.
let cachedSnapshot: { jwt: string; expiresAt: string } | null = null;
function jwtSnapshot(): { jwt: string; expiresAt: string } | null {
  const fresh = readStoredJwt();
  if (
    (cachedSnapshot?.jwt ?? null) === (fresh?.jwt ?? null) &&
    (cachedSnapshot?.expiresAt ?? null) === (fresh?.expiresAt ?? null)
  ) {
    return cachedSnapshot;
  }
  cachedSnapshot = fresh;
  return cachedSnapshot;
}

function subscribeJwt(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(JWT_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(JWT_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export interface SiweState {
  hasJwt: boolean;
  expiresAt: string | null;
  isSigning: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => void;
}

export function useSiwe(): SiweState {
  const { address } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const stored = useSyncExternalStore(subscribeJwt, jwtSnapshot, () => null);
  const hasJwt = !!stored;
  const expiresAt = stored?.expiresAt ?? null;
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    if (!address) {
      setError("Connect a wallet first.");
      return;
    }
    setIsSigning(true);
    setError(null);
    try {
      const { nonce } = await api.siweNonce(address);
      const domain = typeof window !== "undefined" ? window.location.host : "perplex.local";
      const uri = typeof window !== "undefined" ? window.location.origin : "https://perplex.local";
      const message = new SiweMessage({
        domain,
        address,
        statement: "Sign in to Perplex.",
        uri,
        version: "1",
        chainId,
        nonce,
        issuedAt: new Date().toISOString(),
      }).prepareMessage();
      const signature = await signMessageAsync({ message });
      const verify = await api.siweVerify(message, signature);
      writeJwt(verify.jwt, verify.expiresAt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setIsSigning(false);
    }
  }, [address, chainId, signMessageAsync]);

  const signOut = useCallback(() => {
    clearJwt();
  }, []);

  return { hasJwt, expiresAt, isSigning, error, signIn, signOut };
}
