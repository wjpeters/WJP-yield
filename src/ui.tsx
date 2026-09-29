import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Sluiten">
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Dot({
  good = false,
  warn = false,
}: {
  good?: boolean;
  warn?: boolean;
}) {
  return <span className={`dot ${good ? "good" : warn ? "warn" : ""}`} />;
}
export function SymbolMark({
  symbol,
  small = false,
}: {
  symbol: string;
  small?: boolean;
}) {
  const s = symbol.split("/")[0];
  return (
    <span
      className={`symbol-mark ${small ? "small" : ""} symbol-${s.toLowerCase()}`}
    >
      {s === "BTC" ? "₿" : s.slice(0, 2)}
    </span>
  );
}
