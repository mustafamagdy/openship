# Local Docs

- Hono 4.12 WebSockets: `@hono/node-ws` / `@hono/node-server` is the Node.js
  runtime path. Bun requires `upgradeWebSocket` and `websocket` from `hono/bun`
  with Bun's native server integration; do not assume Node WebSocket upgrades
  work through Bun's Node compatibility layer. Source: `/websites/hono_dev`
  (verified 2026-07-30).
- Supabase self-hosting (`supabase/postgres:17.6.1.136`): the database image
  needs the official init SQL mounts (notably `99-roles.sql`) in addition to
  `POSTGRES_PASSWORD`; those scripts assign the shared password to internal
  roles such as `supabase_auth_admin`, `authenticator`, and
  `supabase_storage_admin`. Kubernetes catalog deploys must preserve template
  files as ConfigMap mounts on a fresh data volume. Source:
  `/supabase/supabase` (verified 2026-07-30).
