#!/usr/bin/env bun
// Focus rings read the mark the app keeps on the focused element during keyboard navigation: `[data-focus-visible]`
// in CSS, or Tailwind's `focus-visible:` variant, which the app redefines to it. Chromium's own `:focus-visible` also
// matches after any typed key, for every text field, and for focus a script moves once a key was pressed, so a rule on
// it shows rings at random. Fails when app code uses it. See .opencode/skills/focus-states. Usage:
//   bun script/check-focus-rings.ts
import path from "node:path"

const ROOTS = [
  "packages/app/src",
  "packages/ui/src",
  "packages/session-ui/src",
  "packages/gui-plugins/src",
  "packages/desktop/src/renderer",
]

const EXCEPTIONS: [RegExp, string][] = [
  [/^packages\/ui\/src\/styles\/base\.css$/, "Removes the browser's own ring"],
  [/^packages\/ui\/src\/styles\/tailwind\/index\.css$/, "Redefines the focus-visible variant"],
  [/^packages\/ui\/src\/context\/keyboard-mode\.tsx$/, "Explains why the app does not use it"],
  [/^packages\/app\/src\/components-lab\//, "Review stories that describe the browser's behaviour"],
  [
    /^packages\/ui\/src\/context\/(dialog|field-focus)\.tsx$/,
    "Ring bookkeeping that no longer affects what shows: to remove with it",
  ],
]

const repo = path.resolve(import.meta.dir, "..")

const files = (
  await Promise.all(ROOTS.map((root) => Array.fromAsync(new Bun.Glob(`${root}/**/*.{css,ts,tsx}`).scan({ cwd: repo }))))
)
  .flat()
  .map((file) => file.replaceAll("\\", "/"))
  .filter((file) => !/\.test\.tsx?$/.test(file) && !EXCEPTIONS.some(([re]) => re.test(file)))

const problems = (
  await Promise.all(
    files.map(async (file) =>
      (await Bun.file(path.join(repo, file)).text())
        .split("\n")
        .flatMap((text, index) =>
          text.includes(":focus-visible") ? [`${file}:${index + 1}  ${text.trim().slice(0, 140)}`] : [],
        ),
    ),
  )
).flat()

for (const problem of problems) console.error(problem)

if (problems.length) {
  console.error(
    `\n${problems.length} use${problems.length === 1 ? "" : "s"} of :focus-visible. Style focus on [data-focus-visible], or with Tailwind's focus-visible: variant.`,
  )
  process.exit(1)
}
