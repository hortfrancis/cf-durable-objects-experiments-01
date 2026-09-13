# Durable Objects experiment: shared counter + live text

A minimal, dependency-free Cloudflare Workers project for learning Durable Objects. One Durable Object holds a counter and two text strings, stores them persistently, and pushes every change to all open browser tabs over WebSockets.

**Useful as a reference for:**

- Calling a Durable Object from a Worker over RPC (`env.MY_DURABLE_OBJECT.getByName("foo")` → `stub.increment()`)
- Persisting state with `this.ctx.storage.get` / `put`
- Accepting WebSockets with the **Hibernation API** (`this.ctx.acceptWebSocket`, `this.ctx.getWebSockets`, `webSocketMessage`)
- Broadcasting to every connected client, and skipping the sender
- Two ways of writing shared text: HTTP + a Save button, and a WebSocket message per keystroke
- Serving a static HTML page next to a Worker with `assets`

**Not included:** auth, rooms/multiple object instances, reconnect logic, conflict resolution (CRDT/OT), tests, frameworks.

## Files

| File | What's in it |
| --- | --- |
| `src/index.ts` | The whole backend: the `MyDurableObject` class and the Worker's `fetch` router |
| `public/index.html` | The whole frontend: plain HTML + inline JS |
| `wrangler.jsonc` | Durable Object binding + SQLite migration, `assets` directory |

## Routes

All routes use the same object instance, named `"foo"`.

| Route | Does |
| --- | --- |
| `GET /` | The page (served from `public/`) |
| `GET /count` | `{ "count": n }` |
| `POST /increment` | Increments, broadcasts `{ count }`, returns `{ "count": n }` |
| `GET /text` | `{ "text": "..." }`, the Save-button text |
| `PUT /text` | Body `{ "text": "..." }`. Stores it and broadcasts `{ text }` to everyone |
| `GET /live-text` | `{ "liveText": "..." }`, the as-you-type text |
| `GET /websocket` | WebSocket upgrade, forwarded to the Durable Object |

Messages over the socket are JSON with a single key: `{ count }`, `{ text }`, or `{ liveText }`. Clients send `{ liveText }`, and the object stores it and broadcasts it to every *other* socket.

## Run and deploy

```sh
npm install
npm run dev      # http://localhost:8787, open it in two tabs
npm run deploy   # needs `npx wrangler login`
```

Local Durable Object storage lives in `.wrangler/state/`. Delete it to reset. The deployed object has its own separate storage.

## Things learned

- **State survives only in storage.** The object instance is created on demand and evicted when idle, so class fields (`this.x`) are lost. Only `ctx.storage` persists.
- **Concurrent increments are safe.** Durable Objects hold other incoming events while a storage call is in progress (input gates), so a read-then-write doesn't race.
- **Hibernation:** with `acceptWebSocket`, the runtime holds sockets open while the object is evicted. The next event wakes a fresh instance, and `getWebSockets()` still returns every socket. You aren't billed for idle time.
- **No close handler needed:** with `compatibility_date` ≥ 2026-04-07 (`web_socket_auto_reply_to_close`), the runtime replies to close frames automatically.
- **Live typing doesn't echo to the sender**, so a late echo can't overwrite in-progress typing. The trade-off is that two people typing at the same moment can see different text until someone types again. Fixing that properly needs CRDTs/OT.
- **Deploys drop WebSockets.** The page has no reconnect, so reload the tabs after deploying.
