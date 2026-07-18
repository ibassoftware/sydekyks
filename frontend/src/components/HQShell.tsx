import type { ReactNode } from "react";
import { PageShell } from "./ui";
import { HQSidebar } from "./HQSidebar";

/** Shared shell for every tenant-facing HQ page: persistent sidebar nav + content area. Each page
 * keeps its own <main> content - this only replaces the old per-page top <header>. */
export function HQShell({ children }: { children: ReactNode }) {
  return (
    <PageShell>
      <div className="flex min-h-screen">
        <HQSidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </PageShell>
  );
}
