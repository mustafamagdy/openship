#!/usr/bin/env bun

type PackageManifest = Record<string, unknown> & {
  scripts?: Record<string, unknown>;
};

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
] as const;

export function sanitizeCliPackageManifest(manifest: PackageManifest): PackageManifest {
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = manifest[section];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;

    for (const [name, specifier] of Object.entries(dependencies)) {
      if (typeof specifier === "string" && specifier.startsWith("workspace:")) {
        delete (dependencies as Record<string, unknown>)[name];
      }
    }
  }

  delete manifest.scripts?.prepack;
  return manifest;
}

export async function sanitizeCliPackageFile(path: string): Promise<void> {
  const manifest = sanitizeCliPackageManifest(await Bun.file(path).json());
  await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: bun scripts/sanitize-cli-package.ts <package.json>");
    process.exit(1);
  }

  await sanitizeCliPackageFile(path);
}
