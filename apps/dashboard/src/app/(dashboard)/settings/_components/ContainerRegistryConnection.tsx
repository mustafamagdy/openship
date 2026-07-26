"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Package, Trash2 } from "lucide-react";
import {
  containerRegistriesApi,
  getApiErrorMessage,
  type ContainerRegistryConnection as Connection,
} from "@/lib/api";
import { useToast } from "@/context/ToastContext";

export function ContainerRegistryConnection() {
  const { showToast } = useToast();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [registryHost, setRegistryHost] = useState("ghcr.io");
  const [namespace, setNamespace] = useState("");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConnections((await containerRegistriesApi.list()).connections ?? []);
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not load container registries"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => void refresh(), [refresh]);

  const connect = async () => {
    if (!registryHost.trim() || !namespace.trim() || !username.trim() || !token) return;
    setSaving(true);
    try {
      await containerRegistriesApi.connect({
        provider: registryHost.trim().toLowerCase() === "ghcr.io" ? "ghcr" : "generic",
        registryHost,
        namespace,
        username,
        token,
      });
      setToken("");
      await refresh();
      showToast("Container registry connected", "success");
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not connect the registry"), "error");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async (connection: Connection) => {
    if (!window.confirm(`Disconnect ${connection.registryHost}/${connection.namespace}? Published images will remain in the registry.`)) return;
    setRemoving(connection.id);
    try {
      await containerRegistriesApi.disconnect(connection.id);
      await refresh();
      showToast("Container registry disconnected", "success");
    } catch (error) {
      showToast(getApiErrorMessage(error, "Could not disconnect the registry"), "error");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border/50 bg-card">
      <div className="flex items-start gap-3 border-b border-border/50 px-5 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Package className="size-5 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Build artifact registry</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Publish successful Docker builds once, deploy immutable digests, and move them to another server without rebuilding.
          </p>
        </div>
      </div>
      <div className="space-y-5 p-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading registry…
          </div>
        ) : (
          connections.map((connection) => (
            <div key={connection.id} className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
              <CheckCircle2 className="size-4 text-success" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{connection.registryHost}/{connection.namespace}</p>
                <p className="text-xs text-muted-foreground">Default · {connection.username} · token stored securely</p>
              </div>
              <button type="button" onClick={() => void disconnect(connection)} disabled={removing === connection.id} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" aria-label="Disconnect registry">
                {removing === connection.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </button>
            </div>
          ))
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Registry host</span>
            <input value={registryHost} onChange={(event) => setRegistryHost(event.target.value)} placeholder="ghcr.io" className="w-full rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Namespace / owner</span>
            <input value={namespace} onChange={(event) => setNamespace(event.target.value)} placeholder="your-github-user" className="w-full rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="w-full rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Access token</span>
            <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Package write token" autoComplete="new-password" className="w-full rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </label>
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            GHCR tokens need read/write packages. Credentials are encrypted and used ephemerally for push and pull.
          </p>
          <button type="button" onClick={() => void connect()} disabled={saving || !registryHost.trim() || !namespace.trim() || !username.trim() || !token} className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Connect"}
          </button>
        </div>
      </div>
    </section>
  );
}
