import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type IssuesOut } from "../lib/api";
import { useAuth } from "../lib/auth";
import { HeaderActivity } from "../lib/activity";
import { Badge, Button, Card, PageShell } from "../components/ui";

export default function Issues() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canManage = user?.role === "commander";
  const [issues, setIssues] = useState<IssuesOut | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<IssuesOut>("/tenant/issues").then((res) => setIssues(res.data));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(id: string) {
    setResolvingId(id);
    try {
      await api.post(`/tenant/issues/${id}/resolve`);
      load();
    } finally {
      setResolvingId(null);
    }
  }

  const total = (issues?.config_issues.length ?? 0) + (issues?.missions_needing_review.length ?? 0);

  return (
    <PageShell>
      <header className="border-b border-ink-700 bg-ink-900/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/hq" className="flex items-center gap-2 text-lg font-bold tracking-wide text-gold-300">
            <span className="text-2xl">⚡</span> SYDEKYKS
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/hq/roster" className="text-sm font-semibold text-gold-400 hover:text-gold-300">Roster</Link>
            <Link to="/hq/missions" className="text-sm font-semibold text-gold-400 hover:text-gold-300">Missions</Link>
            <HeaderActivity />
            <span className="text-sm text-[#b9ad98]">{user?.email}</span>
            <Button variant="ghost" onClick={() => { logout(); navigate("/login"); }}>Log out</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gold-500">Attention Needed</p>
          <h1 className="mt-1 text-3xl font-bold text-[#f5eee0]">Issues</h1>
          <p className="mt-1 text-sm text-[#8a7f6d]">
            Standing configuration gaps and Missions your Sydekyks flagged for manual review.
          </p>
        </div>

        {!issues ? (
          <p className="mt-8 text-sm text-[#b9ad98]">Loading…</p>
        ) : total === 0 ? (
          <Card className="mt-8 p-10 text-center">
            <p className="text-sm text-[#b9ad98]">Nothing needs your attention right now.</p>
          </Card>
        ) : (
          <div className="mt-8 grid gap-8">
            {issues.config_issues.length > 0 && (
              <section>
                <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Configuration Issues</p>
                <div className="mt-3 grid gap-3">
                  {issues.config_issues.map((issue) => (
                    <Card key={issue.id} className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge tone="danger">Needs action</Badge>
                            {issue.sydekyk_name && <span className="text-xs text-[#8a7f6d]">{issue.sydekyk_name}</span>}
                          </div>
                          <p className="mt-1.5 text-sm font-semibold text-[#ede6da]">{issue.title}</p>
                          {issue.detail && <p className="mt-1 text-sm text-[#b9ad98]">{issue.detail}</p>}
                          <p className="mt-2 text-xs text-[#8a7f6d]">
                            Seen {issue.occurrence_count}× · last {new Date(issue.last_seen_at).toLocaleString()}
                          </p>
                        </div>
                        {canManage && (
                          <Button
                            variant="ghost"
                            className="shrink-0 px-3 py-1.5 text-xs"
                            disabled={resolvingId === issue.id}
                            onClick={() => resolve(issue.id)}
                          >
                            {resolvingId === issue.id ? "…" : "Mark resolved"}
                          </Button>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {issues.missions_needing_review.length > 0 && (
              <section>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Missions Needing Review</p>
                  <Link to="/hq/missions" className="text-xs font-semibold text-gold-400 hover:text-gold-300">
                    View all Missions →
                  </Link>
                </div>
                <div className="mt-3 divide-y divide-ink-700/60 overflow-hidden rounded-lg border border-ink-700">
                  {issues.missions_needing_review.map((m) => (
                    <div key={m.mission_id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-[#ede6da]">{m.document_filename ?? "document"}</p>
                        <p className="mt-0.5 truncate text-xs text-[#8a7f6d]">
                          {m.sydekyk_name} · {m.reason ?? "Flagged for review"}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-[#8a7f6d]">{new Date(m.created_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </PageShell>
  );
}
