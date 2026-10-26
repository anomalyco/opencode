#!/usr/bin/env bun

// Waits until another job of this workflow run uploads an artifact, so a job can do its other work while that job
// runs. Fails as soon as the producing job ends without the artifact.
// Usage: bun script/wait-for-artifact.ts <artifact name> <producing job name>

const [artifact, producer] = process.argv.slice(2)

if (!artifact || !producer) throw new Error("Usage: bun script/wait-for-artifact.ts <artifact> <job>")

const token = process.env.GITHUB_TOKEN

if (!token) throw new Error("GITHUB_TOKEN is required")

const run = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
const started = Date.now()

while (Date.now() - started < 30 * 60_000) {
  if (await uploaded()) {
    console.log(`${artifact} is ready after ${Math.round((Date.now() - started) / 1000)}s`)
    process.exit(0)
  }

  const conclusion = await producerConclusion()

  if (conclusion && conclusion !== "success") throw new Error(`${producer} finished with ${conclusion}`)
  // A job can finish just before its artifact appears in the listing.
  if (conclusion === "success" && (await uploaded())) process.exit(0)
  if (conclusion === "success") throw new Error(`${producer} succeeded without uploading ${artifact}`)

  await Bun.sleep(5_000)
}

throw new Error(`Timed out waiting for ${artifact}`)

async function uploaded() {
  const body = await get(`${run}/artifacts?name=${encodeURIComponent(artifact)}`)

  return isRecord(body) && typeof body.total_count === "number" && body.total_count > 0
}

async function producerConclusion() {
  const body = await get(`${run}/attempts/${process.env.GITHUB_RUN_ATTEMPT ?? "1"}/jobs?per_page=100`)
  const jobs = isRecord(body) && Array.isArray(body.jobs) ? body.jobs : []
  const job = jobs.find((item) => isRecord(item) && item.name === producer)

  if (!isRecord(job) || job.status !== "completed") return undefined

  return typeof job.conclusion === "string" ? job.conclusion : "unknown"
}

async function get(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  })

  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${url}`)

  return response.json()
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
