import { defineConfig } from "drizzle-kit";
// @ts-ignore - dotenv is a Node.js package, not available in Deno types
import dotenv from "dotenv";
import process from "node:process";

// Load environment variables from .env file
dotenv.config();

export default defineConfig({
  schema: "./src/persistence/drizzle/entity/index.ts",
  out: "./src/persistence/drizzle/migration",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
