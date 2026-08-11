import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { gatewayUrl, looksLikeApiKey } from "./config"
import { whoami, GatewayError, type WhoAmI } from "./client"
import * as Credential from "./credential"
import { provision } from "./provision"

/**
 * The startup gate. Opviera is a single-platform CLI: there is no agent to enter until a gateway
 * key has been accepted, so this runs before the TUI worker is spawned, in the main thread, while
 * a real TTY is still attached.
 *
 * Returns the validated credential plus the whoami payload, which the caller uses to build the
 * model catalog — so the models offered are exactly the ones the key's policy permits.
 */
export interface Session {
  credential: Credential.Credential
  identity: WhoAmI
}

/** Ctrl-C at any prompt. */
function cancelled(): never {
  prompts.cancel("Sign-in cancelled.")
  process.exit(1)
}

function describe(identity: WhoAmI, projectName: string | null): string {
  const org = identity.organization.name ?? "your organization"
  const who = identity.user.name ? `${identity.user.name} · ` : ""
  return projectName ? `${who}${org} · ${projectName}` : `${who}${org}`
}

export async function ensureAuthenticated(): Promise<Session> {
  // Non-interactive hatch for CI and containers. Validated exactly like a typed key — it is a
  // different way to supply the credential, not a way to skip the check.
  const envKey = process.env["OPVIERA_API_KEY"]?.trim()
  if (envKey) {
    const identity = await validateOrExit(envKey)
    const project = resolveProject(identity, process.env["OPVIERA_PROJECT_ID"]?.trim() ?? "")
    if (!project && identity.projectRequired) {
      UI.error("OPVIERA_PROJECT_ID is required for this API key. Set it to one of: " + projectList(identity))
      process.exit(1)
    }
    const credential = {
      key: envKey,
      projectId: project?.identifier ?? null,
      projectName: project?.name ?? null,
      gatewayUrl: gatewayUrl(),
    }
    await provision(identity, credential.projectId)
    return { credential, identity }
  }

  const stored = await Credential.read()
  if (stored) {
    const identity = await revalidate(stored.key)
    if (identity) {
      // Re-provisioned on every start so a policy change (models added or revoked) takes effect
      // without the user having to sign in again.
      await provision(identity, stored.projectId)
      return { credential: stored, identity }
    }
    // A stored key that no longer works falls through to the prompts below rather than failing —
    // rotating a key should not require finding the credential file.
  }

  if (!process.stdin.isTTY) {
    UI.error("Opviera needs an API key. Set OPVIERA_API_KEY, or run `opviera` in a terminal to sign in.")
    process.exit(1)
  }

  UI.logo()
  prompts.intro("Sign in to Opviera")

  const typedProject = await prompts.text({
    message: "Project name",
    placeholder: "the project this work belongs to",
  })
  if (prompts.isCancel(typedProject)) cancelled()

  let identity: WhoAmI | undefined
  let key = ""
  // Only the key is re-prompted on failure: the project name was fine, and re-typing it after a
  // mistyped key is busywork.
  while (!identity) {
    const entered = await prompts.password({
      message: "API key",
      validate: (value) =>
        looksLikeApiKey(value ?? "") ? undefined : "That does not look like an Opviera key (expected vsk_…).",
    })
    if (prompts.isCancel(entered)) cancelled()
    key = entered.trim()

    const spin = prompts.spinner()
    spin.start("Validating")
    try {
      identity = await whoami(key)
      spin.stop("Key accepted")
    } catch (error) {
      const failure = error instanceof GatewayError ? error : undefined
      spin.stop(failure?.message ?? "Validation failed", 1)
      if (!failure?.retryable) {
        if (failure?.requestId) prompts.log.info(`Request id: ${failure.requestId}`)
        process.exit(1)
      }
    }
  }

  const project = resolveProject(identity, typedProject)
  const chosen = project ?? (await chooseProject(identity, typedProject))

  if (identity.boundProjectId) {
    prompts.log.info(`This key is bound to "${chosen?.name ?? identity.boundProjectId}" — using it.`)
  }

  const credential: Credential.Credential = {
    key,
    projectId: chosen?.identifier ?? null,
    projectName: chosen?.name ?? null,
    gatewayUrl: gatewayUrl(),
  }
  await Credential.write(credential)
  await provision(identity, credential.projectId)

  prompts.outro(describe(identity, credential.projectName))
  return { credential, identity }
}

/**
 * Match what the user typed against the projects the key may actually use.
 *
 * A project's identity on the gateway is its slug `identifier` ("Acme Web" → `acme-web`), which a
 * user has no reason to know — so either the name or the identifier is accepted, case-insensitively.
 */
export function resolveProject(identity: WhoAmI, typed: string): { identifier: string; name: string } | undefined {
  // A bound key decides server-side; whatever was typed is irrelevant.
  if (identity.boundProjectId) {
    const known = identity.projects.find((p) => p.identifier === identity.boundProjectId)
    return known ?? { identifier: identity.boundProjectId, name: identity.boundProjectId }
  }
  const needle = typed.trim().toLowerCase()
  if (!needle) return undefined
  return identity.projects.find(
    (p) => p.identifier.toLowerCase() === needle || p.name.trim().toLowerCase() === needle,
  )
}

/** No match: show the real list rather than rejecting what the user typed. */
async function chooseProject(
  identity: WhoAmI,
  typed: string,
): Promise<{ identifier: string; name: string } | undefined> {
  if (identity.projects.length === 0) {
    if (identity.projectRequired) {
      UI.error("This API key requires a project, but none are available to it. Contact your administrator.")
      process.exit(1)
    }
    return undefined
  }

  if (typed.trim()) prompts.log.warn(`No project named "${typed.trim()}".`)

  const options = identity.projects.map((p) => ({ value: p.identifier, label: p.name, hint: p.identifier }))
  const picked = await prompts.select({
    message: identity.projectRequired ? "Choose your project" : "Choose your project (optional)",
    options: identity.projectRequired ? options : [...options, { value: "", label: "None", hint: "skip" }],
  })
  if (prompts.isCancel(picked)) cancelled()
  return identity.projects.find((p) => p.identifier === picked)
}

function projectList(identity: WhoAmI): string {
  return identity.projects.map((p) => p.identifier).join(", ") || "(none available)"
}

async function validateOrExit(key: string): Promise<WhoAmI> {
  return await whoami(key).catch((error: unknown) => {
    UI.error(error instanceof Error ? error.message : "Could not validate the Opviera API key.")
    return process.exit(1)
  })
}

/** Stored-credential check: a hard failure exits, a bad key returns undefined so we re-prompt. */
async function revalidate(key: string): Promise<WhoAmI | undefined> {
  try {
    return await whoami(key)
  } catch (error) {
    if (error instanceof GatewayError && !error.retryable) {
      UI.error(error.message)
      process.exit(1)
    }
    return undefined
  }
}
