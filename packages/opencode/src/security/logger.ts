import path from "path"
import { Filesystem } from "@/util/filesystem"
import { verificationSummary } from "./verification"
import type { RetrievedControl, SecurityMode, SecurityVerification } from "./schema"

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function safe(input: string) {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_")
}

export async function writeRun(input: {
  base: string
  mode: SecurityMode
  file: string
  fileText: string
  prompt: string
  controls: RetrievedControl[]
  report: string
  verification: SecurityVerification
  metadata: Record<string, unknown>
}) {
  const id = `${stamp()}_${input.mode}_${safe(path.basename(input.file))}`
  const dir = path.resolve(input.base, id)
  await Filesystem.write(path.join(dir, "input.txt"), input.fileText)
  await Filesystem.writeJson(path.join(dir, "retrieved_controls.json"), input.controls)
  await Filesystem.write(path.join(dir, "report.md"), input.report)
  await Filesystem.writeJson(path.join(dir, "verification.json"), input.verification)
  await Filesystem.write(path.join(dir, "verification_summary.txt"), verificationSummary(input.verification))
  await Filesystem.writeJson(path.join(dir, "metadata.json"), {
    ...input.metadata,
    mode: input.mode,
    input_file: input.file,
    prompt: input.prompt,
  })
  await Filesystem.writeJson(path.join(dir, "manual_score.json"), {
    finding_correctness: null,
    control_relevance: null,
    recommendation_usefulness: null,
    notes: "",
  })
  const manifest = path.join(path.resolve(input.base), "manifest.jsonl")
  const next =
    (await Filesystem.readText(manifest).catch(() => "")) +
    JSON.stringify({
      timestamp: new Date().toISOString(),
      mode: input.mode,
      input_file: input.file,
      run_dir: dir,
    }) +
    "\n"
  await Filesystem.write(manifest, next)
  return dir
}
