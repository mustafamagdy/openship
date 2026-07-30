# Local Docs

- Hono 4.12 WebSockets: `@hono/node-ws` / `@hono/node-server` is the Node.js
  runtime path. Bun requires `upgradeWebSocket` and `websocket` from `hono/bun`
  with Bun's native server integration; do not assume Node WebSocket upgrades
  work through Bun's Node compatibility layer. Source: `/websites/hono_dev`
  (verified 2026-07-30).
