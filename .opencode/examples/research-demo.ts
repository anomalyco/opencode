// Realistic end-to-end use case: research a JS-rendered public demo site
// and print the organized structured finding. Run:
//   bun examples/research-demo.ts

import { researchPage } from "../lib/research-app"

const target = {
  url: "https://quotes.toscrape.com/js/",
  mode: "browser" as const,
  objective: "List each quote and its author",
}

const finding = await researchPage(target)

console.log("== REQUEST ==")
console.log(JSON.stringify(target, null, 2))

console.log("\n== ORGANIZED FINDING ==")
console.log(`title:      ${finding.title}`)
console.log(`finalUrl:   ${finding.finalUrl}`)
console.log(`httpStatus: ${finding.httpStatus} (ok=${finding.ok})`)
console.log(`fetchMode:  ${finding.fetchMode}`)
console.log(`objective:  ${finding.objective}`)
console.log(`headings:   ${finding.headings.length}`)
console.log(`paragraphs: ${finding.paragraphs.length}`)
console.log(`links:      ${finding.links.length} (first: ${finding.links[0]?.url})`)
console.log(`images:     ${finding.images.length}`)
console.log(`metadata.ogSiteName: ${finding.metadata.ogSiteName}`)
console.log(`crawlerError: ${finding.crawlerError}`)

const authors = [...finding.mainContent.matchAll(/by ([A-Z][^"]+?)(?: Tags|$)/g)].map(
  (m) => m[1].trim(),
)
console.log(`\n== ANSWER TO OBJECTIVE ==`)
for (const author of new Set(authors)) console.log(`- ${author}`)

console.log(`\nmainContent sample (Unicode preserved): ${finding.mainContent.slice(0, 120)}...`)
