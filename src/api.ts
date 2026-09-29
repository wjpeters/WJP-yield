import { useCallback, useEffect, useRef, useState } from "react";
import type { State } from "./types";
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "X-Yield-Request": "1",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const d = await r.json();
  if (!r.ok) {
    const details = Array.isArray(d.details)
      ? d.details
          .map(
            (v: { provider: string; error: string }) =>
              `${v.provider}: ${v.error}`,
          )
          .join(" · ")
      : "";
    throw new Error(
      [d.error ?? "Verzoek mislukt", details].filter(Boolean).join(". "),
    );
  }
  return d;
}
export function useTerminal() {
  const [state, setState] = useState<State | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const d = await api<State>("/state");
      if (alive.current) {
        setState(d);
        setError("");
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    let watchdog: ReturnType<typeof setInterval>;
    let attempt = 0;
    let last = Date.now();
    refresh();
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      );
      socket.onopen = () => {
        attempt = 0;
        last = Date.now();
        setConnected(true);
      };
      socket.onmessage = (e) => {
        last = Date.now();
        try {
          setState(JSON.parse(e.data));
          setError("");
        } catch {}
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        setConnected(false);
        setState((old) =>
          old
            ? {
                ...old,
                quotes: Object.fromEntries(
                  Object.entries(old.quotes).map(([k, q]) => [
                    k,
                    q ? { ...q, stale: true } : q,
                  ]),
                ),
                comparisons: Object.fromEntries(
                  Object.entries(old.comparisons).map(([k, rows]) => [
                    k,
                    rows.map((q) => ({ ...q, stale: true })),
                  ]),
                ),
              }
            : old,
        );
        if (alive.current)
          timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++));
      };
    };
    connect();
    watchdog = setInterval(() => {
      if (Date.now() - last > 10000) {
        setConnected(false);
        socket.close();
      }
    }, 5000);
    return () => {
      alive.current = false;
      clearTimeout(timer);
      clearInterval(watchdog);
      socket.onclose = null;
      socket.close();
    };
  }, [refresh]);
  return { state, connected, error, refresh };
}
export const price = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(v);
export const percent = (v: number | null | undefined) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
export const time = (v: number | null | undefined) =>
  v ? new Date(v).toLocaleTimeString("nl-NL", { hour12: false }) : "—";
export function age(v: number | null | undefined) {
  if (!v) return "onbekend";
  const sec = Math.max(0, Math.floor((Date.now() - v) / 1000));
  return sec < 60
    ? `${sec}s geleden`
    : sec < 3600
      ? `${Math.floor(sec / 60)}m geleden`
      : `${Math.floor(sec / 3600)}u geleden`;
}

export const stamp = (v: number) =>
  new Date(v).toLocaleString("nl-NL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
