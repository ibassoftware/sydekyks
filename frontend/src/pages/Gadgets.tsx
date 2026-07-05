import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { api, type Gadget, type GadgetLink } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, Card, Input, Label, Modal, PageShell } from "../components/ui";

export default function Gadgets() {
  const { user } = useAuth();
  const canManage = user?.role === "commander";
  const [gadgets, setGadgets] = useState<Gadget[] | null>(null);
  const [links, setLinks] = useState<GadgetLink[] | null>(null);
  const [addingGadget, setAddingGadget] = useState<Gadget | null>(null);
  const [editingLink, setEditingLink] = useState<GadgetLink | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    api.get<Gadget[]>("/tenant/gadgets").then((res) => setGadgets(res.data));
    api.get<GadgetLink[]>("/tenant/gadget-links").then((res) => setLinks(res.data));
  }

  function handleCreated(link: GadgetLink) {
    setLinks((prev) => [link, ...(prev ?? [])]);
    setAddingGadget(null);
  }

  function handleUpdated(link: GadgetLink) {
    setLinks((prev) => prev?.map((l) => (l.id === link.id ? link : l)) ?? null);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[link.id];
      return next;
    });
    setEditingLink(null);
  }

  async function handleTest(link: GadgetLink) {
    setTestingId(link.id);
    try {
      const res = await api.post<{ ok: boolean; message: string; link: GadgetLink }>(
        `/tenant/gadget-links/${link.id}/test`
      );
      setLinks((prev) => prev?.map((l) => (l.id === link.id ? res.data.link : l)) ?? null);
      setTestResults((prev) => ({ ...prev, [link.id]: { ok: res.data.ok, message: res.data.message } }));
    } finally {
      setTestingId(null);
    }
  }

  async function handleRemove(link: GadgetLink) {
    setRemovingId(link.id);
    try {
      await api.delete(`/tenant/gadget-links/${link.id}`);
      setLinks((prev) => prev?.filter((l) => l.id !== link.id) ?? null);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <PageShell>
      <header className="border-b border-ink-700 bg-ink-900/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/hq" className="flex items-center gap-2 text-lg font-bold tracking-wide text-gold-300">
            <span className="text-2xl">⚡</span> SYDEKYKS
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[#b9ad98]">{user?.email}</span>
            <Link to="/hq">
              <Button variant="ghost">Back to HQ</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="relative overflow-hidden rounded-2xl border border-gold-700/30 bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 px-8 py-10">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold-500/10 blur-3xl" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-500">Gadget Links</p>
          <h1 className="mt-2 text-4xl font-bold text-[#f5eee0]">Utility Belt</h1>
          <p className="mt-3 max-w-2xl text-sm text-[#b9ad98]">
            Connect your HQ's own systems as Gadget Links so your Sydekyks can read and act on real data. Add an
            instance below, then test the connection before putting it to work.
          </p>
        </div>

        <section className="mt-10">
          <h2 className="text-lg font-bold text-[#f5eee0]">Available Gadgets</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {!gadgets ? (
              <p className="text-sm text-[#b9ad98]">Loading…</p>
            ) : (
              gadgets.map((g) => (
                <Card key={g.id} className="flex flex-col p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-gold-700/40 bg-ink-950 text-lg font-bold text-gold-400">
                      {g.name[0]}
                    </div>
                    <h3 className="text-base font-bold text-[#f5eee0]">{g.name}</h3>
                  </div>
                  <p className="mt-3 flex-1 text-sm text-[#8a7f6d]">{g.description}</p>
                  {canManage ? (
                    <Button className="mt-5 self-start px-4 py-2 text-xs" onClick={() => setAddingGadget(g)}>
                      + Connect Instance
                    </Button>
                  ) : (
                    <p className="mt-5 text-xs text-[#8a7f6d]">Ask your Commander to connect this Gadget.</p>
                  )}
                </Card>
              ))
            )}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-bold text-[#f5eee0]">Connected Instances</h2>
          <Card className="mt-4 overflow-hidden">
            {!links ? (
              <p className="p-6 text-sm text-[#b9ad98]">Loading…</p>
            ) : links.length === 0 ? (
              <p className="p-6 text-sm text-[#b9ad98]">
                No instances connected yet. Add one from the Gadgets above.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-700 text-xs uppercase tracking-wider text-gold-500">
                    <th className="px-6 py-3 font-semibold">Instance</th>
                    <th className="px-6 py-3 font-semibold">Gadget</th>
                    <th className="px-6 py-3 font-semibold">Connection</th>
                    <th className="px-6 py-3 font-semibold">Status</th>
                    <th className="px-6 py-3 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <tr key={link.id} className="border-b border-ink-700/60 last:border-0 align-top">
                      <td className="px-6 py-3 font-medium text-[#f5eee0]">{link.name}</td>
                      <td className="px-6 py-3 text-[#b9ad98]">{link.gadget.name}</td>
                      <td className="px-6 py-3 text-[#b9ad98]">
                        {link.category === "email" ? (
                          <code className="break-all text-xs text-gold-300">{link.inbound_address}</code>
                        ) : (
                          <>
                            <p>{link.url}</p>
                            <p className="text-xs text-[#8a7f6d]">
                              db: {link.database} · user: {link.username}
                            </p>
                          </>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <StatusBadge status={link.status} />
                        {testResults[link.id] && (
                          <p className={`mt-1 max-w-xs text-xs ${testResults[link.id].ok ? "text-gold-400" : "text-red-400"}`}>
                            {testResults[link.id].message}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {canManage && (
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              className="px-3 py-1.5 text-xs"
                              disabled={testingId === link.id}
                              onClick={() => handleTest(link)}
                            >
                              {testingId === link.id ? "Testing…" : "Test Connection"}
                            </Button>
                            <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setEditingLink(link)}>
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              className="px-3 py-1.5 text-xs"
                              disabled={removingId === link.id}
                              onClick={() => handleRemove(link)}
                            >
                              {removingId === link.id ? "…" : "Remove"}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </section>
      </main>

      <Modal open={!!addingGadget} onClose={() => setAddingGadget(null)}>
        {addingGadget && (
          <GadgetLinkForm mode="create" gadget={addingGadget} onCancel={() => setAddingGadget(null)} onSaved={handleCreated} />
        )}
      </Modal>

      <Modal open={!!editingLink} onClose={() => setEditingLink(null)}>
        {editingLink && (
          <GadgetLinkForm mode="edit" link={editingLink} onCancel={() => setEditingLink(null)} onSaved={handleUpdated} />
        )}
      </Modal>
    </PageShell>
  );
}

function StatusBadge({ status }: { status: GadgetLink["status"] }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold-400">
        <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_8px_2px_rgba(234,194,95,0.7)]" /> Connected
      </span>
    );
  }
  if (status === "error") {
    return <Badge tone="danger">Connection failed</Badge>;
  }
  return <Badge tone="neutral">Untested</Badge>;
}

type GadgetLinkFormProps =
  | { mode: "create"; gadget: Gadget; link?: undefined; onCancel: () => void; onSaved: (link: GadgetLink) => void }
  | { mode: "edit"; link: GadgetLink; gadget?: undefined; onCancel: () => void; onSaved: (link: GadgetLink) => void };

function GadgetLinkForm({ mode, gadget, link, onCancel, onSaved }: GadgetLinkFormProps) {
  const gadgetName = mode === "create" ? gadget.name : link.gadget.name;
  const category = mode === "create" ? gadget.category : link.gadget.category;
  const isEmail = category === "email";
  const [name, setName] = useState(link?.name ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const [database, setDatabase] = useState(link?.database ?? "");
  const [username, setUsername] = useState(link?.username ?? "");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const erpFields = isEmail ? {} : { url, database, username };
      const res =
        mode === "create"
          ? await api.post("/tenant/gadget-links", {
              gadget_slug: gadget.slug,
              name,
              ...erpFields,
              secret: isEmail ? undefined : secret,
            })
          : await api.patch(`/tenant/gadget-links/${link.id}`, {
              name,
              ...erpFields,
              secret: secret || undefined,
            });
      onSaved(res.data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        setError(err.response.data.detail);
      } else {
        setError(`Failed to ${mode === "create" ? "connect" : "save"} the instance. Please try again.`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-gold-600/40 p-7 shadow-[0_0_60px_-12px_rgba(212,168,40,0.5)]">
      <h2 className="text-xl font-bold text-[#f5eee0]">
        {mode === "create" ? `Connect ${gadgetName}` : `Edit ${link.name}`}
      </h2>
      <p className="mt-1 text-sm text-[#8a7f6d]">
        {mode === "create" ? gadget.description : `${gadgetName} connection details.`}
      </p>

      <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
        <div>
          <Label>Name</Label>
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isEmail ? "Bills Inbox" : "Production Odoo"}
          />
        </div>

        {isEmail ? (
          <>
            {mode === "edit" && link.inbound_address && (
              <div>
                <Label>Inbound Address</Label>
                <code className="block break-all rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-gold-300">
                  {link.inbound_address}
                </code>
                <p className="mt-1 text-xs text-[#8a7f6d]">
                  Forward or send bills to this address. Configure it at your email provider's inbound routing.
                </p>
              </div>
            )}
            {mode === "create" && (
              <p className="text-sm text-[#8a7f6d]">
                We'll generate a unique inbound email address once you connect. Send bills there to have them processed
                automatically.
              </p>
            )}
          </>
        ) : (
          <>
            <div>
              <Label>Odoo URL</Label>
              <Input
                required
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mycompany.odoo.com"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Database</Label>
                <Input required value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="mycompany" />
              </div>
              <div>
                <Label>Username</Label>
                <Input required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
              </div>
            </div>
            <div>
              <Label>Password / API Token</Label>
              <Input
                required={mode === "create"}
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={mode === "create" ? "••••••••" : "Leave blank to keep the existing one"}
              />
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="mt-2 flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : mode === "create" ? "Connect Instance" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
