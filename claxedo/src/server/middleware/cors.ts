/**
 * CORS middleware configuration
 */
import { cors } from "hono/cors";
import { Config } from "../../config/index.ts";

export const corsMiddleware = () => {
  return cors({
    origin: (origin) => {
      // Dev: allow Vite + local testing origins.
      if (!origin) return origin;
      if (!Config.isProduction) return origin;

      // Prod: strict allowlist.
      const allowed = new Set<string>([
        "http://localhost:5173",
        "http://localhost:4444",
        "http://127.0.0.1:4444",
      ]);
      return allowed.has(origin) ? origin : null;
    },
    allowHeaders: ["Content-Type", "Authorization", "x-opencode-directory"],
    allowMethods: ["POST", "GET", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  });
};
