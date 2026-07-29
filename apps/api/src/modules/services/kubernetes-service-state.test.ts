import { describe, expect, test } from "vitest";
import type { Service } from "@repo/db";
import {
  kubernetesServiceContainers,
} from "./kubernetes-service-state";
import type { LiveServiceContainer } from "./service.service";
import type { KubernetesInventory } from "../deployments/kubernetes/kubernetes-control.service";

const service = (id: string, name: string): Service =>
  ({
    id,
    projectId: "project-1",
    name,
    enabled: true,
    image: `${name}:latest`,
  }) as Service;

const inventory = (pods: KubernetesInventory["pods"]): KubernetesInventory => ({
  namespace: "openship-shop",
  summary: {
    deployments: 2,
    desiredReplicas: pods.length,
    readyReplicas: pods.filter((pod) => pod.ready).length,
    pods: pods.length,
    readyPods: pods.filter((pod) => pod.ready).length,
    healthy: pods.every((pod) => pod.ready),
  },
  deployments: [],
  pods,
  services: [
    { name: "frontend", type: "NodePort", port: 8080, nodePort: 32123 },
    { name: "cartservice", type: "ClusterIP", port: 7070 },
  ],
  disruptionBudgets: [],
});

describe("kubernetesServiceContainers", () => {
  test("reports ready pods as running and exposes their live addresses", () => {
    const result = kubernetesServiceContainers(
      [service("svc-front", "frontend"), service("svc-cart", "cartservice")],
      inventory([
        {
          name: "frontend-a",
          serviceName: "frontend",
          phase: "Running",
          podIP: "10.42.2.21",
          ready: true,
          restarts: 0,
        },
        {
          name: "frontend-b",
          serviceName: "frontend",
          phase: "Running",
          podIP: "10.42.0.40",
          ready: true,
          restarts: 0,
        },
        {
          name: "cartservice-a",
          serviceName: "cartservice",
          phase: "Running",
          podIP: "10.42.1.30",
          ready: true,
          restarts: 0,
        },
      ]),
      new Map(),
    );

    expect(result.map(({ serviceName, status, ip, hostPort }) => ({
      serviceName,
      status,
      ip,
      hostPort,
    }))).toEqual([
      {
        serviceName: "frontend",
        status: "running",
        ip: "10.42.2.21",
        hostPort: 32123,
      },
      {
        serviceName: "cartservice",
        status: "running",
        ip: "10.42.1.30",
        hostPort: 7070,
      },
    ]);
  });

  test("distinguishes pending, failed, and absent workloads", () => {
    const result: LiveServiceContainer[] = kubernetesServiceContainers(
      [
        service("svc-pending", "pending"),
        service("svc-failed", "failed"),
        service("svc-missing", "missing"),
      ],
      inventory([
        {
          name: "pending-a",
          serviceName: "pending",
          phase: "Pending",
          ready: false,
          restarts: 0,
        },
        {
          name: "failed-a",
          serviceName: "failed",
          phase: "Failed",
          ready: false,
          restarts: 3,
        },
      ]),
      new Map(),
    );

    expect(result.map((row) => row.status)).toEqual([
      "starting",
      "failed",
      "stopped",
    ]);
  });
});
