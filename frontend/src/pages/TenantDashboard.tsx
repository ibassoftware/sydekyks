import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Dashboard } from "../lib/api";
import { useAuth } from "../lib/auth";
import { HeaderActivity, RecentMissionsStrip } from "../lib/activity";
import { Button, Card, PageShell } from "../components/ui";

export default function TenantDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Dashboard>("/tenant/dashboard").then((res) => {
      setDashboard(res.data);
      setLoading(false);
    });
  }, []);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const hasQuota = !!dashboard?.power_meter_quota;
  const powerPct =
    dashboard && hasQuota ? Math.min(100, Math.round((dashboard.power_meter_used / dashboard.power_meter_quota!) * 100)) : 0;

  return (
    <PageShell>
      <header className="border-b border-ink-700 bg-ink-900/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 text-lg font-bold tracking-wide text-gold-300">
            <span className="text-2xl">⚡</span> SYDEKYKS
          </div>
          <div className="flex items-center gap-4">
            <Link to="/hq/roster" className="text-sm font-semibold text-gold-400 hover:text-gold-300">
              Roster
            </Link>
            <Link to="/hq/missions" className="text-sm font-semibold text-gold-400 hover:text-gold-300">
              Missions
            </Link>
            <Link to="/hq/gadgets" className="text-sm font-semibold text-gold-400 hover:text-gold-300">
              Gadgets
            </Link>
            {user?.role === "commander" && (
              <Link to="/hq/settings" className="text-sm font-semibold text-gold-400 hover:text-gold-300">
                Settings
              </Link>
            )}
            <HeaderActivity />
            <span className="text-sm text-[#b9ad98]">{user?.email}</span>
            <Button variant="ghost" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {loading || !dashboard ? (
          <p className="text-sm text-[#b9ad98]">Loading your HQ…</p>
        ) : (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gold-500">Headquarters</p>
              <h1 className="mt-1 text-3xl font-bold text-[#f5eee0]">{dashboard.tenant_name}</h1>
              <p className="mt-1 text-sm text-[#8a7f6d]">/{dashboard.tenant_slug} · {dashboard.plan} plan</p>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <Link to="/hq/roster">
                <Card className="p-6 transition-colors hover:border-gold-500/60">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Roster Sydekyks</p>
                  <p className="mt-2 text-3xl font-bold text-[#f5eee0]">{dashboard.roster_sydekyk_count}</p>
                  <p className="mt-1 text-sm text-[#8a7f6d]">Shared agents available to your team</p>
                </Card>
              </Link>
              <Link to="/hq/roster">
                <Card className="p-6 transition-colors hover:border-gold-500/60">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Exclusive Sydekyks</p>
                  <p className="mt-2 text-3xl font-bold text-[#f5eee0]">{dashboard.exclusive_sydekyk_count}</p>
                  <p className="mt-1 text-sm text-[#8a7f6d]">Built just for your HQ</p>
                </Card>
              </Link>
              <Card className="p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-gold-500">Estimated Power Usage</p>
                <p className="mt-2 text-3xl font-bold text-[#f5eee0]">
                  ${dashboard.power_meter_used.toFixed(2)}
                  {hasQuota && (
                    <span className="text-base font-normal text-[#8a7f6d]"> / ${dashboard.power_meter_quota!.toFixed(2)}</span>
                  )}
                </p>
                {hasQuota ? (
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
                    <div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400" style={{ width: `${powerPct}%` }} />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[#8a7f6d]">No quota set</p>
                )}
                {dashboard.power_meter_stale && (
                  <p className="mt-2 text-xs text-[#8a7f6d]">Showing last known value — reconnecting…</p>
                )}
              </Card>
            </div>

            <Card className="mt-6 p-6">
              <RecentMissionsStrip />
            </Card>

            <Card className="mt-6 flex flex-col items-center gap-4 p-10 text-center">
              <p className="text-[#b9ad98]">Activate Sydekyks from the Roster to put them to work for your team.</p>
              <div className="flex gap-3">
                <Link to="/hq/roster">
                  <Button>Open the Roster</Button>
                </Link>
                <Link to="/hq/missions">
                  <Button variant="ghost">View Missions</Button>
                </Link>
              </div>
            </Card>
          </>
        )}
      </main>
    </PageShell>
  );
}
