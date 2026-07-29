"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  ExternalLink,
  Globe2,
  Link2Off,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Star,
  Trash2,
} from "lucide-react";
import {
  domainsApi,
  getApiErrorMessage,
  type DomainDnsRecord,
  type CloudflareConnection,
  type RegisteredDomain,
} from "@/lib/api";
import { PageContainer } from "@/components/ui/PageContainer";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/context/ToastContext";

export default function DomainsPage() {
  const { showToast } = useToast();
  const [domains, setDomains] = useState<RegisteredDomain[]>([]);
  const [cloudflare, setCloudflare] = useState<CloudflareConnection>({
    provider: "cloudflare",
    connected: false,
  });
  const [loading, setLoading] = useState(true);
  const [cloudflareToken, setCloudflareToken] = useState("");
  const [cloudflareBusy, setCloudflareBusy] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recordsFor, setRecordsFor] = useState<RegisteredDomain | null>(null);
  const [records, setRecords] = useState<DomainDnsRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [copied, setCopied] = useState("");
  const [deleting, setDeleting] = useState<RegisteredDomain | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [domainsResponse, cloudflareResponse] = await Promise.all([
        domainsApi.listRegistered(),
        domainsApi.cloudflareConnection(),
      ]);
      setDomains(domainsResponse.data ?? []);
      setCloudflare(cloudflareResponse.data);
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not load registered domains"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const connectCloudflare = async () => {
    if (!cloudflareToken.trim() || cloudflareBusy) return;
    setCloudflareBusy(true);
    try {
      const response = await domainsApi.connectCloudflare(cloudflareToken);
      const conflicts = response.data.domains.filter((domain) => domain.status !== "in_sync");
      setCloudflareToken("");
      await load();
      showToast(
        conflicts.length
          ? `Cloudflare connected. ${conflicts.length} domain${conflicts.length === 1 ? "" : "s"} need attention.`
          : `Cloudflare connected and ${response.data.domains.length} domain${response.data.domains.length === 1 ? "" : "s"} synchronized.`,
        conflicts.length ? "error" : "success",
        "Cloudflare DNS",
      );
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not connect Cloudflare"), "error");
    } finally {
      setCloudflareBusy(false);
    }
  };

  const disconnectCloudflare = async () => {
    if (cloudflareBusy) return;
    setCloudflareBusy(true);
    try {
      await domainsApi.disconnectCloudflare();
      await load();
      showToast(
        "Cloudflare disconnected. Existing DNS records were left unchanged.",
        "success",
        "Cloudflare DNS",
      );
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not disconnect Cloudflare"), "error");
    } finally {
      setCloudflareBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const openRecords = useCallback(
    async (domain: RegisteredDomain) => {
      setRecordsFor(domain);
      setRecords([]);
      setRecordsLoading(true);
      try {
        const response = await domainsApi.registeredRecords(domain.id);
        setRecords(response.data ?? []);
      } catch (error) {
        showToast(getApiErrorMessage(error, "Could not load DNS records"), "error");
      } finally {
        setRecordsLoading(false);
      }
    },
    [showToast],
  );

  const handleAdd = async () => {
    const domain = domainInput.trim().toLowerCase();
    if (!domain || adding) return;
    setAdding(true);
    try {
      const response = await domainsApi.register(domain);
      setDomainInput("");
      await load();
      setRecordsFor(response.data);
      setRecords(response.records);
      showToast(`${response.data.domain} was added.`, "success", "Domains");
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not register domain"), "error", "Domains");
    } finally {
      setAdding(false);
    }
  };

  const verify = async (domain: RegisteredDomain) => {
    setBusyId(domain.id);
    try {
      const result = await domainsApi.verifyRegistered(domain.id);
      showToast(
        result.message,
        result.verified ? "success" : "error",
        result.verified ? "Domain verified" : "DNS is not ready",
      );
      await load();
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not verify domain"), "error");
    } finally {
      setBusyId(null);
    }
  };

  const setDefault = async (domain: RegisteredDomain) => {
    setBusyId(domain.id);
    try {
      await domainsApi.setRegisteredDefault(domain.id);
      await load();
      showToast(`${domain.domain} is now the default for new projects.`, "success");
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not change the default domain"), "error");
    } finally {
      setBusyId(null);
    }
  };

  const syncDns = async (domain: RegisteredDomain) => {
    setBusyId(domain.id);
    try {
      const result = await domainsApi.syncRegisteredDns(domain.id);
      if (result.status === "conflict") {
        const detail = result.records.find((record) => record.action === "conflict")?.detail;
        showToast(
          detail ?? "Existing Cloudflare records conflict with OpenShip routing.",
          "error",
          "DNS needs attention",
        );
      } else {
        showToast(
          result.changed
            ? `Created ${result.changed} DNS record${result.changed === 1 ? "" : "s"} in Cloudflare.`
            : `${domain.domain} DNS is already synchronized.`,
          "success",
          "Cloudflare DNS",
        );
      }
      await load();
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not synchronize DNS"), "error");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await domainsApi.removeRegistered(deleting.id);
      setDeleting(null);
      await load();
      showToast(`${deleting.domain} was removed.`, "success");
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not remove domain"), "error");
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied(""), 1800);
  };

  return (
    <PageContainer className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-medium text-foreground/90">Domains</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Register a domain once, choose the default, and reuse its subdomains across projects.
        </p>
      </div>

      <section className="mb-7 rounded-2xl border border-border/50 bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#F6821F]/10">
              <Cloud className="size-5 text-[#F6821F]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">Cloudflare DNS</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    cloudflare.connected
                      ? "bg-success/10 text-success"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {cloudflare.connected ? "Connected" : "Not connected"}
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Let OpenShip create verification and wildcard routing records for every registered
                domain. Existing conflicting records are never deleted.
              </p>
            </div>
          </div>

          {cloudflare.connected ? (
            <button
              type="button"
              onClick={() => void disconnectCloudflare()}
              disabled={cloudflareBusy}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-border/50 px-4 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
            >
              {cloudflareBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2Off className="size-4" />
              )}
              Disconnect
            </button>
          ) : (
            <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-[430px]">
              <div className="flex gap-2">
                <input
                  type="password"
                  value={cloudflareToken}
                  onChange={(event) => setCloudflareToken(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void connectCloudflare();
                  }}
                  placeholder="Cloudflare API token"
                  aria-label="Cloudflare API token"
                  autoComplete="off"
                  className="h-10 min-w-0 flex-1 rounded-xl border border-border/50 bg-background/60 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => void connectCloudflare()}
                  disabled={cloudflareToken.trim().length < 20 || cloudflareBusy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {cloudflareBusy && <Loader2 className="size-4 animate-spin" />}
                  Connect
                </button>
              </div>
              <a
                href="https://dash.cloudflare.com/profile/api-tokens"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Create a token with Zone:Read and DNS:Edit
                <ExternalLink className="size-3" />
              </a>
            </div>
          )}
        </div>
      </section>

      <section className="mb-7 rounded-2xl border border-border/50 bg-card p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Plus className="size-5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Register a domain</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              You will verify ownership with one TXT record. Project subdomains then inherit that
              verification.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={domainInput}
            onChange={(event) => setDomainInput(event.target.value.toLowerCase())}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleAdd();
            }}
            placeholder="example.com"
            aria-label="Domain to register"
            className="h-11 min-w-0 flex-1 rounded-xl border border-border/50 bg-background/60 px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!domainInput.trim() || adding}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Register domain
          </button>
        </div>
      </section>

      {loading && domains.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : domains.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
          <Globe2 className="mx-auto size-8 text-muted-foreground/50" />
          <h2 className="mt-4 text-base font-semibold text-foreground">
            No registered domains yet
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Add your first domain above. Once verified, new projects can use it by default.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {domains.map((domain) => {
            const busy = busyId === domain.id;
            return (
              <article key={domain.id} className="rounded-2xl border border-border/50 bg-card p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div
                      className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
                        domain.verified ? "bg-success/10" : "bg-warning/10"
                      }`}
                    >
                      {domain.verified ? (
                        <ShieldCheck className="size-5 text-success" />
                      ) : (
                        <Globe2 className="size-5 text-warning" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-foreground">
                          {domain.domain}
                        </h2>
                        {domain.isDefault && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            <Star className="size-3 fill-current" />
                            Default
                          </span>
                        )}
                        {domain.dnsStatus === "in_sync" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                            <Cloud className="size-3" />
                            DNS managed
                          </span>
                        )}
                        {domain.dnsStatus === "conflict" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                            DNS conflict
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {domain.verified
                          ? "Verified · subdomains are ready to assign"
                          : "Pending DNS verification"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void openRecords(domain)}
                      className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/50 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
                    >
                      <Globe2 className="size-3.5" />
                      DNS setup
                    </button>
                    {cloudflare.connected && (
                      <button
                        type="button"
                        onClick={() => void syncDns(domain)}
                        disabled={busy}
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/50 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Cloud className="size-3.5" />
                        )}
                        Sync DNS
                      </button>
                    )}
                    {!domain.verified ? (
                      <button
                        type="button"
                        onClick={() => void verify(domain)}
                        disabled={busy}
                        className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                        Verify
                      </button>
                    ) : !domain.isDefault ? (
                      <button
                        type="button"
                        onClick={() => void setDefault(domain)}
                        disabled={busy}
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/50 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Star className="size-3.5" />
                        )}
                        Make default
                      </button>
                    ) : (
                      <span className="inline-flex h-9 items-center gap-2 px-3 text-xs font-medium text-success">
                        <CheckCircle2 className="size-3.5" />
                        Used by new projects
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleting(domain)}
                      aria-label={`Remove ${domain.domain}`}
                      className="inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={Boolean(recordsFor)}
        onClose={() => setRecordsFor(null)}
        width="640px"
        maxWidth="calc(100vw - 2rem)"
      >
        <div className="p-6">
          <h2 className="pe-10 text-lg font-semibold text-foreground">
            DNS setup for {recordsFor?.domain}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add these records at your DNS provider, then return and verify the domain.
          </p>
          {recordsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {records.map((record) => (
                <div
                  key={`${record.type}:${record.name}`}
                  className="rounded-xl border border-border/50 bg-background/50 p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-semibold text-foreground">
                      {record.type}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {record.host === "*" ? "Wildcard routing" : "Ownership verification"}
                    </span>
                  </div>
                  <DnsValue label="Name" value={record.host} copied={copied} onCopy={copy} />
                  <DnsValue
                    label="Value"
                    value={record.value || "Server address unavailable"}
                    copied={copied}
                    onCopy={copy}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        width="480px"
        maxWidth="calc(100vw - 2rem)"
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold text-foreground">Remove {deleting?.domain}?</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            OpenShip will refuse this if any project still uses one of its subdomains.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleting(null)}
              className="h-10 rounded-xl border border-border/50 px-4 text-sm font-medium text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busyId === deleting?.id}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-danger-solid px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {busyId === deleting?.id && <Loader2 className="size-4 animate-spin" />}
              Remove domain
            </button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}

function DnsValue({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: string;
  onCopy: (value: string) => Promise<void>;
}) {
  return (
    <div className="mt-2 grid grid-cols-[64px_minmax(0,1fr)_32px] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <code className="truncate rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-foreground">
        {value}
      </code>
      <button
        type="button"
        onClick={() => void onCopy(value)}
        aria-label={`Copy ${label.toLowerCase()}`}
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {copied === value ? (
          <Check className="size-3.5 text-success" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  );
}
