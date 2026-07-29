"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, RefreshCw, RotateCw, Skull, Waypoints } from "lucide-react";
import { deployApi } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

interface Inventory {
  namespace: string;
  summary: {
    deployments: number;
    desiredReplicas: number;
    readyReplicas: number;
    pods: number;
    readyPods: number;
    healthy: boolean;
  };
  deployments: Array<{
    name: string;
    desired: number;
    ready: number;
    available: number;
    unavailable: number;
  }>;
  pods: Array<{
    name: string;
    serviceName?: string;
    node?: string;
    phase?: string;
    ready: boolean;
    restarts: number;
  }>;
  disruptionBudgets: Array<{
    name: string;
    currentHealthy: number;
    desiredHealthy: number;
    disruptionsAllowed: number;
  }>;
}

export function KubernetesControlPanel({ deploymentId }: { deploymentId?: string | null }) {
  const { showToast } = useToast();
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [replicas, setReplicas] = useState<Record<string, number>>({});
  const [podToReplace, setPodToReplace] = useState<string | null>(null);
  const [replacementConfirmation, setReplacementConfirmation] = useState("");

  const refresh = useCallback(async () => {
    if (!deploymentId) return;
    setLoading(true);
    try {
      const response = await deployApi.getKubernetesStatus(deploymentId);
      const next = response.data?.data ?? response.data;
      setInventory(next);
      setUnsupported(false);
      setReplicas(
        Object.fromEntries(
          (next.deployments ?? []).map((workload: Inventory["deployments"][number]) => [
            workload.name,
            workload.desired,
          ]),
        ),
      );
    } catch (error: any) {
      if (error?.status === 403 || /not managed by Kubernetes/i.test(error?.message ?? "")) {
        setUnsupported(true);
      } else {
        showToast(
          error instanceof Error ? error.message : "Failed to load Kubernetes status",
          "error",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [deploymentId, showToast]);

  useEffect(() => {
    void refresh();
    if (!deploymentId) return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [deploymentId, refresh]);

  if (!deploymentId || unsupported) return null;
  if (!inventory && loading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-5 text-sm text-muted-foreground">
        Loading Kubernetes control plane…
      </div>
    );
  }
  if (!inventory) return null;

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setActing(key);
    try {
      await action();
      showToast(success, "success");
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Kubernetes action failed", "error");
    } finally {
      setActing(null);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-border/60 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="size-5 text-primary" />
            <h2 className="font-semibold">Kubernetes control plane</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                inventory.summary.healthy
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-amber-500/10 text-amber-600"
              }`}
            >
              {inventory.summary.healthy ? "Healthy" : "Degraded"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Namespace {inventory.namespace} · {inventory.summary.readyReplicas}/
            {inventory.summary.desiredReplicas} replicas · {inventory.summary.readyPods}/
            {inventory.summary.pods} pods ready
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {inventory.deployments.map((workload) => (
          <div key={workload.name} className="rounded-xl border border-border/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{workload.name}</p>
                <p className="text-xs text-muted-foreground">
                  {workload.ready}/{workload.desired} ready
                  {workload.unavailable ? ` · ${workload.unavailable} unavailable` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={acting !== null}
                onClick={() =>
                  void run(
                    `restart:${workload.name}`,
                    () => deployApi.restartKubernetesWorkload(deploymentId, workload.name),
                    `${workload.name} rolled successfully`,
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
              >
                <RotateCw className="size-3.5" />
                Rolling restart
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Waypoints className="size-4 text-muted-foreground" />
              <input
                type="number"
                min={1}
                max={50}
                value={replicas[workload.name] ?? workload.desired}
                onChange={(event) =>
                  setReplicas((current) => ({
                    ...current,
                    [workload.name]: Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                  }))
                }
                className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-sm"
              />
              <button
                type="button"
                disabled={acting !== null || replicas[workload.name] === workload.desired}
                onClick={() =>
                  void run(
                    `scale:${workload.name}`,
                    () =>
                      deployApi.scaleKubernetesWorkload(
                        deploymentId,
                        workload.name,
                        replicas[workload.name] ?? workload.desired,
                      ),
                    `${workload.name} scaled successfully`,
                  )
                }
                className="rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
              >
                Scale
              </button>
            </div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Pods and guarded chaos</h3>
        <div className="overflow-x-auto rounded-xl border border-border/50">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Pod</th>
                <th className="px-3 py-2">Service</th>
                <th className="px-3 py-2">Node</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Restarts</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {inventory.pods.map((pod) => (
                <tr key={pod.name} className="border-t border-border/40">
                  <td className="px-3 py-2 font-mono text-xs">{pod.name}</td>
                  <td className="px-3 py-2">{pod.serviceName ?? "—"}</td>
                  <td className="px-3 py-2">{pod.node ?? "—"}</td>
                  <td className="px-3 py-2">{pod.ready ? "Ready" : (pod.phase ?? "Not ready")}</td>
                  <td className="px-3 py-2">{pod.restarts}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={acting !== null}
                      onClick={() => {
                        setPodToReplace(pod.name);
                        setReplacementConfirmation("");
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-500/5 disabled:opacity-50"
                    >
                      <Skull className="size-3.5" />
                      Replace pod
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {podToReplace && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="replace-pod-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-red-500/10 p-2 text-red-600">
                <Skull className="size-5" />
              </div>
              <div>
                <h3 id="replace-pod-title" className="font-semibold">
                  Replace Kubernetes pod?
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  OpenShip will delete <span className="font-mono">{podToReplace}</span> and wait
                  for its owning workload to recover.
                </p>
              </div>
            </div>

            <label className="mt-5 block text-sm font-medium" htmlFor="replace-pod-confirmation">
              Type <span className="font-mono">REPLACE POD</span> to run this controlled chaos test
            </label>
            <input
              id="replace-pod-confirmation"
              autoFocus
              value={replacementConfirmation}
              onChange={(event) => setReplacementConfirmation(event.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
              placeholder="REPLACE POD"
            />

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setPodToReplace(null);
                  setReplacementConfirmation("");
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={replacementConfirmation !== "REPLACE POD"}
                onClick={() => {
                  const pod = podToReplace;
                  setPodToReplace(null);
                  setReplacementConfirmation("");
                  void run(
                    `pod:${pod}`,
                    () => deployApi.replaceKubernetesPod(deploymentId, pod),
                    `${pod} replacement requested`,
                  );
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Replace pod
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
