"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, GitBranch, Loader2, Trash2 } from "lucide-react";
import {
  azureDevopsApi,
  getApiErrorMessage,
  type AzureDevopsConnection as Connection,
} from "@/lib/api";
import { useToast } from "@/context/ToastContext";

export function AzureDevopsConnection() {
  const { showToast } = useToast();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [organization, setOrganization] = useState("");
  const [pat, setPat] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await azureDevopsApi.listConnections();
      setConnections(result.connections ?? []);
    } catch (error) {
      showToast(
        getApiErrorMessage(error, "Could not load Azure DevOps connections"),
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleConnect = async () => {
    if (!organization.trim() || !pat.trim()) return;
    setSaving(true);
    try {
      await azureDevopsApi.connect(organization.trim(), pat.trim());
      setPat("");
      setOrganization("");
      await refresh();
      showToast("Azure DevOps connected", "success");
    } catch (error) {
      showToast(
        getApiErrorMessage(error, "Could not connect Azure DevOps"),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (connection: Connection) => {
    if (
      !window.confirm(
        `Disconnect Azure DevOps organization "${connection.organization}"? Existing deployments keep running, but new clones and webhooks will stop.`,
      )
    ) {
      return;
    }
    setRemoving(connection.organization);
    try {
      await azureDevopsApi.disconnect(connection.organization);
      await refresh();
      showToast("Azure DevOps disconnected", "success");
    } catch (error) {
      showToast(
        getApiErrorMessage(error, "Could not disconnect Azure DevOps"),
        "error",
      );
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border/50 bg-card">
      <div className="flex items-start gap-3 border-b border-border/50 px-5 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-info/10">
          <GitBranch className="size-5 text-info" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Azure Repos</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Connect an Azure DevOps organization to browse, clone, and auto-deploy private repositories.
          </p>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading connections…
          </div>
        ) : connections.length > 0 ? (
          <div className="space-y-2">
            {connections.map((connection) => (
              <div
                key={connection.organization}
                className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 py-3"
              >
                <CheckCircle2 className="size-4 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {connection.organization}
                  </p>
                  <a
                    href={connection.organizationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  >
                    {connection.organizationUrl}
                    <ExternalLink className="size-3" />
                  </a>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDisconnect(connection)}
                  disabled={removing === connection.organization}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  aria-label={`Disconnect ${connection.organization}`}
                >
                  {removing === connection.organization ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Organization</span>
            <input
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
              placeholder="geeksclub"
              autoComplete="off"
              className="w-full rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Personal access token
            </span>
            <input
              type="password"
              value={pat}
              onChange={(event) => setPat(event.target.value)}
              placeholder="Azure DevOps PAT"
              autoComplete="new-password"
              className="w-full rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={saving || !organization.trim() || !pat.trim()}
            className="self-end rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Connect"}
          </button>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Use a PAT with Code read access. To enable push auto-deploy, also grant
          Service Hooks read &amp; manage. The token is encrypted at rest and is
          never shown again.
        </p>
      </div>
    </section>
  );
}
