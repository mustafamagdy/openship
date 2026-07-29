"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Server,
} from "lucide-react";
import { PageContainer } from "@/components/ui/PageContainer";
import {
  systemApi,
  type KubernetesClusterOverview,
  type KubernetesClustersResponse,
} from "@/lib/api/system";

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="flex size-9 items-center justify-center rounded-xl bg-muted/60">
          <Icon className="size-4 text-foreground/70" />
        </span>
      </div>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground/70">{detail}</p>
    </div>
  );
}

function ClusterCard({ cluster }: { cluster: KubernetesClusterOverview }) {
  const readyNodes = cluster.nodes.filter((node) => node.ready).length;
  const readyWorkloads = cluster.workloads.filter(
    (workload) => workload.readyReplicas === workload.desiredReplicas,
  ).length;

  return (
    <section className="overflow-hidden rounded-2xl border border-border/50 bg-card">
      <header className="flex flex-col gap-4 border-b border-border/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-info/10">
            <Boxes className="size-5 text-info" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-semibold">{cluster.name}</h2>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  cluster.healthy ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                }`}
              >
                {cluster.healthy ? (
                  <CheckCircle2 className="size-3" />
                ) : (
                  <AlertTriangle className="size-3" />
                )}
                {cluster.healthy ? "Healthy" : "Needs attention"}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {cluster.host} · {cluster.version ?? "Kubernetes version unavailable"}
            </p>
          </div>
        </div>
        <Link
          href={`/servers/${cluster.serverId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Server settings
          <ExternalLink className="size-3.5" />
        </Link>
      </header>

      <div className="grid gap-6 p-5 xl:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Nodes</h3>
            <span className="text-xs text-muted-foreground">
              {readyNodes}/{cluster.nodes.length} ready
            </span>
          </div>
          <div className="space-y-2">
            {cluster.nodes.map((node) => (
              <div
                key={node.name}
                className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5"
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    node.ready ? "bg-success-solid" : "bg-danger-solid"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{node.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {node.role} · {node.kubeletVersion ?? "version unknown"} ·{" "}
                    {[node.operatingSystem, node.architecture].filter(Boolean).join("/")}
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {node.ready ? "Ready" : "Not ready"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">OpenShip workloads</h3>
            <span className="text-xs text-muted-foreground">
              {readyWorkloads}/{cluster.workloads.length} ready
            </span>
          </div>
          {cluster.workloads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No OpenShip workloads on this cluster.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {cluster.workloads.map((workload) => {
                const ready = workload.readyReplicas === workload.desiredReplicas;
                const content = (
                  <>
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        ready ? "bg-success-solid" : "bg-warning-solid"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {workload.projectName ?? workload.name}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {workload.namespace} / {workload.name}
                      </p>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {workload.readyReplicas}/{workload.desiredReplicas}
                    </span>
                    {workload.projectId && (
                      <ArrowRight className="size-3.5 text-muted-foreground" />
                    )}
                  </>
                );

                return workload.projectId ? (
                  <Link
                    key={`${workload.namespace}/${workload.name}`}
                    href={`/projects/${workload.projectId}/monitoring`}
                    className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    key={`${workload.namespace}/${workload.name}`}
                    className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5"
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function KubernetesPage() {
  const [data, setData] = useState<KubernetesClustersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await systemApi.listKubernetesClusters());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to inspect Kubernetes clusters.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PageContainer>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-foreground/90">
            Kubernetes Clusters
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Live health and OpenShip-managed workloads across every registered cluster.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <Link
            href="/servers/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="size-4" />
            Add cluster host
          </Link>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-danger/30 bg-danger/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 text-danger" />
            <div>
              <h2 className="font-medium text-danger">Cluster discovery failed</h2>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Clusters"
              value={data.summary.clusters}
              detail={`${data.summary.healthyClusters} healthy`}
              icon={Boxes}
            />
            <SummaryCard
              label="Nodes"
              value={data.summary.nodes}
              detail={`${data.summary.readyNodes} ready`}
              icon={Server}
            />
            <SummaryCard
              label="Workloads"
              value={data.summary.workloads}
              detail="Managed by OpenShip"
              icon={Activity}
            />
            <SummaryCard
              label="Cluster health"
              value={
                data.summary.clusters
                  ? `${Math.round((data.summary.healthyClusters / data.summary.clusters) * 100)}%`
                  : "—"
              }
              detail="Across discovered clusters"
              icon={Cpu}
            />
          </div>

          {data.clusters.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-muted">
                <Boxes className="size-6 text-muted-foreground" />
              </span>
              <h2 className="mt-4 font-semibold">No Kubernetes cluster discovered</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Add a server with passwordless sudo access to kubectl. OpenShip will discover it
                automatically without copying its kubeconfig.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {data.clusters.map((cluster) => (
                <ClusterCard key={cluster.serverId} cluster={cluster} />
              ))}
            </div>
          )}

          {data.candidates.length > 0 && (
            <section className="mt-6 rounded-2xl border border-border/50 bg-card p-5">
              <h2 className="font-semibold">Other registered servers</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                These hosts are not currently usable as Kubernetes control points.
              </p>
              <div className="mt-4 divide-y divide-border/50 overflow-hidden rounded-xl border border-border/50">
                {data.candidates.map((server) => (
                  <Link
                    key={server.serverId}
                    href={`/servers/${server.serverId}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <Server className="size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{server.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{server.host}</p>
                    </div>
                    <span className="max-w-[45%] truncate text-xs text-warning">
                      {server.error ?? "kubectl unavailable"}
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      ) : null}
    </PageContainer>
  );
}
