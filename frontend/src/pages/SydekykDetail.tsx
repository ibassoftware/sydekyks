import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  api,
  type IssuesCount,
  type LedgerReadiness,
  type Sydekyk,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, Card } from "../components/ui";
import { ConfirmUninstallModal } from "../components/ConfirmUninstallModal";
import { HQShell } from "../components/HQShell";
import { DocumentIntakeSection } from "../components/DocumentIntakeSection";
import { ReviewerAssignment } from "../components/ReviewerAssignment";
import { TypeUIPanel } from "../components/TypeUIPanel";
import { BoltIcon, GearIcon } from "../components/icons";
import { AIEngineSection } from "../components/AIEngineSection";
import { registryForSlug } from "../sydekyks/registry";
import { SettingsBand } from "../sydekyks/SettingsLayout";

export default function SydekykDetail() {
  const { sydekykId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isCommander = user?.role === "commander";
  const [sydekyk, setSydekyk] = useState<Sydekyk | null>(null);
  // Per-Sydekyk permissions (a commander has both). Run-actions gate on canUse; settings/engine on
  // canConfigure - mirrors the backend's assert_can_use / assert_can_configure so use-only heroes
  // can actually operate an agent they're granted, without seeing (blocked) config controls.
  const canUse = sydekyk?.can_use ?? isCommander;
  const canConfigure = sydekyk?.can_configure ?? isCommander;
  const [notFound, setNotFound] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [readiness, setReadiness] = useState<LedgerReadiness | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const registryEntry = registryForSlug(sydekyk?.slug);
  // Every agent uses the same workspace contract: day-to-day work lives under Actions; privileged
  // setup lives under Settings. This keeps use-only Heroes away from configuration reads as well as
  // writes, while Commanders and configure-enabled Heroes can access both surfaces.
  const [activeTab, setActiveTab] = useState<"actions" | "settings">(
    searchParams.get("tab") === "settings" ? "settings" : "actions",
  );

  useEffect(() => {
    if (!sydekykId) return;
    api
      .get<Sydekyk>(`/tenant/sydekyks/${sydekykId}`)
      .then((res) => setSydekyk(res.data))
      .catch(() => setNotFound(true));
    api
      .get<IssuesCount>("/tenant/issues/count", { params: { sydekyk_id: sydekykId } })
      .then((res) => setReviewCount(res.data.missions_needing_review))
      .catch(() => setReviewCount(0));
  }, [sydekykId]);

  useEffect(() => {
    if (!sydekyk?.accepts_document_uploads || !canUse) return;
    let current = true;
    api.get<LedgerReadiness>(`/tenant/${sydekyk.slug}/readiness`)
      .then((response) => {
        if (current) setReadiness(response.data);
      })
      .catch(() => {
        if (current) setReadiness(null);
      });
    return () => { current = false; };
  }, [canUse, sydekyk?.accepts_document_uploads, sydekyk?.slug]);

  useEffect(() => {
    if (!sydekyk || canConfigure || activeTab !== "settings") return;
    setActiveTab("actions");
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    setSearchParams(next, { replace: true });
  }, [activeTab, canConfigure, searchParams, setSearchParams, sydekyk]);

  function selectTab(tab: "actions" | "settings") {
    if (tab === "settings" && !canConfigure) return;
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === "settings") next.set("tab", "settings");
    else next.delete("tab");
    setSearchParams(next, { replace: true });
  }

  async function toggleInstall() {
    if (!sydekyk || !isCommander || sydekyk.is_exclusive) return;
    // Uninstall wipes this HQ's config for the Sydekyk — confirm via dialog before deleting.
    if (sydekyk.installed) {
      setConfirmRemove(true);
      return;
    }
    setPending(true);
    try {
      const res = await api.post<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`);
      setSydekyk(res.data);
    } finally {
      setPending(false);
    }
  }

  async function confirmUninstall() {
    if (!sydekyk) return;
    setPending(true);
    try {
      const res = await api.delete<Sydekyk>(`/tenant/sydekyks/${sydekyk.id}/install`);
      setSydekyk(res.data);
      setConfirmRemove(false);
    } finally {
      setPending(false);
    }
  }

  const active = sydekyk && (sydekyk.installed || sydekyk.is_exclusive);

  return (
    <HQShell>
      <main id="main-content" className="typeui-page mx-auto max-w-5xl px-6 py-12">
        <button onClick={() => navigate("/hq/roster")} className="mb-8 inline-flex min-h-11 items-center text-sm font-medium text-gold-300 hover:text-heading">
          ← Back to roster
        </button>

        {notFound ? (
          <Card className="p-10 text-center text-body">Sydekyk not found.</Card>
        ) : !sydekyk ? (
          <p className="text-sm text-body">Loading…</p>
        ) : (
          <div className="grid gap-6">
            {/* Hero */}
            <Card className="overflow-hidden shadow-[var(--shadow-md)]">
              <div className="grid gap-8 p-6 md:grid-cols-[240px_1fr] md:p-8">
                <div className="relative mx-auto aspect-[912/1199] w-full max-w-[240px] overflow-hidden rounded-[4px] border-2 border-ink-600 bg-ink-950">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,_var(--color-gold-600)_0%,_transparent_70%)] opacity-30" />
                  <img
                    src={sydekyk.avatar_url}
                    alt={sydekyk.name}
                    className="relative h-full w-full object-contain object-bottom"
                  />
                </div>

                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <Badge tone={sydekyk.is_exclusive ? "gold" : "neutral"}>
                      {sydekyk.is_exclusive ? "Exclusive Sydekyk" : "Roster Sydekyk"}
                    </Badge>
                    {sydekyk.chat_enabled && <Badge tone="neutral">Chat</Badge>}
                    {sydekyk.workflow_enabled && <Badge tone="neutral">Workflow</Badge>}
                    {active && (
                      <Badge tone={canConfigure ? "gold" : "neutral"}>
                        {canConfigure ? "Use + configure" : canUse ? "Use access" : "No access"}
                      </Badge>
                    )}
                  </div>
                  <h1 className="mt-6">{sydekyk.name}</h1>
                  <p className="mt-8 max-w-[65ch] flex-1 text-lg text-body">{sydekyk.description || sydekyk.tagline}</p>

                  <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t-2 border-ink-600 pt-6">
                    {sydekyk.is_exclusive ? (
                      <span className="text-sm font-semibold text-gold-400">Always active for your HQ</span>
                    ) : sydekyk.installed ? (
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold-400">
                        <span className="h-2 w-2 rounded-full bg-gold-400 shadow-[var(--shadow-sm)]" />{" "}
                        Installed for your HQ
                      </span>
                    ) : (
                      <span className="text-sm text-body">Not yet activated for your HQ</span>
                    )}

                    {!sydekyk.is_exclusive && isCommander && (
                      <Button
                        variant={sydekyk.installed ? "ghost" : "primary"}
                        disabled={pending}
                        onClick={toggleInstall}
                      >
                        {pending ? "Working…" : sydekyk.installed ? "Uninstall" : "Install Sydekyk"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            {active && reviewCount > 0 && (
              <Link
                to={`/hq/missions?view=attention&sydekyk_id=${sydekyk.id}`}
                className="fx-lift flex items-center justify-between gap-3 rounded-[4px] border-2 border-amber-600/40 bg-amber-500/10 px-5 py-4 hover:bg-amber-500/15"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
                    ⚠
                  </span>
                  <p className="text-sm font-semibold text-heading">
                    {reviewCount}{" "}
                    {reviewCount === 1
                      ? `${registryEntry?.reviewNoun?.one ?? "item"} needs`
                      : `${registryEntry?.reviewNoun?.many ?? "items"} need`}{" "}
                    review
                  </p>
                </div>
                <span className="text-xs font-semibold text-amber-400">Review now →</span>
              </Link>
            )}

            {active ? (
              <>
                <div role="tablist" aria-label={`${sydekyk.name} workspace`} className="flex border-b-2 border-ink-600">
                  {(["actions", "settings"] as const).map((tab) => {
                    const restricted = tab === "settings" && !canConfigure;
                    const Icon = tab === "actions" ? BoltIcon : GearIcon;
                    return (
                    <button
                      key={tab}
                      role="tab"
                      aria-selected={activeTab === tab}
                      aria-disabled={restricted}
                      disabled={restricted}
                      title={restricted ? "Configure access is required" : undefined}
                      onClick={() => selectTab(tab)}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-t-[4px] border-b-[3px] px-4 py-3 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:text-body/60 ${
                        activeTab === tab
                          ? "border-gold-500 text-gold-300"
                          : "border-transparent text-body hover:border-ink-600 hover:text-heading"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {tab === "actions" ? "Actions" : "Settings"}
                      {restricted && <span className="text-xs font-normal">Configure access required</span>}
                    </button>
                    );
                  })}
                </div>

                {activeTab === "actions" ? (
                  <div role="tabpanel" className="grid gap-6">
                    {!canUse ? (
                      <Card className="p-6">
                        <p className="text-base font-medium text-heading">This command post is outside your current assignment.</p>
                        <p className="mt-3 text-sm text-body">Ask a Commander to grant Use access for {sydekyk.name}.</p>
                      </Card>
                    ) : sydekyk.accepts_document_uploads ? (
                      <Card className="p-6">
                        <DocumentIntakeSection sydekyk={sydekyk} canManage={canUse} readiness={readiness} uploadContext={registryEntry?.uploadContext} />
                      </Card>
                    ) : registryEntry?.operationsPanel ? (
                      <Card className="p-6">
                        <registryEntry.operationsPanel sydekyk={sydekyk} canManage={canUse} />
                      </Card>
                    ) : (
                      <Card className="p-6 text-sm text-body">No direct actions are available for this agent yet.</Card>
                    )}
                  </div>
                ) : canConfigure ? (
                  <Card role="tabpanel" className="overflow-hidden">
                    <div className="settings-console divide-y-2 divide-ink-600">
                      {/* Agents whose setup owns the engine as a guided step (Ledger) skip this band. */}
                      {!registryEntry?.ownsEngineStep && (
                        <SettingsBand id="ai-engine" title="AI engine" description="Choose and verify the model that powers this agent's judgment and writing.">
                          <AIEngineSection sydekyk={sydekyk} canManage />
                        </SettingsBand>
                      )}
                      {registryEntry?.setupSection && (
                        registryEntry.setupSectionOwnsLayout ? (
                          <registryEntry.setupSection sydekyk={sydekyk} canManage onReadiness={setReadiness} />
                        ) : (
                          <section className="p-5 sm:p-6">
                            <registryEntry.setupSection sydekyk={sydekyk} canManage onReadiness={setReadiness} />
                          </section>
                        )
                      )}
                      {sydekyk.workflow_enabled && !registryEntry?.hideReviewerAssignment && (
                        <section className="p-5 sm:p-6">
                          <ReviewerAssignment sydekykId={sydekyk.id} canManage />
                        </section>
                      )}
                      {registryEntry?.playbookPanel && (
                        <section className="p-5 sm:p-6">
                          <registryEntry.playbookPanel />
                        </section>
                      )}
                    </div>
                  </Card>
                ) : null}
              </>
            ) : (
              <Card className="p-6 text-center text-sm text-body">
                Install this Sydekyk to configure its AI engine and put it to work.
              </Card>
            )}
          </div>
        )}
      </main>
      <TypeUIPanel />
      <ConfirmUninstallModal
        sydekykName={sydekyk?.name ?? ""}
        open={confirmRemove}
        pending={pending}
        onConfirm={confirmUninstall}
        onClose={() => setConfirmRemove(false)}
      />
    </HQShell>
  );
}
