import type { BuildConfig, ResourceConfig } from "@repo/adapters";
import type { Deployment, Project } from "@repo/db";
import type { BuildStrategy } from "@repo/core";
import { posix as pathPosix } from "node:path";

export interface BuildConfigSnapshotLike {
  repoUrl: string;
  branch: string;
  framework: string;
  buildImage: string;
  runtimeImage: string;
  packageManager: string;
  installCommand: string;
  buildCommand: string;
  outputDirectory: string;
  productionPaths: string[];
  rootDirectory: string;
  port: number;
  startCommand: string;
  hasServer: boolean;
  hasBuild: boolean;
  localPath?: string;
  buildStrategy?: BuildStrategy;
}

export interface BuildConfigFactoryOptions {
  project: Project;
  dep: Deployment;
  snapshot: BuildConfigSnapshotLike;
  sessionId: string;
  envVars: Record<string, string>;
  resources: ResourceConfig;
  gitToken?: string;
  gitUsername?: string;
  /** Desktop-only: remote credential-helper script path (deploy relay fallback). */
  gitCredentialHelperPath?: string;
  overrides?: Partial<BuildConfig>;
}

/**
 * Static output paths are relative to the configured project root. Docker's
 * build context already applies `rootDirectory`; the direct/bare deploy must
 * preserve the same convention when it hands a file root to OpenResty.
 */
export function resolveStaticRuntimeDirectory(
  rootDirectory: string,
  outputDirectory: string,
): string {
  const root = rootDirectory.trim().replace(/^\/+|\/+$/g, "");
  const output = outputDirectory.trim();

  if (!root) return output || ".";
  if (!output || output === ".") return root;
  return pathPosix.join(root, output);
}

export function createBuildConfig(opts: BuildConfigFactoryOptions): BuildConfig {
  const {
    project,
    dep,
    snapshot,
    sessionId,
    envVars,
    resources,
    gitToken,
    gitUsername,
    gitCredentialHelperPath,
    overrides,
  } = opts;

  return {
    sessionId,
    projectId: project.id,
    slug: project.slug ?? undefined,
    repoUrl: snapshot.repoUrl,
    branch: dep.branch,
    commitSha: dep.commitSha ?? undefined,
    localPath: snapshot.localPath,
    buildStrategy: snapshot.buildStrategy,
    stack: snapshot.framework,
    buildImage: snapshot.buildImage,
    runtimeImage: snapshot.runtimeImage,
    packageManager: snapshot.packageManager,
    installCommand: snapshot.hasBuild ? snapshot.installCommand : "",
    workspacePrepareCommand: project.workspacePrepareCommand?.trim() || undefined,
    buildCommand: snapshot.hasBuild ? snapshot.buildCommand : "",
    outputDirectory: snapshot.outputDirectory,
    port: snapshot.port,
    startCommand: snapshot.startCommand,
    productionPaths: snapshot.productionPaths,
    rootDirectory: snapshot.rootDirectory,
    hasServer: snapshot.hasServer,
    envVars,
    resources,
    gitToken,
    gitUsername,
    gitCredentialHelperPath,
    ...overrides,
  };
}

export function createDockerfileBuildConfig(
  opts: BuildConfigFactoryOptions,
): BuildConfig {
  return createBuildConfig({
    ...opts,
    overrides: {
      ...opts.overrides,
      stack: "docker",
      buildStrategy: "server",
      installCommand: "",
      buildCommand: "",
      outputDirectory: "",
      startCommand: "",
      productionPaths: [],
    },
  });
}

/**
 * Build config for a monorepo sub-app built from source (no Dockerfile in the
 * repo). The runtime's generated-Dockerfile branch fires when:
 *   1. stack !== "docker"   (we pass the sub-app's framework instead)
 *   2. No Dockerfile exists at the resolved root directory
 *
 * Under those conditions the runtime synthesizes a Dockerfile from
 * installCommand + buildCommand + startCommand + outputDirectory +
 * productionPaths, identical to how the single-app source pipeline builds.
 *
 * Unlike `createDockerfileBuildConfig`, this factory PRESERVES install/build/
 * start/output fields from `overrides` (or the snapshot) - those are exactly
 * what the runtime consumes to generate the Dockerfile.
 */
export function createMonorepoSourceBuildConfig(
  opts: BuildConfigFactoryOptions,
): BuildConfig {
  return createBuildConfig({
    ...opts,
    overrides: {
      buildStrategy: "server",
      hasServer: true,
      ...opts.overrides,
      // EXPLICIT undefined. The runtime's generated-Dockerfile branch fires
      // only when dockerfilePath is null/undefined AND the resolved root
      // has no Dockerfile file. If a caller ever spreads in an override
      // block that accidentally sets dockerfilePath, the synthesized-
      // Dockerfile path would silently disappear and we'd fall to "no
      // Dockerfile found" errors. Pinning it last guarantees the contract.
      dockerfilePath: undefined,
    },
  });
}
