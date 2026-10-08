import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function Card({ className, ...props }: ComponentProps<"section">) { return <section className={cn("rounded-xl border border-slate-200 bg-white", className)} {...props} />; }
