import type { InstallMethod } from "./compose";

export function shouldRunControl(opts: {
  serviceInstalled: boolean;
  installMethod: InstallMethod | null;
  setupInProgress: boolean;
}): boolean {
  const installed = opts.serviceInstalled || opts.installMethod === "compose";
  return installed && !opts.setupInProgress;
}
