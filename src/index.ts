import { DurableObject } from "cloudflare:workers";

/**
 * A shared, persistent counter that pushes updates over WebSockets.
 *
 * - Run `npm run dev` and open http://localhost:8787 in two tabs
 * - `curl http://localhost:8787/count` to read the count
 * - `curl -X POST http://localhost:8787/increment` to increment it
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */
export class MyDurableObject extends DurableObject<Env> {
	/** Returns the current count, defaulting to 0 if nothing has been stored yet. */
	async getCount(): Promise<number> {
		return (await this.ctx.storage.get<number>("count")) ?? 0;
	}

	/** Increments the count, persists it, broadcasts it, and returns the new value. */
	async increment(): Promise<number> {
		const count = (await this.getCount()) + 1;
		await this.ctx.storage.put("count", count);

		// getWebSockets() returns every socket accepted with acceptWebSocket(),
		// including ones accepted before the object last hibernated.
		const message = JSON.stringify({ count });
		for (const ws of this.ctx.getWebSockets()) {
			ws.send(message);
		}

		return count;
	}

	/** Accepts WebSocket upgrade requests forwarded from the Worker. */
	async fetch(request: Request): Promise<Response> {
		const [client, server] = Object.values(new WebSocketPair());

		// The Hibernation API: the runtime holds the connection open, so this
		// object can be evicted from memory while sockets stay connected.
		this.ctx.acceptWebSocket(server);

		return new Response(null, { status: 101, webSocket: client });
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		// Every request talks to the same Durable Object instance, named "foo",
		// so they all share one counter.
		const stub = env.MY_DURABLE_OBJECT.getByName("foo");

		if (request.method === "GET" && url.pathname === "/count") {
			return Response.json({ count: await stub.getCount() });
		}

		if (request.method === "POST" && url.pathname === "/increment") {
			return Response.json({ count: await stub.increment() });
		}

		if (request.method === "GET" && url.pathname === "/websocket") {
			if (request.headers.get("Upgrade") !== "websocket") {
				return new Response("Expected a WebSocket upgrade", { status: 426 });
			}
			// Forward the upgrade request to the Durable Object's fetch() handler.
			return stub.fetch(request);
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
