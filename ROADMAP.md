# OpenShip Self-Hosting Roadmap

This roadmap tracks the work required to evolve OpenShip from a capable
single-server PaaS into a resilient, multi-node self-hosting control plane.
Items are ordered by dependency and operational risk, not by marketing priority.

## In progress

### Fork-native releases and self-updates

- Publish a checksum-protected CLI bundle and server release for every version.
- Let installations follow upstream stable, a selected fork, or a pinned version.
- Run release preflight checks before publishing.
- Keep the fork synchronized with upstream through reviewable pull requests and
  report merge conflicts without modifying the production branch.

### Managed DNS automation

- Connect a scoped Cloudflare API token without exposing it after storage.
- Discover and bind registered domains to their Cloudflare zones.
- Reconcile ownership, wildcard, application, and preview DNS records.
- Report conflicts and drift before changing records.
- Monitor DNS and certificate health.

### OCI build-once distribution

- Connect GHCR or another standard OCI registry.
- Publish successful source builds with immutable commit tags and record digests.
- Deploy the exact digest to another Docker host without rebuilding.
- Retain images required by active rollback windows.
- Add portable registry-backed build cache support.

## Next

### K3s runtime adapter

- Keep Docker as the simple single-node runtime.
- Translate OpenShip services, routes, health checks, secrets, and storage into
  Kubernetes resources.
- Validate on one-node K3s first.
- Support a three-server embedded-etcd topology before describing the runtime as
  highly available.
- Add agent-node placement, maintenance mode, cordon, drain, and safe evacuation.

### Isolated build workers

- Move untrusted repository builds away from the control-plane host.
- Use rootless or strongly isolated BuildKit workers with no public API access
  to the host Docker socket.
- Enforce CPU, memory, disk, process, and duration limits.
- Support per-project egress policy.
- Produce SBOMs, vulnerability reports, provenance, and signed images.

### Disaster recovery

- Support PostgreSQL and Redis as the production control-plane data services.
- Encrypt backups and store them off-server in S3-compatible object storage.
- Cover the database, encryption keys, configuration, certificates, volumes,
  deployment metadata, and registry references.
- Run automatic restore verification in an isolated environment.
- Publish and test recovery objectives; initial target: RPO one hour, RTO two
  hours.

### Observability and operations

- Collect host, container, deployment, queue, database, certificate, and HTTP
  metrics.
- Centralize searchable logs with retention controls.
- Correlate deployments with latency and error changes.
- Alert on unavailable apps, crash loops, low disk, failed backups, expiring
  certificates, and unusual resource growth.
- Track uptime and service-level objectives per application.

### Mature preview environments

- Add automatic expiration and cleanup.
- Enforce project and organization quotas and resource limits.
- Support isolated preview databases or explicit data-cloning policies.
- Add environment-variable and secret policies.
- Preserve redeployment history and provider status links.
- Continue to refuse privileged production secrets for untrusted fork builds.

### Identity, approvals, and secrets

- Add MFA/passkeys and OIDC/SAML providers such as Entra ID, Authentik, or
  Keycloak.
- Support external secret backends, rotation, and versioning.
- Use short-lived node credentials.
- Add approval gates for production deployment, restore, domain deletion, and
  workload migration.
- Export audit events to tamper-resistant storage.

### Fully sovereign mode

Keep integrations replaceable so self-hosting does not require a specific SaaS:

- Forgejo or Gitea for Git.
- Harbor for OCI images.
- MinIO or compatible S3 storage.
- Headscale for a private mesh.
- Authentik or Keycloak for identity.

GitHub, Azure DevOps, Cloudflare, and Tailscale remain first-class integrations;
they are options rather than architectural requirements.

## Operating principles

- Never move a workload automatically. Show the migration plan and require an
  explicit target.
- Build once and promote the same digest between environments.
- Back up state before destructive cutovers and keep a tested rollback path.
- Treat repository builds as untrusted code.
- Do not call a topology highly available until failure and restore tests prove
  it.
