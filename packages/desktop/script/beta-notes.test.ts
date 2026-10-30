import { afterAll, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { BetaNotes } from "./beta-notes"

test.each([
  [
    "feat(app): merge projects across servers in the location dialog",
    { type: "feat", scope: "app", summary: "merge projects across servers in the location dialog" },
  ],
  [
    "fix(desktop): disable animated wheel scrolling on linux (#57120)",
    { type: "fix", scope: "desktop", summary: "disable animated wheel scrolling on linux", pr: 57120 },
  ],
  ["perf: cache model list", { type: "perf", summary: "cache model list" }],
  [
    "Feat(core)!: drop legacy sessions",
    { type: "feat", scope: "core", summary: "drop legacy sessions", breaking: true },
  ],
  [
    "fix(app): keep (#1) in the middle of a summary",
    { type: "fix", scope: "app", summary: "keep (#1) in the middle of a summary" },
  ],
  ["chore(sdk): regenerate types", undefined],
  ["refactor(app): split dialog", undefined],
  ["docs: update guide", undefined],
  ["test(app): cover dialog", undefined],
  ["ci: cache bun", undefined],
  ["Merge branch 'dev' into beta", undefined],
  ["fix the thing without a type", undefined],
  ["fix(app): (#12)", undefined],
])("parses %p", (subject, expected) => {
  expect(BetaNotes.parseSubject(subject)).toEqual(expected)
})

const repos: string[] = []

afterAll(() => Promise.all(repos.map((dir) => rm(dir, { recursive: true, force: true }))))

async function repo(subjects: string[]) {
  const dir = await mkdtemp(path.join(tmpdir(), "beta-notes-"))
  repos.push(dir)

  await $`git init -q -b beta && git config user.email a@b.c && git config user.name Ada`.cwd(dir).quiet()

  // One fast-import writes every commit, where a commit per process is slow on Windows.
  const stream = subjects
    .map((subject, i) =>
      [
        "commit refs/heads/beta",
        `committer Ada <a@b.c> ${1_700_000_000 + i} +0000`,
        `data ${Buffer.byteLength(subject)}`,
        subject,
        "",
      ].join("\n"),
    )
    .join("")

  await $`git fast-import --quiet < ${new Response(stream)}`.cwd(dir).quiet()
  await $`git reset -q --hard beta`.cwd(dir).quiet()

  return { dir, shas: (await $`git rev-list --reverse HEAD`.cwd(dir).text()).trim().split("\n") }
}

test("embeds the build's commit, its history and the notes of its non-merge feat and fix commits", async () => {
  const git = await repo([
    "feat(app): old feature",
    "fix(app): first fix (#10)",
    "chore: bump",
    "feat(desktop): new dialog",
  ])

  await $`git checkout -q -b side HEAD~1 && git commit -q --allow-empty -m ${"fix(app): side fix"} && git checkout -q beta && git merge -q --no-ff side -m ${"fix(app): merge side"}`
    .cwd(git.dir)
    .quiet()

  const head = (await $`git rev-parse HEAD`.cwd(git.dir).text()).trim()
  const side = (await $`git rev-parse side`.cwd(git.dir).text()).trim()
  const short = (sha: string) => sha.slice(0, 12)
  const embedded = BetaNotes.embed({ head: "HEAD", cwd: git.dir })

  expect(embedded.sha).toBe(head)
  expect(embedded.commits).toHaveLength(6)
  expect(embedded.commits[0]).toBe(short(head))
  const author = { name: "Ada" }

  expect(embedded.notes).toEqual([
    { type: "fix", scope: "app", summary: "side fix", sha: short(side), author },
    { type: "feat", scope: "desktop", summary: "new dialog", sha: short(git.shas[3]!), author },
    { type: "fix", scope: "app", summary: "first fix", pr: 10, sha: short(git.shas[1]!), author },
    { type: "feat", scope: "app", summary: "old feature", sha: short(git.shas[0]!), author },
  ])
})

test("embeds at most the newest 200 commits", async () => {
  const git = await repo(Array.from({ length: 205 }, (_, i) => `fix(app): fix ${i}`))

  const embedded = BetaNotes.embed({ head: "HEAD", cwd: git.dir })

  expect(embedded.commits).toHaveLength(200)
  expect(embedded.notes[0]?.summary).toBe("fix 204")
  expect(embedded.notes.at(-1)?.summary).toBe("fix 5")
})

const TEMPLATE = `### Issue for this PR

Closes #1

### Type of change

- [x] Bug fix

### What does this PR do?

Keep the composer's last line visible. Shift+Enter now scrolls far enough to clear the [fade](https://example.com).
A third sentence is left out.

### How did you verify your code works?

Tests.`

test.each([
  [
    "the template's What does this PR do? section",
    TEMPLATE,
    "Keep the composer's last line visible. Shift+Enter now scrolls far enough to clear the fade.",
  ],
  [
    "a Summary list's first item",
    "## Summary\n- Restore the **standard** border (`composer.tsx`).\n- Keep the row.",
    "Restore the standard border.",
  ],
  [
    "the text before the first heading",
    "Home showed a loading state.\n\n### Changes\n\n- Cache the list.",
    "Home showed a loading state.",
  ],
  [
    "a Changes section when nothing comes first",
    "### Why\n\nIt was slow.\n\n### Changes\n\nThe list stays cached.",
    "The list stays cached.",
  ],
  [
    "nothing that introduces a code block",
    "### What does this PR do?\n\nThe query was:\n\n```sql\nSELECT 1\n```",
    undefined,
  ],
  ["nothing that repeats the subject", "Fix the thing.", undefined],
  [
    "past the template's filler lines",
    "**Issue for this PR:** N/A\nCloses #\nType of change: Bug fix\n- [x] Bug fix\n<!-- note -->\n\nThe dialog opens at the top.",
    "The dialog opens at the top.",
  ],
  [
    "the whole sentences that fit under the cap",
    `Short first sentence. ${"Long ".repeat(50)}second.`,
    "Short first sentence.",
  ],
  [
    "a long sentence cut at a word, with an ellipsis",
    `Unifies the card surface, ${"and more words ".repeat(20)}end.`,
    `Unifies the card surface, ${"and more words ".repeat(14).trim()}…`,
  ],
  ["nothing from an empty body", "", undefined],
])("describes %s", (_, body, expected) => {
  expect(BetaNotes.describe(body, "fix the thing")).toBe(expected)
})

const notes = (): ReturnType<typeof BetaNotes.embed> => ({
  sha: "a".repeat(40),
  commits: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"],
  notes: [
    { type: "fix", summary: "keep the last line visible", pr: 10, sha: "aaaaaaaaaaaa", author: { name: "Ada" } },
    { type: "feat", summary: "local change", sha: "bbbbbbbbbbbb", author: { name: "Ada" } },
  ],
})

test("adds each pull request's author and description from one GitHub query", async () => {
  const requests: RequestInit[] = []

  const enriched = await BetaNotes.enrich(notes(), {
    token: "token",
    fetch: async (_, init) => {
      requests.push(init)

      return Response.json({
        data: {
          repository: {
            pr10: {
              number: 10,
              body: TEMPLATE,
              author: {
                login: "ada",
                name: "Ada Lovelace",
                avatarUrl: "https://avatars.githubusercontent.com/u/1?s=48",
              },
            },
          },
        },
      })
    },
  })

  expect(requests).toHaveLength(1)
  expect(enriched.notes).toEqual([
    {
      ...notes().notes[0]!,
      author: { name: "Ada Lovelace", login: "ada", avatar: "https://avatars.githubusercontent.com/u/1?s=48" },
      description: "Keep the composer's last line visible. Shift+Enter now scrolls far enough to clear the fade.",
    },
    notes().notes[1],
  ])
})

test("keeps only GitHub's public avatars, and the login when there is no name", async () => {
  const enriched = await BetaNotes.enrich(notes(), {
    token: "token",
    fetch: async () =>
      Response.json({
        data: {
          repository: {
            pr10: { number: 10, body: "", author: { login: "bot", avatarUrl: "http://example.com/a.png" } },
          },
        },
      }),
  })

  expect(enriched.notes[0]?.author).toEqual({ name: "bot", login: "bot" })
})

test.each([
  ["no token", undefined, async () => Response.json({})],
  ["a failed request", "token", async () => new Response("rate limited", { status: 403 })],
  ["a network error", "token", async () => Promise.reject(new Error("offline"))],
  ["an unexpected response", "token", async () => Response.json({ errors: [{ message: "bad" }] })],
])("keeps the commit authors and subjects with %s", async (_, token, request) => {
  expect(await BetaNotes.enrich(notes(), { token, fetch: request })).toEqual(notes())
})

const SVG = `<svg viewBox="0 0 240 72"><rect width="40" height="8" fill="currentColor"><animate attributeName="width" values="40;80;40" dur="3s" repeatCount="indefinite"/></rect></svg>`

const withVisual = (svg: string) =>
  `### What does this PR do?\n\nIt grows.\n\n### Visual\n\n\`\`\`svg\n${svg}\n\`\`\`\n\n### Checklist`

test("rebuilds a visual with its namespace, and a still without its animation", () => {
  expect(BetaNotes.visual(withVisual(SVG))).toEqual({
    animated: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 72"><rect width="40" height="8" fill="currentColor"><animate attributeName="width" values="40;80;40" dur="3s" repeatCount="indefinite"/></rect></svg>`,
    still: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 72"><rect width="40" height="8" fill="currentColor"/></svg>`,
  })
})

test("drops scripts, foreign objects, images, handlers, outside links and SMIL that animates a link", () => {
  const rebuilt = BetaNotes.visual(
    withVisual(
      `<svg onload="alert(1)"><!-- note --><script>alert(1)</script><foreignObject><div/></foreignObject><image href="https://example.com/a.png"/><use xlink:href="https://example.com/a.svg#x"/><use xlink:href="#x"/><rect onclick="x()"/><animate attributeName="href" values="https://example.com"/><set attributeName="xlink:href" to="https://example.com"/></svg>`,
    ),
  )

  expect(rebuilt?.animated).toBe(`<svg xmlns="http://www.w3.org/2000/svg"><use/><use href="#x"/><rect/></svg>`)
})

test("drops a still's keyframes and animations, even important or inline ones", () => {
  const rebuilt = BetaNotes.visual(
    withVisual(
      `<svg><style><![CDATA[.a{fill:red;animation:spin 1s infinite!important}@keyframes spin{from{opacity:0}to{opacity:1}}@media (min-width:1px){.b{transition:opacity 1s}}]]></style><rect class="a" style="animation: spin 1s !important; stroke: blue"/></svg>`,
    ),
  )

  expect(rebuilt?.still).toBe(
    `<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:red}@media (min-width:1px){.b{}}</style><rect class="a" style="stroke: blue"/></svg>`,
  )
  expect(rebuilt?.animated).toContain("@keyframes spin")
})

test.each([
  ["no Visual section", "### What does this PR do?\n\n```svg\n<svg></svg>\n```"],
  ["a root that is not an svg", withVisual("<div><svg></svg></div>")],
  ["more than one svg root", withVisual("<svg></svg><svg></svg>")],
  ["a doctype", withVisual('<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>')],
  ["an @import", withVisual('<svg><style>@import "https://example.com/a.css";</style></svg>')],
  ["a CSS-escaped @import", withVisual('<svg><style>@\\69mport "https://example.com/a.css";</style></svg>')],
  ["a CSS-escaped url()", withVisual('<svg><rect style="fill:u\\72l(https://example.com/p)"/></svg>')],
  ["an outside url() in an attribute", withVisual('<svg><rect fill="url(https://example.com/p)"/></svg>')],
  [
    "an outside url() in an animation",
    withVisual('<svg><animate attributeName="fill" to="url(https://example.com/p)"/></svg>'),
  ],
  ["an entity-encoded url()", withVisual('<svg><rect fill="&#117;rl(https://example.com/p)"/></svg>')],
  ["more than 8 KB", withVisual(`<svg>${'<rect width="1"/>'.repeat(600)}</svg>`)],
])("refuses a visual with %s", (_, body) => {
  expect(BetaNotes.visual(body)).toBeUndefined()
})

test("keeps the visual's code out of the description", () => {
  expect(BetaNotes.describe(`\`\`\`svg\n${SVG}\n\`\`\`\n\nIt grows.`, "grow")).toBe("It grows.")
})
