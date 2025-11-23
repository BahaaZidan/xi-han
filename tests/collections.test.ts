import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { app } from "../src/app";
import { pgClient } from "../src/db";

const headers = {
	"Content-Type": "application/json",
	"X-User-ID": "test-user",
};
const otherUserHeaders = {
	"Content-Type": "application/json",
	"X-User-ID": "other-user",
};

type CollectionResponse = {
	id: number;
	name: string;
	description: string | null;
	createdAt: string;
	updatedAt: string;
};

type CollectionListItem = CollectionResponse & {
	itemCount: number;
	relevanceScore: number;
};

type MoveResponse = { success: boolean };

const isCollectionResponse = (value: unknown): value is CollectionResponse => {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.id === "number" &&
		typeof candidate.name === "string" &&
		(candidate.description === null || typeof candidate.description === "string") &&
		typeof candidate.createdAt === "string" &&
		typeof candidate.updatedAt === "string"
	);
};

const isCollectionListItem = (value: unknown): value is CollectionListItem => {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		isCollectionResponse(value) &&
		typeof candidate.itemCount === "number" &&
		typeof candidate.relevanceScore === "number"
	);
};

const isMoveResponse = (value: unknown): value is MoveResponse =>
	Boolean(
		value &&
			typeof value === "object" &&
			typeof (value as Record<string, unknown>).success === "boolean"
	);

const findCollection = (list: CollectionListItem[], id: number): CollectionListItem => {
	const found = list.find((item) => item.id === id);
	if (!found) {
		throw new Error(`Collection with id ${id} not found in list`);
	}
	return found;
};

const parseCollection = async (res: Response): Promise<CollectionResponse> => {
	const body = await res.json();
	if (!isCollectionResponse(body)) {
		throw new Error("Unexpected collection response shape");
	}
	return body;
};

const parseCollectionList = async (res: Response): Promise<CollectionListItem[]> => {
	const body = await res.json();
	if (!Array.isArray(body) || !body.every(isCollectionListItem)) {
		throw new Error("Unexpected collections list shape");
	}
	return body;
};

const parseMoveResponse = async (res: Response): Promise<MoveResponse> => {
	const body = await res.json();
	if (!isMoveResponse(body)) {
		throw new Error("Unexpected move response shape");
	}
	return body;
};

const isPostgresError = (error: unknown): error is { code: string } =>
	Boolean(
		error &&
			typeof error === "object" &&
			"code" in error &&
			typeof (error as Record<string, unknown>).code === "string"
	);

const resetDb = async () => {
	await pgClient`TRUNCATE TABLE collection_items RESTART IDENTITY CASCADE`;
	await pgClient`TRUNCATE TABLE collections RESTART IDENTITY CASCADE`;
	await pgClient`TRUNCATE TABLE users RESTART IDENTITY CASCADE`;
};

beforeEach(resetDb);
afterAll(async () => {
	await resetDb();
	await pgClient.end();
});

describe("Collections API", () => {
	it("handles duplicate collection names by appending counters", async () => {
		const first = await app.request("/collections", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "My List" }),
		});

		expect(first.status).toBe(201);

		const second = await app.request("/collections", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "My List" }),
		});

		const secondBody = await parseCollection(second);
		expect(second.status).toBe(201);
		expect(secondBody.name).toBe("My List (1)");
	});

	it("keeps base names unique per user but allows same names across users", async () => {
		const first = await app.request("/collections", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "Shared Name" }),
		});
		const second = await app.request("/collections", {
			method: "POST",
			headers: otherUserHeaders,
			body: JSON.stringify({ name: "Shared Name" }),
		});
		const third = await app.request("/collections", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "Shared Name" }),
		});

		const firstBody = await parseCollection(first);
		const secondBody = await parseCollection(second);
		const thirdBody = await parseCollection(third);

		expect(first.status).toBe(201);
		expect(second.status).toBe(201);
		expect(third.status).toBe(201);
		expect(firstBody.name).toBe("Shared Name");
		expect(secondBody.name).toBe("Shared Name");
		expect(thirdBody.name).toBe("Shared Name (1)");
	});

	it("enforces the 5-item limit per collection", async () => {
		const collection = await app.request("/collections", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "Limited" }),
		});

		const collectionBody = await parseCollection(collection);

		for (let i = 0; i < 5; i += 1) {
			const res = await app.request(`/collections/${collectionBody.id}/items`, {
				method: "POST",
				headers,
				body: JSON.stringify({ itemId: `item-${i}` }),
			});
			expect(res.status).toBe(201);
		}

		const sixth = await app.request(`/collections/${collectionBody.id}/items`, {
			method: "POST",
			headers,
			body: JSON.stringify({ itemId: "item-6" }),
		});

		expect(sixth.status).toBe(400);
		const body = await sixth.json();
		expect(body.error).toBeDefined();
	});

	it("enforces the 5-item limit at the database layer", async () => {
		const collectionRes = await app.request("/collections", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "DB Limit" }),
		});
		const collection = await parseCollection(collectionRes);

		for (let i = 0; i < 5; i += 1) {
			await pgClient`insert into collection_items (collection_id, item_id) values (${collection.id}, ${`raw-${i}`})`;
		}

		let caught: unknown;
		try {
			await pgClient`insert into collection_items (collection_id, item_id) values (${collection.id}, 'overflow')`;
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeTruthy();
		if (isPostgresError(caught)) {
			expect(caught.code).toBe("P0001");
		}
	});

	it("moves items atomically between collections", async () => {
		const sourceRes = await app.request("/collections", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "Source" }),
		});
		const targetRes = await app.request("/collections", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "Target" }),
		});

		const source = await parseCollection(sourceRes);
		const target = await parseCollection(targetRes);

		const add = await app.request(`/collections/${source.id}/items`, {
			method: "POST",
			headers,
			body: JSON.stringify({ itemId: "item-1", note: "hello" }),
		});
		expect(add.status).toBe(201);

		const move = await app.request("/collections/move-item", {
			method: "PUT",
			headers,
			body: JSON.stringify({
				itemId: "item-1",
				sourceCollectionId: source.id,
				targetCollectionId: target.id,
			}),
		});

		expect(move.status).toBe(200);
		const moveBody = await parseMoveResponse(move);
		expect(moveBody.success).toBe(true);

		const listResponse = await app.request("/collections", { method: "GET", headers });
		const collectionsList = await parseCollectionList(listResponse);

		const updatedSource = findCollection(collectionsList, source.id);
		const updatedTarget = findCollection(collectionsList, target.id);

		expect(updatedSource.itemCount).toBe(0);
		expect(updatedTarget.itemCount).toBe(1);
		expect(updatedTarget.relevanceScore).toBe(2);
	});

	it("rejects move into full target and leaves source untouched", async () => {
		const sourceResponse = await app.request("/collections", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "Source" }),
		});
		const targetResponse = await app.request("/collections", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "Full Target" }),
		});

		const source = await parseCollection(sourceResponse);
		const target = await parseCollection(targetResponse);

		for (let i = 0; i < 5; i += 1) {
			const res = await app.request(`/collections/${target.id}/items`, {
				method: "POST",
				headers,
				body: JSON.stringify({ itemId: `item-${i}` }),
			});
			expect(res.status).toBe(201);
		}

		const addSource = await app.request(`/collections/${source.id}/items`, {
			method: "POST",
			headers,
			body: JSON.stringify({ itemId: "move-me" }),
		});
		expect(addSource.status).toBe(201);

		const move = await app.request("/collections/move-item", {
			method: "PUT",
			headers,
			body: JSON.stringify({
				itemId: "move-me",
				sourceCollectionId: source.id,
				targetCollectionId: target.id,
			}),
		});

		expect(move.status).toBe(400);

		const listResponse = await app.request("/collections", { method: "GET", headers });
		const list = await parseCollectionList(listResponse);
		const updatedSource = findCollection(list, source.id);
		const updatedTarget = findCollection(list, target.id);

		expect(updatedSource.itemCount).toBe(1);
		expect(updatedTarget.itemCount).toBe(5);
	});

	it("prevents duplicate items on concurrent adds", async () => {
		const collectionResponse = await app.request("/collections", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "Concurrent" }),
		});
		const collection = await parseCollection(collectionResponse);

		const [first, second] = await Promise.all([
			app.request(`/collections/${collection.id}/items`, {
				method: "POST",
				headers,
				body: JSON.stringify({ itemId: "dupe" }),
			}),
			app.request(`/collections/${collection.id}/items`, {
				method: "POST",
				headers,
				body: JSON.stringify({ itemId: "dupe" }),
			}),
		]);

		const statuses = [first.status, second.status].sort();
		expect(statuses).toEqual([201, 409]);

		const listResponse = await app.request("/collections", { method: "GET", headers });
		const list = await parseCollectionList(listResponse);
		const updated = findCollection(list, collection.id);
		expect(updated.itemCount).toBe(1);
	});

	it("orders collections by relevance then recency", async () => {
		const create = async (name: string) => {
			const res = await app.request("/collections", {
				method: "POST",
				headers,
				body: JSON.stringify({ name }),
			});
			return parseCollection(res);
		};

		const first = await create("First");
		await app.request(`/collections/${first.id}/items`, {
			method: "POST",
			headers,
			body: JSON.stringify({ itemId: "a", note: "note" }),
		});

		await new Promise((r) => setTimeout(r, 10));

		const second = await create("Second");
		await app.request(`/collections/${second.id}/items`, {
			method: "POST",
			headers,
			body: JSON.stringify({ itemId: "b" }),
		});

		await new Promise((r) => setTimeout(r, 10));

		const third = await create("Third");
		await app.request(`/collections/${third.id}/items`, {
			method: "POST",
			headers,
			body: JSON.stringify({ itemId: "c", note: "note" }),
		});

		const listResponse = await app.request("/collections", { method: "GET", headers });
		const list = await parseCollectionList(listResponse);
		const namesInOrder = list.map((c) => c.name);

		expect(namesInOrder.slice(0, 3)).toEqual(["Third", "First", "Second"]);
	});

	it("requires user header", async () => {
		const res = await app.request("/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "No User" }),
		});

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBeDefined();
	});
});
