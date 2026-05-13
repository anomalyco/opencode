import type { Context } from "hono";
import { Project } from "@/project/project";
type R = Project.Info | Response;
/**
 * Resolves `project` row only — no filesystem cwd / “repo root”.
 *
 * - `?project=<id>` or `x-opencode-project: <id>`
 * - Else `?directory=<id>` (SDK / web UI: route `/:dir` is the project id and is sent as `directory`)
 * - Else first project for the tenant (Postgres).
 *
 * Invalid request URL: `new URL` throws. Empty `?project=` / `?directory=`, unknown id, or no tenant project: HTTP 400 via HTTPException (never silently pick the wrong project).
 */
export declare function resolveInstanceProject(c: Context): Promise<R>;
export {};
