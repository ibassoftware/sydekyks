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
    { to: "/hq/missions", label: "Missions", icon: BoltIcon, match: (p) => p.startsWith("/hq/missions") || p.startsWith("/hq/issues"), badge: count + issuesCount || undefined },
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
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r-2 border-ink-600 bg-ink-900/95 backdrop-blur-sm transition-all duration-200 ${
        collapsed ? "w-[76px]" : "w-64"
      }`}
    >
      {/* Brand */}
      <div className="relative overflow-hidden border-b-2 border-ink-600 px-4 py-4">
        <Link to="/hq" className="relative flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[4px] border-2 border-gold-500 bg-ink-800 text-sm font-bold text-gold-300">S</span>
          {!collapsed && <span className="truncate text-lg font-bold uppercase tracking-[0.14em] text-heading">Sydekyks</span>}
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
          className={`group relative flex min-h-11 items-center gap-3 rounded-[4px] px-3 py-2.5 text-sm font-medium transition-colors ${
                    active ? "bg-ink-700 text-gold-300" : "text-body hover:bg-ink-800 hover:text-heading"
                  } ${collapsed ? "justify-center" : ""}`}
                >
                  {active && (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-r-[2px] bg-gold-400" />
                  )}
                  <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-gold-400" : "text-body group-hover:text-heading"}`} />
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                  {!collapsed && !!item.badge && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[2px] border border-gold-700 bg-brand-softer px-1.5 text-[11px] font-bold text-gold-300">
                      {item.badge}
                    </span>
                  )}
                  {collapsed && !!item.badge && (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gold-400" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer: rank badge + user + logout */}
      <div className="border-t-2 border-ink-600 px-3 py-4">
        {!collapsed ? (
          <div className="mb-3 flex items-center gap-2 rounded-[4px] border border-ink-700 bg-ink-800 px-3 py-2.5">
            {canManage ? (
              <ShieldIcon className="h-4 w-4 shrink-0 text-gold-400" />
            ) : (
              <StarIcon className="h-4 w-4 shrink-0 text-gold-400" />
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-heading">{canManage ? "Commander" : "Hero"}</p>
              <p className="truncate text-[11px] text-body">{user?.email}</p>
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
          className={`flex min-h-11 w-full items-center gap-3 rounded-[4px] px-3 py-2 text-sm font-medium text-body transition-colors hover:bg-ink-800 hover:text-heading ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <LogoutIcon className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span>Log out</span>}
        </button>

        <button
          onClick={() => setCollapsed((v) => !v)}
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-[4px] py-2 text-xs font-medium text-body transition-colors hover:bg-ink-800 hover:text-heading"
        >
          {collapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronLeftIcon className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
