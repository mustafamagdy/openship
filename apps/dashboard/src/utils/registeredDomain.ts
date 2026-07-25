import { normalizeSubdomain } from "./subdomain";

export interface RegisteredDomainOption {
  domain: string;
  isDefault?: boolean;
}

export function matchRegisteredDomain(
  hostname: string,
  domains: RegisteredDomainOption[],
): { domain: string; subdomain: string } | null {
  const normalized = hostname.trim().toLowerCase();
  const match = [...domains]
    .sort((left, right) => right.domain.length - left.domain.length)
    .find((candidate) => normalized.endsWith(`.${candidate.domain.toLowerCase()}`));
  if (!match) return null;
  const subdomain = normalized.slice(0, -(match.domain.length + 1));
  return subdomain ? { domain: match.domain, subdomain } : null;
}

export function defaultRegisteredDomain(domains: RegisteredDomainOption[]): string | null {
  return domains.find((domain) => domain.isDefault)?.domain ?? domains[0]?.domain ?? null;
}

export function buildRegisteredHostname(subdomain: string, domain: string): string {
  const label = normalizeSubdomain(subdomain);
  return label ? `${label}.${domain.toLowerCase()}` : "";
}
