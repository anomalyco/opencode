// Writes src/lib/github-snapshot.json (lib/github-snapshot.ts): the repo numbers and the newest 100
// releases as GitHub lists them at build time. A new Worker isolate renders from it when it has no
// cached value and GitHub doesn't answer within 300 ms, so no page waits on GitHub. Uses
// GITHUB_TOKEN when set. A failed call keeps that part of the previous snapshot (a rate limit must
// not empty it) and never fails the build.
import path from "node:path"
import { faces } from "../src/lib/contributor-faces"
import type { GithubSnapshot } from "../src/lib/github-snapshot"

const root = path.resolve(import.meta.dir, "..")
const api = "https://api.github.com/repos/anomalyco/opencode"
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "OpenCode-Console",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
}
const get = (url: string) =>
  fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
    .then((response) => (response.ok ? response : undefined))
    .catch(() => undefined)
const json = (url: string) => get(url).then((response) => response?.json().catch(() => undefined))

const faceIds = new Set(faces.map((face) => face.id))
const [meta, count, first, second, releases] = await Promise.all([
  json(api),
  get(`${api}/contributors?per_page=1&anon=1`),
  json(`${api}/contributors?per_page=100`),
  json(`${api}/contributors?per_page=100&page=2`),
  json(`${api}/releases?per_page=100`),
])
const last = count?.headers.get("Link")?.match(/[?&]page=(\d+)>; rel="last"/)?.[1]
const people: { id: unknown }[] = Array.isArray(first) ? [...first, ...(Array.isArray(second) ? second : [])] : []
const file = path.join(root, "src/lib/github-snapshot.json")
const previous: GithubSnapshot = await Bun.file(file)
  .json()
  .catch(() => ({}))
const snapshot = {
  time: new Date().toISOString(),
  repo: {
    stars: typeof meta?.stargazers_count === "number" ? meta.stargazers_count : previous.repo?.stars,
    contributors: last ? Number.parseInt(last) : previous.repo?.contributors,
    order: people.length
      ? people.map((person) => person.id).filter((id) => typeof id === "number" && faceIds.has(id))
      : previous.repo?.order,
  },
  releases: Array.isArray(releases)
    ? releases.map((release) => ({
        tag_name: release.tag_name,
        name: release.name,
        body: release.body,
        published_at: release.published_at,
        html_url: release.html_url,
      }))
    : previous.releases,
}
await Bun.write(file, JSON.stringify(snapshot) + "\n")
console.log(`github snapshot: ${snapshot.repo.stars ?? "no"} stars, ${snapshot.releases?.length ?? "no"} releases`)
