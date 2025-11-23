import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config();

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
