// Builds a contact sheet of the top contributors' avatars, for reviewing which ones are photos of a
// human face (src/lib/contributor-faces.ts).
//
//   bun script/contributor-faces.ts [out.html]
//
// Open the HTML file, and for each avatar that is clearly a photo of a person's face add its login,
// id and commit count (the caption's "id · commits") to the allowlist; refresh the counts of the
// entries already there, as they order the wall when GitHub doesn't answer. Avatars already on the allowlist are outlined, so a refresh only needs a
// look at the new ones (and at allowlisted ones whose picture changed).
import { faces } from "../src/lib/contributor-faces"

const repo = "anomalyco/opencode"
const out = Bun.argv[2] ?? `${process.env.TMPDIR ?? "/tmp"}/contributor-faces.html`
const allowed = new Set(faces.map((face) => face.login))

type Contributor = { login: string; id: number; type: string; avatar_url: string; contributions: number }

const pages = await Promise.all(
  [1, 2].map((page) =>
    fetch(`https://api.github.com/repos/${repo}/contributors?per_page=100&page=${page}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "OpenCode-Console" },
    }).then((response) => {
      if (!response.ok) throw new Error(`GitHub answered ${response.status} for page ${page}`)
      return response.json() as Promise<Contributor[]>
    }),
  ),
)
const people = pages.flat().filter((person) => person.type === "User")

const cells = people
  .map(
    (person, index) => `<figure class="${allowed.has(person.login) ? "allowed" : ""}">
  <img src="${person.avatar_url}&s=128" width="96" height="96" loading="eager" alt="">
  <figcaption>${index + 1}. ${person.login}<br>${person.id} · ${person.contributions}</figcaption>
</figure>`,
  )
  .join("\n")

await Bun.write(
  out,
  `<!doctype html><meta charset="utf-8"><title>Contributor faces</title>
<style>
  body { font: 11px/1.3 ui-monospace, monospace; margin: 16px; background: #fff; }
  main { display: grid; grid-template-columns: repeat(10, 104px); gap: 12px 8px; }
  figure { margin: 0; padding: 4px; }
  figure.allowed { outline: 2px solid #2b6cff; }
  img { display: block; width: 96px; height: 96px; background: #eee; }
  figcaption { margin-top: 4px; overflow-wrap: anywhere; }
</style>
<p>${people.length} contributors (users only, by commits). Outlined: on the allowlist (${allowed.size}).</p>
<main>${cells}</main>`,
)
console.log(`${people.length} avatars → ${out}`)
