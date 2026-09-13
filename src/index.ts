import { DurableObject } from "cloudflare:workers";

/**
 * A shared, persistent counter.
 *
 * - Run `npm run dev` to start a local development server
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

	/** Increments the count, persists it, and returns the new value. */
	async increment(): Promise<number> {
		const count = (await this.getCount()) + 1;
		await this.ctx.storage.put("count", count);
		return count;
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

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
