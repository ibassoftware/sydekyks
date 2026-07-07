import { useEffect, useState, type ComponentType } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useActivity } from "../lib/activity";
import {
  BoltIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GearIcon,
  HomeIcon,
  LogoutIcon,
  ShieldIcon,
  StarIcon,
  ToolIcon,
  UsersIcon,
  WarningIcon,
} from "./icons";

const COLLAPSE_KEY = "sydekyks_sidebar_collapsed";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  match: (path: string) => boolean;
  badge?: number;
}

export function HQSidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { count, issuesCount } = useActivity();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const canManage = user?.role === "commander";

  const items: NavItem[] = [
    { to: "/hq", label: "Command Center", icon: HomeIcon, match: (p) => p === "/hq" },
    { to: "/hq/roster", label: "Roster", icon: UsersIcon, match: (p) => p.startsWith("/hq/roster") },
    { to: "/hq/missions", label: "Missions", icon: BoltIcon, match: (p) => p.startsWith("/hq/missions"), badge: count || undefined },
    { to: "/hq/issues", label: "Issues", icon: WarningIcon, match: (p) => p.startsWith("/hq/issues"), badge: issuesCount || undefined },
    { to: "/hq/gadgets", label: "Utility Belt", icon: ToolIcon, match: (p) => p.startsWith("/hq/gadgets") },
  ];
  if (canManage) {
    items.push({ to: "/hq/team", label: "Team", icon: ShieldIcon, match: (p) => p.startsWith("/hq/team") });
    items.push({ to: "/hq/settings", label: "Settings", icon: GearIcon, match: (p) => p.startsWith("/hq/settings") });
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-ink-700 bg-ink-900/70 backdrop-blur-sm transition-all duration-200 ${
        collapsed ? "w-[76px]" : "w-64"
      }`}
    >
      {/* Brand */}
      <div className="relative overflow-hidden border-b border-ink-700 px-4 py-5">
        <div className="pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full bg-gold-500/10 blur-2xl" />
        <Link to="/hq" className="relative flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl"
            style={{ filter: "drop-shadow(0 0 10px rgba(212,168,40,0.6))" }}
          >
            ⚡
          </span>
          {!collapsed && <span className="truncate text-lg font-bold tracking-wide text-gold-300">SYDEKYKS</span>}
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="grid gap-1">
          {items.map((item) => {
            const active = item.match(location.pathname);
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                    active ? "bg-gold-500/10 text-gold-300" : "text-[#a89a82] hover:bg-ink-800/70 hover:text-[#ede6da]"
                  } ${collapsed ? "justify-center" : ""}`}
                >
                  {active && (
                    <span className="absolute inset-y-1 left-0 w-1 rounded-r bg-gradient-to-b from-gold-400 to-gold-600 shadow-[0_0_8px_1px_rgba(234,194,95,0.6)]" />
                  )}
                  <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-gold-400" : "text-[#8a7f6d] group-hover:text-[#d8cdb9]"}`} />
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                  {!collapsed && !!item.badge && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gold-500/20 px-1.5 text-[11px] font-bold text-gold-300">
                      {item.badge}
                    </span>
                  )}
                  {collapsed && !!item.badge && (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gold-400 shadow-[0_0_6px_2px_rgba(234,194,95,0.7)]" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer: rank badge + user + logout */}
      <div className="border-t border-ink-700 px-3 py-4">
        {!collapsed ? (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-ink-800/50 px-3 py-2.5">
            {canManage ? (
              <ShieldIcon className="h-4 w-4 shrink-0 text-gold-400" />
            ) : (
              <StarIcon className="h-4 w-4 shrink-0 text-gold-400" />
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[#ede6da]">{canManage ? "Commander" : "Hero"}</p>
              <p className="truncate text-[11px] text-[#8a7f6d]">{user?.email}</p>
            </div>
          </div>
        ) : (
          <div className="mb-3 flex justify-center">
            {canManage ? <ShieldIcon className="h-4 w-4 text-gold-400" /> : <StarIcon className="h-4 w-4 text-gold-400" />}
          </div>
        )}

        <button
          onClick={handleLogout}
          title={collapsed ? "Log out" : undefined}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-[#a89a82] transition-colors hover:bg-ink-800/70 hover:text-[#ede6da] ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <LogoutIcon className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span>Log out</span>}
        </button>

        <button
          onClick={() => setCollapsed((v) => !v)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold text-[#8a7f6d] transition-colors hover:bg-ink-800/70 hover:text-[#d8cdb9]"
        >
          {collapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronLeftIcon className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
