"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

export function PendingButton({
  children,
  pendingLabel = "Working…",
  className = "",
  disabled = false,
  title,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return <button type="submit" title={title} disabled={disabled || pending} aria-busy={pending} className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}>
    {pending ? <><LoaderCircle className="h-4 w-4 animate-spin" />{pendingLabel}</> : children}
  </button>;
}
