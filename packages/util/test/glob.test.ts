import { expect, test } from "bun:test"
import { Glob } from "../src/glob.js"

test("a compiled matcher agrees with match", () => {
  const paths = ["a.ts", "src/b.ts", ".hidden/c.ts", "src/.d.ts", "e.js", "#notes", "src/nested/f.tsx"]
  for (const pattern of ["**/*.ts", "*.{ts,js}", "src/**", ".*/*", "#notes", "**/*.ts?(x)", "!(*.ts)"])
    for (const dot of [undefined, true, false]) {
      const matches = Glob.matcher(pattern, { dot })
      expect(paths.map(matches)).toEqual(paths.map((path) => Glob.match(pattern, path, { dot })))
    }
})
