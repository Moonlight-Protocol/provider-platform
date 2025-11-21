import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/persistence/drizzle/entity/index.ts",
  out: "./src/persistence/drizzle/migration",
  dialect: "postgresql",
  dbCredentials: {
    url: Deno.env.get("DATABASE_URL") ?? "",
  },
});
