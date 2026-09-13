import { DurableObject } from "cloudflare:workers";

/**
 * A shared, persistent counter and two text strings that push updates over WebSockets.
 *
 * - Run `npm run dev` and open http://localhost:8787 in two tabs
 * - `curl http://localhost:8787/count` to read the count
 * - `curl -X POST http://localhost:8787/increment` to increment it
 * - `curl -X PUT http://localhost:8787/text -d '{"text":"hi"}'` to set the saved text
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
		this.broadcast({ count });
		return count;
	}

	/** Returns the saved text (updated with a Save button), defaulting to an empty string. */
	async getText(): Promise<string> {
		return (await this.ctx.storage.get<string>("text")) ?? "";
	}

	/** Replaces the saved text, persists it, broadcasts it, and returns it. */
	async setText(text: string): Promise<string> {
		await this.ctx.storage.put("text", text);
		this.broadcast({ text });
		return text;
	}

	/** Returns the live text (updated on every keystroke), defaulting to an empty string. */
	async getLiveText(): Promise<string> {
		return (await this.ctx.storage.get<string>("liveText")) ?? "";
	}

	/**
	 * Sends a JSON message to every connected WebSocket, optionally skipping one
	 * (the sender, so its own keystrokes aren't echoed back while it's typing).
	 */
	broadcast(message: object, except?: WebSocket) {
		// getWebSockets() returns every socket accepted with acceptWebSocket(),
		// including ones accepted before the object last hibernated.
		const json = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets()) {
			if (ws !== except) ws.send(json);
		}
	}

	/** Accepts WebSocket upgrade requests forwarded from the Worker. */
	async fetch(request: Request): Promise<Response> {
		const [client, server] = Object.values(new WebSocketPair());

		// The Hibernation API: the runtime holds the connection open, so this
		// object can be evicted from memory while sockets stay connected.
		this.ctx.acceptWebSocket(server);

		return new Response(null, { status: 101, webSocket: client });
	}

	/**
	 * Called by the runtime when a client sends a message, waking the object if
	 * it was hibernating. Clients send { liveText } on every keystroke.
	 */
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		let liveText: unknown;
		try {
			({ liveText } = JSON.parse(String(message)));
		} catch {
			return; // Ignore anything that isn't JSON.
		}
		if (typeof liveText !== "string") return;

		await this.ctx.storage.put("liveText", liveText);
		this.broadcast({ liveText }, ws);
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		// Every request talks to the same Durable Object instance, named "foo",
		// so they all share the same counter and text strings.
		const stub = env.MY_DURABLE_OBJECT.getByName("foo");

		if (request.method === "GET" && url.pathname === "/count") {
			return Response.json({ count: await stub.getCount() });
		}

		if (request.method === "POST" && url.pathname === "/increment") {
			return Response.json({ count: await stub.increment() });
		}

		if (request.method === "GET" && url.pathname === "/text") {
			return Response.json({ text: await stub.getText() });
		}

		if (request.method === "PUT" && url.pathname === "/text") {
			const { text } = await request.json<{ text?: unknown }>();
			if (typeof text !== "string") {
				return new Response('Expected JSON like {"text": "..."}', { status: 400 });
			}
			return Response.json({ text: await stub.setText(text) });
		}

		// The live text is written over the WebSocket, so it only needs a read route.
		if (request.method === "GET" && url.pathname === "/live-text") {
			return Response.json({ liveText: await stub.getLiveText() });
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
