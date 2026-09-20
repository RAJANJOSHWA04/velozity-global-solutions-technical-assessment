import "dotenv/config";
import { z } from "zod";

const parsed = z.object({
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(24),
  JWT_REFRESH_SECRET: z.string().min(24),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  PORT: z.coerce.number().default(4000),
}).safeParse(process.env);
if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.message}`);
export const env = parsed.data;
