"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Cloud, Cpu, Boxes, Loader2 } from "lucide-react";
import { OptionCard } from "@/app/(dashboard)/(deployment)/deploy/[slug]/components/DeployTargetStep";
import ServerSelector, { type ServerOption } from "@/components/shared/ServerSelector";
import type { DeployTarget } from "@/context/deployment/types";
import { useI18n, interpolate } from "@/components/i18n-provider";
import { useCloud } from "@/context/CloudContext";
import { systemApi, type KubernetesClusterOverview } from "@/lib/api/system";

export interface AppDestination {
  deployTarget: DeployTarget;
  serverId?: string;
  /** Host of the selected server (sshHost) — lets the app wizard build a
   *  reachable `http://host:port` URL for a port-only (no-domain) install. */
  serverHost?: string;
  deploymentEngine?: "native" | "kubernetes";
  kubernetesServerId?: string;
  kubernetesReplicas?: number;
}

/**
 * "Where to install" picker for the app wizards. Servers use the shared
 * mail-style `ServerSelector` dropdown (pre-selects the first/only server so the
 * wizard opens with a destination already chosen; collapses many into a
 * searchable list, carries its own "add server"), with Openship Cloud /
 * this-machine as sibling choices. Reports the pick as
 * `{deployTarget, serverId, serverHost}`.
 */
export function AppDestinationPicker({
  value,
  onChange,
  allowLocal = false,
  allowKubernetes = true,
}: {
  value: AppDestination | null;
  onChange: (d: AppDestination) => void;
  allowLocal?: boolean;
  allowKubernetes?: boolean;
}) {
  const { t } = useI18n();
  const w = t.projectSettings.appInstall;
  const opt = t.deploy.targetStep.options;
  const { connected: cloudConnected } = useCloud();
  const [clusters, setClusters] = useState<KubernetesClusterOverview[]>([]);
  const [clustersLoading, setClustersLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void systemApi
      .listKubernetesClusters()
      .then((response) => {
        if (!cancelled && allowKubernetes) {
          setClusters(response.clusters.filter((cluster) => cluster.configured));
        }
      })
      .catch(() => {
        if (!cancelled) setClusters([]);
      })
      .finally(() => {
        if (!cancelled) setClustersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowKubernetes]);

  const serverActive =
    value?.deployTarget === "server" && value.deploymentEngine !== "kubernetes";
  const clusterIds = useMemo(() => clusters.map((cluster) => cluster.serverId), [clusters]);

  // A server may have been auto-selected while cluster discovery was still in
  // flight. Once we learn it is a registered cluster, promote that ambiguous
  // native-server choice to the Kubernetes destination the user sees.
  useEffect(() => {
    if (
      value?.deployTarget === "server" &&
      value.deploymentEngine !== "kubernetes" &&
      clusters.some((cluster) => cluster.serverId === value.serverId && cluster.healthy)
    ) {
      onChange({
        ...value,
        deploymentEngine: "kubernetes",
        kubernetesServerId: value.serverId,
        kubernetesReplicas: 1,
      });
    }
  }, [clusters, onChange, value]);

  return (
    <div className="space-y-2">
      {clustersLoading && (
        <div className="flex items-center gap-2 px-3.5 py-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {w.destKubernetesLoading}
        </div>
      )}

      {clusters.map((cluster) => (
        <OptionCard
          key={cluster.serverId}
          value={`kubernetes:${cluster.serverId}`}
          selected={
            value?.deploymentEngine === "kubernetes" &&
            value.kubernetesServerId === cluster.serverId
          }
          onSelect={() =>
            onChange({
              deployTarget: "server",
              serverId: cluster.serverId,
              serverHost: cluster.host,
              deploymentEngine: "kubernetes",
              kubernetesServerId: cluster.serverId,
              kubernetesReplicas: 1,
            })
          }
          icon={<Boxes className="size-4" />}
          label={`${w.destKubernetes} · ${cluster.name}`}
          description={
            cluster.healthy
              ? interpolate(w.destKubernetesHealthy, {
                  nodes: String(cluster.nodes.filter((node) => node.ready).length),
                })
              : cluster.error || w.destKubernetesUnhealthy
          }
          disabled={!cluster.healthy}
        />
      ))}

      {/* Servers — mail-style dropdown. Ring shows when it's the active target
          (the selector only highlights a server while server is chosen). */}
      <div
        className={`rounded-xl transition-shadow ${serverActive ? "ring-2 ring-primary/40" : ""}`}
      >
        <ServerSelector
          compact
          autoSelectFirst
          excludeIds={clusterIds}
          hideWhenEmpty={clusterIds.length > 0}
          value={serverActive ? (value?.serverId ?? null) : null}
          onSelect={(s: ServerOption | null) => {
            if (s) onChange({ deployTarget: "server", serverId: s.id, serverHost: s.host });
          }}
        />
      </div>

      <OptionCard
        value="cloud"
        selected={value?.deployTarget === "cloud"}
        onSelect={() => onChange({ deployTarget: "cloud" })}
        icon={<Cloud className="size-4" />}
        label={opt.cloud}
        description={cloudConnected ? opt.cloudConnectedDesc : opt.cloudDisconnectedDesc}
      />

      {allowLocal && (
        <OptionCard
          value="local"
          selected={value?.deployTarget === "local"}
          onSelect={() => onChange({ deployTarget: "local" })}
          icon={<Cpu className="size-4" />}
          label={w.destLocal}
          description={w.destLocalDesc}
        />
      )}
    </div>
  );
}
