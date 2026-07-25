/**
 * A server target using one of these literals necessarily resolves back to
 * the OpenShip API host itself, so it must use local runtime transports.
 */
export function isLoopbackServerHost(host: string | null | undefined): boolean {
  const normalized = host?.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}
