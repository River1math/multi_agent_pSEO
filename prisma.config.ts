import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile();
} catch {
  // no .env file; rely on the process environment
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" },
});
