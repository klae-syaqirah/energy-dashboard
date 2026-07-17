import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

// Lazy init so `next build` succeeds without DATABASE_URL.
export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

export function getDb() {
  return drizzle(getSql());
}
