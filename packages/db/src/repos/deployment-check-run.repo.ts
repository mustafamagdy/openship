import { and, eq } from "drizzle-orm";
import { generateId } from "@repo/core";
import type { Database } from "../client";
import { deploymentCheckRun } from "../schema";

export type DeploymentCheckRun = typeof deploymentCheckRun.$inferSelect;
export type NewDeploymentCheckRun = typeof deploymentCheckRun.$inferInsert;

export function createDeploymentCheckRunRepo(db: Database) {
  return {
    async findRollup(deploymentId: string): Promise<DeploymentCheckRun | undefined> {
      return db.query.deploymentCheckRun.findFirst({
        where: and(
          eq(deploymentCheckRun.deploymentId, deploymentId),
          eq(deploymentCheckRun.kind, "rollup"),
        ),
      });
    },

    async createRollup(data: {
      deploymentId: string;
      checkRunId: number;
      name: string;
      status: string;
      conclusion?: string | null;
    }): Promise<DeploymentCheckRun> {
      const [row] = await db
        .insert(deploymentCheckRun)
        .values({
          id: generateId("dcr"),
          deploymentId: data.deploymentId,
          checkRunId: data.checkRunId,
          name: data.name,
          kind: "rollup",
          serviceDeploymentId: null,
          status: data.status,
          conclusion: data.conclusion ?? null,
        })
        .onConflictDoNothing()
        .returning();

      if (row) return row;
      const existing = await this.findRollup(data.deploymentId);
      if (!existing) {
        throw new Error(`Could not persist preview check for deployment ${data.deploymentId}`);
      }
      return existing;
    },

    async completeRollup(deploymentId: string, conclusion: string): Promise<void> {
      await db
        .update(deploymentCheckRun)
        .set({
          status: "completed",
          conclusion,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(deploymentCheckRun.deploymentId, deploymentId),
            eq(deploymentCheckRun.kind, "rollup"),
          ),
        );
    },
  };
}
