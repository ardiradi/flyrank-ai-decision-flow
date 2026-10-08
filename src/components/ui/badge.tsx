import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function Badge({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", className)} {...props} />;
}
