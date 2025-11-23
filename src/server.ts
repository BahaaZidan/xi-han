import { config } from "dotenv";

import { app } from "./app";

config();

const port = 3000;

console.log(`Collections API listening on http://localhost:${port}`);

Bun.serve({
	port,
	fetch: app.fetch,
});
