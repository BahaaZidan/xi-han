import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { collectionsRouter } from "./routes/collections";
import type { AppBindings } from "./types";

const app = new Hono<AppBindings>();

app.use("*", async (c, next) => {
	const userId = c.req.header("X-User-ID");
	if (!userId) {
		return c.json({ error: "Missing X-User-ID header" }, 401);
	}

	c.set("userId", userId);
	await next();
});

app.route("/collections", collectionsRouter);

app.notFound((c) => c.json({ error: "Not Found" }, 404));

app.onError((err, c) => {
	if (err instanceof HTTPException) {
		return c.json({ error: err.message || "Request failed" }, err.status);
	}

	console.error(err);
	return c.json({ error: "Internal Server Error" }, 500);
});

export { app };
