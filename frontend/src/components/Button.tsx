import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "lg";
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-2xl font-medium transition active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none touch-manipulation select-none";
  const sizes = size === "lg" ? "min-h-14 px-6 text-base" : "min-h-11 px-4 text-sm";
  const variants = {
    primary: "bg-ink text-white hover:bg-black",
    secondary: "bg-white text-ink border border-border hover:bg-surface",
    ghost: "bg-transparent text-ink hover:bg-black/5",
    danger: "bg-danger text-white hover:bg-red-700",
  } as const;

  return (
    <button
      className={`${base} ${sizes} ${variants[variant]} ${className}`}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
