import fs from "fs/promises"
import path from "path"
import { PROVIDER_ID, gatewayUrl } from "./config"
import type { WhoAmI } from "./client"

/**
 * Writes the Opviera provider into the opened project's config after a key validates.
 *
 * The catalog has no "create a provider" hook — providers come from models.dev or from config — so
 * the provider is materialised here from the whoami payload. Two consequences worth keeping:
 *
 *  - The model list IS the policy. Models come from the gateway, so a model the key may not use
 *    never appears in the picker; there is nothing to keep in sync by hand.
 *  - `enabled_providers` is pinned to Opviera alone, which is what makes every other provider
 *    unreachable even if one is declared in a project's own config file.
 *
 * The API KEY IS DELIBERATELY NOT WRITTEN HERE. It lives in auth.json at 0600; this file is
 * ordinary config that a user may well paste into a support ticket.
 */

/**
 * Written into the DIRECTORY THE USER OPENED, not a global config dir, so each project carries its
 * own gateway settings and project id — open the CLI somewhere else and it provisions there.
 *
 * `opviera.json` is read because both config loaders now list it ahead of the upstream names.
 *
 * Safe to commit: it holds the gateway URL, project id and permitted model list, and deliberately
 * no credential (see below).
 */
function configPath(): string {
  return path.join(process.cwd(), "opviera.json")
}

interface ProviderModel {
  name: string
}

export async function provision(identity: WhoAmI, projectId: string | null): Promise<string> {
  const headers: Record<string, string> = {
    // Tags gateway usage as coming from this CLI. Kept as the value the platform already
    // recognises so usage attribution works without a server-side change.
    "x-clawgate-client": "opencode",
  }
  // A bound key carries its project server-side and projectCheck ignores the header entirely.
  if (projectId && !identity.boundProjectId) headers["x-project-id"] = projectId

  const models: Record<string, ProviderModel> = {}
  for (const model of identity.models) {
    models[model.id] = { name: model.displayName }
  }

  const existing = await read()
  const next = {
    ...existing,
    // Only Opviera. Declared here rather than left to chance: opencode treats an absent
    // enabled_providers as "allow everything".
    enabled_providers: [PROVIDER_ID],
    provider: {
      ...(existing["provider"] as Record<string, unknown> | undefined),
      [PROVIDER_ID]: {
        name: "Opviera",
        npm: "@ai-sdk/anthropic",
        // Lets the provider pick the key up from the environment in CI, where nothing is written
        // to auth.json. Interactive runs resolve it from auth.json under the same provider id.
        env: ["OPVIERA_API_KEY"],
        options: {
          // The Anthropic SDK appends the resource path, so this is the `/v1` root.
          baseURL: `${gatewayUrl()}/v1`,
          headers,
        },
        models,
      },
    },
  }

  const file = configPath()
  await fs.writeFile(file, JSON.stringify(next, null, 2) + "\n")
  return file
}

async function read(): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(), "utf8"))
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
