import { describe, expect, it } from "vitest";
import { groupWorkloadsByProject } from "./kubernetes-workload-groups";

describe("groupWorkloadsByProject", () => {
  it("collapses a multi-service Kubernetes stack into one OpenShip project", () => {
    const groups = groupWorkloadsByProject([
      {
        name: "frontend",
        namespace: "openship-shop",
        projectId: "proj_shop",
        projectName: "Shop",
        deploymentId: "dep_1",
        desiredReplicas: 3,
        readyReplicas: 3,
      },
      {
        name: "cart",
        namespace: "openship-shop",
        projectId: "proj_shop",
        projectName: "Shop",
        deploymentId: "dep_1",
        desiredReplicas: 1,
        readyReplicas: 1,
      },
    ]);

    expect(groups).toEqual([
      {
        key: "project:proj_shop",
        projectId: "proj_shop",
        projectName: "Shop",
        namespace: "openship-shop",
        serviceCount: 2,
        desiredReplicas: 4,
        readyReplicas: 4,
        ready: true,
      },
    ]);
  });

  it("marks the project unhealthy when any service is short of replicas", () => {
    const [group] = groupWorkloadsByProject([
      {
        name: "api",
        namespace: "openship-app",
        projectId: "proj_app",
        projectName: "App",
        deploymentId: "dep_2",
        desiredReplicas: 2,
        readyReplicas: 1,
      },
      {
        name: "worker",
        namespace: "openship-app",
        projectId: "proj_app",
        projectName: "App",
        deploymentId: "dep_2",
        desiredReplicas: 1,
        readyReplicas: 1,
      },
    ]);

    expect(group?.ready).toBe(false);
    expect(group?.readyReplicas).toBe(2);
    expect(group?.desiredReplicas).toBe(3);
  });

  it("does not merge unbound Kubernetes workloads", () => {
    const groups = groupWorkloadsByProject([
      {
        name: "one",
        namespace: "legacy",
        projectId: null,
        projectName: null,
        deploymentId: null,
        desiredReplicas: 1,
        readyReplicas: 1,
      },
      {
        name: "two",
        namespace: "legacy",
        projectId: null,
        projectName: null,
        deploymentId: null,
        desiredReplicas: 1,
        readyReplicas: 1,
      },
    ]);

    expect(groups).toHaveLength(2);
  });
});
