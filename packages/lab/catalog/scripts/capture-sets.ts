import { basename, resolve } from "node:path"
import type { DriveCapture, DriveManifest, Variant } from "../catalog/schema"

export interface CaptureOptions {
  readonly opencode: string
  readonly revisions: ReadonlyArray<string>
  readonly themes: ReadonlyArray<string | undefined>
  readonly flow: string | undefined
  readonly fresh: boolean
  readonly jobs: number
  readonly workerOutput: string | undefined
}

export function parseCaptureOptions(args: ReadonlyArray<string>, defaultOpenCode: string): CaptureOptions {
  let opencode = defaultOpenCode
  const revisions: Array<string> = []
  const themes: Array<string | undefined> = []
  let flow: string | undefined
  let fresh = false
  let jobs = 3
  let workerOutput: string | undefined

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === "--fresh") {
      fresh = true
      continue
    }
    const value = args[++index]
    if (!value) throw new Error(`${argument} requires a value`)
    if (argument === "--opencode") opencode = value
    else if (argument === "--revision") revisions.push(value)
    else if (argument === "--theme") themes.push(value === "default" ? undefined : value)
    else if (argument === "--flow") flow = value
    else if (argument === "--jobs") jobs = Number(value)
    else if (argument === "--worker-output") workerOutput = resolve(value)
    else throw new Error(`Unknown capture argument: ${argument}`)
  }

  if (!Number.isInteger(jobs) || jobs < 1) throw new Error("--jobs must be a positive integer")

  return {
    opencode: resolve(opencode),
    revisions: revisions.length === 0 ? ["origin/v2"] : revisions,
    themes: themes.length === 0 ? [undefined] : themes,
    flow,
    fresh,
    jobs,
    workerOutput,
  }
}

export function captureSetId(revision: string, theme: string | undefined, includeRevision = false): string {
  const revisionId = revision.slice(0, 12).toLowerCase()
  if (theme === undefined) return revisionId
  return includeRevision ? `${revisionId}-${slug(theme)}` : slug(theme)
}

export function captureSetLabel(revision: string, theme: string | undefined): string {
  if (theme === undefined) return revision.slice(0, 7)
  if (theme === "opencode") return "Opencode"
  if (theme === "tokyonight") return "Tokyo Night"
  if (theme === "everforest") return "Everforest"
  return theme
}

export function captureMatrixManifest(
  variants: ReadonlyArray<Variant>,
  captures: ReadonlyArray<DriveCapture>,
): DriveManifest {
  return {
    format: "opencode-terminal-frame-captures-v1",
    generatedBy: "scripts/capture-opencode-drive.ts",
    variants: variants as [Variant, ...Array<Variant>],
    captures,
  }
}

export function captureSource(path: string): string {
  return basename(resolve(path))
}

function slug(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  if (result === "") throw new Error(`Theme ${JSON.stringify(value)} cannot form a set ID`)
  return result
}
