/**
 * Centralized environment configuration with validation
 */
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });

export const Config = {
  // Server
  PORT: Number.parseInt(process.env.PORT || "3000", 10),
  HOST: process.env.HOST || "127.0.0.1",
  NODE_ENV: process.env.NODE_ENV || "development",

  // Convex
  CONVEX_URL: process.env.CONVEX_URL,

  // Daytona
  DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
  DAYTONA_API_URL: process.env.DAYTONA_API_URL,
  DAYTONA_TARGET: process.env.DAYTONA_TARGET,
  DAYTONA_SIGNED_PREVIEW_TTL_SEC: Number.parseInt(
    process.env.DAYTONA_SIGNED_PREVIEW_TTL_SEC || "86400",
    10
  ),

  // Security
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || "default-key",

  // Auth
  AUTH_ENABLED: process.env.AUTH_ENABLED !== "false",

  // Sandbox / Cloud mode
  SANDBOX_ENABLED: (process.env.SANDBOX_ENABLED ?? process.env.VITE_SANDBOX_ENABLED) !== "false",

  // Clerk (secret key for JWT verification)
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,

  // OpenCode
  // USE_RIVET_SANDBOX_AGENT_SERVER: when true, auto-spawn sandbox-agent for opencode on startup
  // When false, proxy directly to local OpenCode server at OPENCODE_PORT
  USE_RIVET_SANDBOX_AGENT_SERVER: process.env.USE_RIVET_SANDBOX_AGENT_SERVER === "true",
  OPENCODE_PORT: Number.parseInt(process.env.OPENCODE_PORT || "4096", 10),
  OPENCODE_URL: process.env.OPENCODE_URL || `http://127.0.0.1:${process.env.OPENCODE_PORT || "4096"}`,
  OPENCODE_MODELS_URL: process.env.OPENCODE_MODELS_URL || "https://models.dev",
  OPENCODE_DEBUG_WS_PROXY: process.env.OPENCODE_DEBUG_WS_PROXY === "1",

  // Gateway
  CLAXEDO_GATEWAY_URL: process.env.CLAXEDO_GATEWAY_URL,

  // Derived
  get gatewayBaseUrl() {
    return (this.CLAXEDO_GATEWAY_URL || `http://${this.HOST}:${this.PORT}`).replace(/\/+$/, "");
  },

  get isProduction() {
    return this.NODE_ENV === "production";
  },
} as const;

export function requireConvexUrl(): string {
  if (!Config.CONVEX_URL) {
    throw new Error("Missing CONVEX_URL environment variable");
  }
  return Config.CONVEX_URL;
}
