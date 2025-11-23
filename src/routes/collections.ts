import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { PostgresError } from "postgres";
import { z } from "zod";

import { db } from "../db";
import { collectionItems, collections, users } from "../schema";
import type { AppBindings } from "../types";

const router = new Hono<AppBindings>();

const createCollectionSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
});

const addItemSchema = z.object({
	itemId: z.string().min(1),
	note: z.string().optional(),
});

const moveItemSchema = z.object({
	itemId: z.string().min(1),
	sourceCollectionId: z.number().int().positive(),
	targetCollectionId: z.number().int().positive(),
});

const MAX_ITEMS_PER_COLLECTION = 5;
const MAX_NAME_ATTEMPTS = 25;

const ensureUserExists = async (userId: string) => {
	await db.insert(users).values({ id: userId }).onConflictDoNothing({ target: users.id });
};

const formatError = (message: string) => ({ error: message });

const getPgError = (error: unknown): PostgresError | undefined => {
	if (!error || typeof error !== "object") return undefined;
	const direct = error as PostgresError;
	const caused = (error as { cause?: PostgresError }).cause;
	return direct?.code ? direct : caused?.code ? caused : undefined;
};

const isUniqueViolation = (error: unknown) => getPgError(error)?.code === "23505";

const isLimitViolation = (error: unknown) => {
	const message = getPgError(error)?.message;
	return typeof message === "string" && message.toLowerCase().includes("limit reached");
};

router.post("/", async (c) => {
	const userId = c.get("userId");
	let parsedBody;

	try {
		parsedBody = createCollectionSchema.parse(await c.req.json());
	} catch (error) {
		return c.json(formatError("Invalid request body"), 400);
	}

	await ensureUserExists(userId);

	const baseName = parsedBody.name.trim();
	if (!baseName) {
		return c.json(formatError("Name cannot be empty"), 400);
	}

	let attempt = 0;

	while (attempt < MAX_NAME_ATTEMPTS) {
		const candidateName = attempt === 0 ? baseName : `${baseName} (${attempt})`;
		try {
			const [created] = await db
				.insert(collections)
				.values({
					userId,
					name: candidateName,
					description: parsedBody.description,
				})
				.returning();

			return c.json(created, 201);
		} catch (error) {
			if (isUniqueViolation(error)) {
				attempt += 1;
				continue;
			}

			throw error;
		}
	}

	throw new HTTPException(500, { message: "Failed to generate unique collection name" });
});

router.post("/:id/items", async (c) => {
	const userId = c.get("userId");
	const id = Number(c.req.param("id"));
	if (!Number.isInteger(id) || id <= 0) {
		return c.json(formatError("Invalid collection id"), 400);
	}

	let parsedBody;
	try {
		parsedBody = addItemSchema.parse(await c.req.json());
	} catch (error) {
		return c.json(formatError("Invalid request body"), 400);
	}

	try {
		await db.transaction(async (tx) => {
			const [collection] = await tx
				.select()
				.from(collections)
				.where(and(eq(collections.id, id), eq(collections.userId, userId)))
				.for("update");

			if (!collection) {
				throw new HTTPException(404, { message: "Collection not found" });
			}

			const [existing] = await tx
				.select()
				.from(collectionItems)
				.where(
					and(eq(collectionItems.collectionId, id), eq(collectionItems.itemId, parsedBody.itemId))
				)
				.for("update");

			if (existing) {
				throw new HTTPException(409, { message: "Item already exists in collection" });
			}

			const lockedItems = await tx
				.select({ id: collectionItems.id })
				.from(collectionItems)
				.where(eq(collectionItems.collectionId, id))
				.for("update");

			if (lockedItems.length >= MAX_ITEMS_PER_COLLECTION) {
				throw new HTTPException(400, { message: "Collection is full" });
			}

			await tx.insert(collectionItems).values({
				collectionId: id,
				itemId: parsedBody.itemId,
				note: parsedBody.note,
			});
		});
	} catch (error) {
		if (error instanceof HTTPException) {
			throw error;
		}

		if (isLimitViolation(error)) {
			throw new HTTPException(400, { message: "Collection is full" });
		}

		if (isUniqueViolation(error)) {
			throw new HTTPException(409, { message: "Item already exists in collection" });
		}

		throw error;
	}

	return c.json({}, 201);
});

router.put("/move-item", async (c) => {
	const userId = c.get("userId");

	let parsedBody;
	try {
		parsedBody = moveItemSchema.parse(await c.req.json());
	} catch (error) {
		return c.json(formatError("Invalid request body"), 400);
	}

	if (parsedBody.sourceCollectionId === parsedBody.targetCollectionId) {
		return c.json(formatError("Source and target collections must differ"), 400);
	}

	try {
		await db.transaction(async (tx) => {
			const [source] = await tx
				.select()
				.from(collections)
				.where(
					and(eq(collections.id, parsedBody.sourceCollectionId), eq(collections.userId, userId))
				)
				.for("update");

			if (!source) {
				throw new HTTPException(404, { message: "Source collection not found" });
			}

			const [target] = await tx
				.select()
				.from(collections)
				.where(
					and(eq(collections.id, parsedBody.targetCollectionId), eq(collections.userId, userId))
				)
				.for("update");

			if (!target) {
				throw new HTTPException(404, { message: "Target collection not found" });
			}

			const [item] = await tx
				.select()
				.from(collectionItems)
				.where(
					and(
						eq(collectionItems.collectionId, parsedBody.sourceCollectionId),
						eq(collectionItems.itemId, parsedBody.itemId)
					)
				)
				.for("update");

			if (!item) {
				throw new HTTPException(404, { message: "Item not found in source collection" });
			}

			const lockedTargetItems = await tx
				.select({ id: collectionItems.id })
				.from(collectionItems)
				.where(eq(collectionItems.collectionId, parsedBody.targetCollectionId))
				.for("update");

			if (lockedTargetItems.length >= MAX_ITEMS_PER_COLLECTION) {
				throw new HTTPException(400, { message: "Target collection is full" });
			}

			const [duplicate] = await tx
				.select()
				.from(collectionItems)
				.where(
					and(
						eq(collectionItems.collectionId, parsedBody.targetCollectionId),
						eq(collectionItems.itemId, parsedBody.itemId)
					)
				)
				.for("update");

			if (duplicate) {
				throw new HTTPException(409, { message: "Item already exists in target collection" });
			}

			await tx.insert(collectionItems).values({
				collectionId: parsedBody.targetCollectionId,
				itemId: parsedBody.itemId,
				note: item.note,
			});

			await tx.delete(collectionItems).where(eq(collectionItems.id, item.id));
		});
	} catch (error) {
		if (error instanceof HTTPException) {
			throw error;
		}

		if (isLimitViolation(error)) {
			throw new HTTPException(400, { message: "Target collection is full" });
		}

		if (isUniqueViolation(error)) {
			throw new HTTPException(409, { message: "Item already exists in target collection" });
		}

		throw error;
	}

	return c.json({ success: true });
});

router.get("/", async (c) => {
	const userId = c.get("userId");

	const itemCountExpr = sql<number>`COALESCE(COUNT(${collectionItems.id}), 0)`.as("item_count");
	const relevanceExpr = sql<number>`
    COALESCE(
      SUM(
        CASE
          WHEN btrim(${collectionItems.note}) <> '' THEN 2
          ELSE 1
        END
      ),
      0
    )
  `.as("relevance_score");

	const results = await db
		.select({
			id: collections.id,
			name: collections.name,
			description: collections.description,
			createdAt: collections.createdAt,
			updatedAt: collections.updatedAt,
			itemCount: itemCountExpr,
			relevanceScore: relevanceExpr,
		})
		.from(collections)
		.leftJoin(collectionItems, eq(collections.id, collectionItems.collectionId))
		.where(eq(collections.userId, userId))
		.groupBy(
			collections.id,
			collections.name,
			collections.description,
			collections.createdAt,
			collections.updatedAt
		)
		.orderBy(desc(relevanceExpr), desc(collections.createdAt));

	return c.json(
		results.map((row) => ({
			...row,
			itemCount: Number(row.itemCount),
			relevanceScore: Number(row.relevanceScore),
		}))
	);
});

export { router as collectionsRouter };
