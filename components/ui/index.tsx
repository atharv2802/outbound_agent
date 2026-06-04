"use client";

/**
 * Lightweight shadcn-style primitives, implemented manually to keep the design
 * polished without the CLI. Card / Button / Badge / Input / Label / Skeleton.
 */

import * as React from "react";
import { cn } from "@/lib/cn";

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-card border border-line bg-bg-card transition-colors hover:border-line-strong",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-5 pt-4 pb-2", className)} {...props}>
      {children}
    </div>
  );
}

export function CardBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-5 pb-5", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-xs font-medium uppercase tracking-wider text-ink-muted",
        className,
      )}
      {...props}
    >
      {children}
    </h3>
  );
}

type ButtonVariant = "primary" | "ghost" | "outline";

export function Button({
  className,
  variant = "primary",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variants: Record<ButtonVariant, string> = {
    primary:
      "bg-accent text-white hover:bg-accent-soft disabled:opacity-50 disabled:cursor-not-allowed",
    ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-bg-hover",
    outline:
      "border border-line-strong bg-transparent text-ink hover:bg-bg-hover",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-card px-4 py-2 text-sm font-medium transition-all focus-visible:outline-none",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

type BadgeTone = "neutral" | "accent" | "good" | "warn" | "bad";

export function Badge({
  className,
  tone = "neutral",
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-bg-hover text-ink-muted border-line",
    accent: "bg-accent/10 text-accent border-accent/30",
    good: "bg-good/10 text-good border-good/30",
    warn: "bg-warn/10 text-warn border-warn/30",
    bad: "bg-bad/10 text-bad border-bad/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-card border border-line bg-bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
});

export function Label({
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-muted",
        className,
      )}
      {...props}
    >
      {children}
    </label>
  );
}

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shimmer animate-shimmer rounded-card", className)}
      {...props}
    />
  );
}
