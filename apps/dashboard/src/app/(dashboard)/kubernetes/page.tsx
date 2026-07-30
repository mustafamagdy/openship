"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Filter,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Server,
} from "lucide-react";
import {
  systemApi,
  type KubernetesClusterOverview,
  type KubernetesClustersResponse,
} from "@/lib/api/system";
import { groupWorkloadsByProject } from "./kubernetes-workload-groups";

type ClusterNode = KubernetesClusterOverview["nodes"][number];

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value != null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function formatUptime(createdAt: string | null): string {
  if (!createdAt) return "—";
  const elapsed = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const days = Math.floor(elapsed / 86_400_000);
  const hours = Math.floor((elapsed % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((elapsed % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

function Utilization({
  usage,
  capacity,
  percent,
}: {
  usage: string | null;
  capacity: string | null;
  percent: number | null;
}) {
  return (
    <div className="operator-kube__utilization">
      <span>
        {usage ?? "—"}
        {capacity ? ` / ${capacity}` : ""}
      </span>
      <div aria-label={percent == null ? "Utilization unavailable" : `${percent}% utilized`}>
        <i style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }} />
      </div>
      <small>{percent == null ? "Metrics unavailable" : `${percent}%`}</small>
    </div>
  );
}

function NodeTable({
  nodes,
  query,
}: {
  nodes: ClusterNode[];
  query: string;
}) {
  const filteredNodes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return nodes;
    return nodes.filter((node) =>
      [node.name, node.ip, node.role, node.kubeletVersion]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized)),
    );
  }, [nodes, query]);

  return (
    <div className="operator-kube__table-wrap">
      <table className="operator-kube__table">
        <thead>
          <tr>
            <th>Node / IP</th>
            <th>Status</th>
            <th>Role</th>
            <th>CPU</th>
            <th>Memory</th>
            <th>Pods</th>
            <th>Uptime</th>
            <th>Version</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {filteredNodes.map((node) => (
            <tr key={node.name}>
              <td>
                <strong>{node.name}</strong>
                <code>{node.ip ?? "IP unavailable"}</code>
              </td>
              <td>
                <span className={node.ready ? "is-ready" : "is-unavailable"}>
                  <i aria-hidden="true" />
                  {node.ready ? "Ready" : "Not ready"}
                </span>
              </td>
              <td className="capitalize">{node.role.replace("-", " ")}</td>
              <td>
                <Utilization
                  usage={node.cpuUsage}
                  capacity={node.cpuCapacity ? `${node.cpuCapacity} CPU` : null}
                  percent={node.cpuPercent}
                />
              </td>
              <td>
                <Utilization
                  usage={node.memoryUsage}
                  capacity={node.memoryCapacity}
                  percent={node.memoryPercent}
                />
              </td>
              <td>
                <span className="operator-kube__pods">
                  {node.podCount} / {node.podCapacity ?? "—"}
                </span>
              </td>
              <td>
                <span className="operator-kube__uptime">{formatUptime(node.createdAt)}</span>
              </td>
              <td>
                <code>{node.kubeletVersion ?? "—"}</code>
                <small>{node.containerRuntime?.split("://")[0] ?? ""}</small>
              </td>
              <td>
                <button type="button" className="operator-kube__row-action" aria-label={`Actions for ${node.name}`}>
                  <MoreVertical aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filteredNodes.length === 0 ? (
        <div className="operator-kube__empty">No nodes match “{query}”.</div>
      ) : null}
    </div>
  );
}

function ClusterWorkspace({ cluster }: { cluster: KubernetesClusterOverview }) {
  const [activeTab, setActiveTab] = useState<"nodes" | "deployments">("nodes");
  const [query, setQuery] = useState("");
  const readyNodes = cluster.nodes.filter((node) => node.ready).length;
  const projects = useMemo(() => groupWorkloadsByProject(cluster.workloads), [cluster.workloads]);
  const cpuPercent = average(cluster.nodes.map((node) => node.cpuPercent));
  const memoryPercent = average(cluster.nodes.map((node) => node.memoryPercent));
  const podCount = cluster.nodes.reduce((sum, node) => sum + node.podCount, 0);
  const podCapacity = cluster.nodes.reduce((sum, node) => sum + (node.podCapacity ?? 0), 0);

  return (
    <>
      <div className="operator-kube__status-strip">
        <div>
          <span className={cluster.healthy ? "is-ready" : "is-unavailable"}>
            <i aria-hidden="true" />
            {cluster.healthy ? "Healthy" : "Needs attention"}
          </span>
        </div>
        <div>
          <small>Health</small>
          <strong>{cluster.healthy ? "100%" : "Degraded"}</strong>
        </div>
        <div>
          <small>Nodes</small>
          <strong>{readyNodes} / {cluster.nodes.length} ready</strong>
        </div>
        <div>
          <small>Workloads</small>
          <strong>{cluster.workloads.length}</strong>
        </div>
        <div>
          <small>Kubernetes</small>
          <code>{cluster.version ?? "Unavailable"}</code>
        </div>
        <div>
          <small>Context</small>
          <code>{cluster.name}</code>
        </div>
      </div>

      <div className="operator-kube__content-grid">
        <aside className="operator-kube__rail">
          <section>
            <header>
              <h2>Cluster</h2>
              <span className={cluster.healthy ? "is-ready" : "is-unavailable"}>
                <i aria-hidden="true" />
                {cluster.healthy ? "Healthy" : "Degraded"}
              </span>
            </header>
            <dl>
              <div><dt>Health</dt><dd>{cluster.healthy ? "100%" : "Needs attention"}</dd></div>
              <div><dt>Nodes</dt><dd>{readyNodes} / {cluster.nodes.length} ready</dd></div>
              <div><dt>Workloads</dt><dd>{cluster.workloads.length}</dd></div>
              <div><dt>Version</dt><dd><code>{cluster.version ?? "—"}</code></dd></div>
              <div><dt>Host</dt><dd><code>{cluster.host}</code></dd></div>
            </dl>
            <Link href={`/servers/${cluster.serverId}`}>
              Server settings <ExternalLink aria-hidden="true" />
            </Link>
          </section>

          <section>
            <header><h2>Capacity</h2></header>
            <div className="operator-kube__capacity">
              <div>
                <span>CPU</span><strong>{cpuPercent == null ? "—" : `${cpuPercent}%`}</strong>
                <i><b style={{ width: `${cpuPercent ?? 0}%` }} /></i>
              </div>
              <div>
                <span>Memory</span><strong>{memoryPercent == null ? "—" : `${memoryPercent}%`}</strong>
                <i><b style={{ width: `${memoryPercent ?? 0}%` }} /></i>
              </div>
              <div>
                <span>Pods</span><strong>{podCount} / {podCapacity || "—"}</strong>
                <i><b style={{ width: `${podCapacity ? Math.round((podCount / podCapacity) * 100) : 0}%` }} /></i>
              </div>
            </div>
          </section>

          <section>
            <header><h2>Cluster signals</h2></header>
            <ul className="operator-kube__signals">
              {cluster.nodes.map((node) => (
                <li key={node.name}>
                  <i className={node.ready ? "is-ready" : "is-unavailable"} aria-hidden="true" />
                  <span>
                    <strong>{node.name}</strong>
                    <small>{node.ready ? "Node is ready" : "Node needs attention"}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <div className="operator-kube__primary">
          <section className="operator-kube__resource-panel">
            <header className="operator-kube__resource-toolbar">
              <div role="tablist" aria-label={`${cluster.name} cluster resources`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "nodes"}
                  onClick={() => setActiveTab("nodes")}
                >
                  Nodes <span>{cluster.nodes.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "deployments"}
                  onClick={() => setActiveTab("deployments")}
                >
                  Deployments <span>{projects.length}</span>
                </button>
              </div>
              {activeTab === "nodes" ? (
                <div className="operator-kube__filter">
                  <Search aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter nodes by name, role, IP…"
                    aria-label="Filter nodes"
                  />
                  <button type="button" aria-label="Node filters"><Filter aria-hidden="true" /></button>
                </div>
              ) : null}
            </header>

            {activeTab === "nodes" ? (
              <NodeTable nodes={cluster.nodes} query={query} />
            ) : (
              <div className="operator-kube__deployments">
                {projects.length === 0 ? (
                  <div className="operator-kube__empty">No OpenShip deployments on this cluster.</div>
                ) : (
                  projects.map((project) => (
                    <Link
                      href={project.projectId ? `/projects/${project.projectId}/monitoring` : "#"}
                      key={project.key}
                    >
                      <span className={project.ready ? "is-ready" : "is-unavailable"}>
                        <i aria-hidden="true" />
                      </span>
                      <div>
                        <strong>{project.projectName}</strong>
                        <small>{project.namespace} · {project.serviceCount} services</small>
                      </div>
                      <code>{project.readyReplicas} / {project.desiredReplicas}</code>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  ))
                )}
              </div>
            )}
          </section>

          <section className="operator-kube__workloads">
            <header>
              <div>
                <h2>Managed workloads</h2>
                <p>Deployments controlled by OpenShip on this cluster.</p>
              </div>
              <span>{cluster.workloads.length} total</span>
            </header>
            <div className="operator-kube__workload-table">
              <div className="operator-kube__workload-head">
                <span>Workload</span><span>Namespace</span><span>Replicas</span><span>Status</span>
              </div>
              {cluster.workloads.slice(0, 5).map((workload) => {
                const ready = workload.readyReplicas >= workload.desiredReplicas;
                return (
                  <Link
                    href={workload.projectId ? `/projects/${workload.projectId}/monitoring` : "#"}
                    key={`${workload.namespace}/${workload.name}`}
                  >
                    <span><Server aria-hidden="true" /><strong>{workload.name}</strong></span>
                    <code>{workload.namespace}</code>
                    <code>{workload.readyReplicas} / {workload.desiredReplicas}</code>
                    <span className={ready ? "is-ready" : "is-unavailable"}>
                      <i aria-hidden="true" />{ready ? "Running" : "Progressing"}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default function KubernetesPage() {
  const [data, setData] = useState<KubernetesClustersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await systemApi.listKubernetesClusters();
      setData(result);
      setActiveClusterId((current) =>
        result.clusters.some((cluster) => cluster.serverId === current)
          ? current
          : result.clusters[0]?.serverId ?? null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to inspect Kubernetes clusters.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeCluster =
    data?.clusters.find((cluster) => cluster.serverId === activeClusterId) ??
    data?.clusters[0] ??
    null;

  return (
    <div className="operator-page operator-kube">
      <header className="operator-kube__page-header">
        <div>
          <h1>Kubernetes</h1>
          <p>Manage clusters, nodes, and OpenShip workloads.</p>
        </div>
        <div className="operator-kube__actions">
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} aria-hidden="true" />
            Refresh
          </button>
          <Link href="/servers/new">
            <Plus aria-hidden="true" />
            Add cluster
          </Link>
        </div>
      </header>

      {data && data.clusters.length > 0 ? (
        <label className="operator-kube__cluster-select">
          <span className="sr-only">Active Kubernetes cluster</span>
          <select
            value={activeCluster?.serverId ?? ""}
            onChange={(event) => setActiveClusterId(event.target.value)}
          >
            {data.clusters.map((cluster) => (
              <option value={cluster.serverId} key={cluster.serverId}>{cluster.name}</option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" />
        </label>
      ) : null}

      {loading && !data ? (
        <div className="operator-kube__state">
          <Loader2 className="animate-spin" aria-hidden="true" />
          Inspecting Kubernetes clusters…
        </div>
      ) : error ? (
        <div className="operator-kube__state is-error">
          <AlertTriangle aria-hidden="true" />
          <div><strong>Cluster discovery failed</strong><span>{error}</span></div>
        </div>
      ) : activeCluster ? (
        <ClusterWorkspace cluster={activeCluster} />
      ) : (
        <div className="operator-kube__state">
          <Server aria-hidden="true" />
          <div>
            <strong>No Kubernetes cluster discovered</strong>
            <span>Add a server with passwordless sudo access to kubectl.</span>
          </div>
          <Link href="/servers/new">Add cluster host <ArrowRight aria-hidden="true" /></Link>
        </div>
      )}

      {data && data.candidates.length > 0 ? (
        <section className="operator-kube__candidates">
          <header><h2>Other registered servers</h2></header>
          {data.candidates.map((candidate) => (
            <Link href={`/servers/${candidate.serverId}`} key={candidate.serverId}>
              <Server aria-hidden="true" />
              <span><strong>{candidate.name}</strong><small>{candidate.error}</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}
