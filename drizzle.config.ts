import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.local first (Next.js convention), then .env as fallback.
config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
