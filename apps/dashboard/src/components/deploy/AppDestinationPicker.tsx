"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Cloud, Cpu, Boxes, Loader2 } from "lucide-react";
import { OptionCard } from "@/app/(dashboard)/(deployment)/deploy/[slug]/components/DeployTargetStep";
import ServerSelector, { type ServerOption } from "@/components/shared/ServerSelector";
import type { DeployTarget } from "@/context/deployment/types";
import { useI18n, interpolate } from "@/components/i18n-provider";
import { useCloud } from "@/context/CloudContext";
import { systemApi, type KubernetesClusterOverview } from "@/lib/api/system";
import { usePlatform } from "@/context/PlatformContext";

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
 * searchable list, carries its own "add server"), with Openship Cloud as a
 * sibling choice. Reports the pick as `{deployTarget, serverId, serverHost}`.
 *
 * DESKTOP ONLY gets a separate "this machine" card. On a server-host install the
 * Openship host is already registered as the `isLocal` "This Server" row (see
 * startup/self-server.ts) and appears in the selector above, so a second card for
 * the same box is not just redundant — it resolves to the same platform
 * (`resolveTargetPlatform` builds an identical selfhosted/socket/`provision:local`
 * target either way) while losing the server's `sshHost`, which is what makes a
 * port-only install's URL reachable. Picking it on a VPS yielded
 * `http://localhost:<port>`, useless from anywhere but the box itself. The main
 * deploy wizard already models the host purely as a server row (`useDesktopTargets`
 * offers servers + cloud, no local), so this keeps the two consistent.
 *
 * The same rule covers a host-control-disabled box: no `isLocal` row is created
 * there because the host is deliberately not a deploy target, and it isn't
 * desktop, so no local card either.
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
  const { deployMode } = usePlatform();

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

      {deployMode === "desktop" && (
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
