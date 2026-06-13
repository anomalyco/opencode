#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DRIZZLE_ROOT = path.join(
  __dirname,
  "..",
  "node_modules",
  ".bun",
  "drizzle-orm@1.0.0-rc.2+2b300c725bdd511c",
  "node_modules",
  "drizzle-orm",
);

const METHODS = `
  get(placeholderValues) {
    return this._prepare().execute(placeholderValues).pipe(
      Effect.map((rows) => Array.isArray(rows) ? rows[0] : rows),
    );
  }
  all(placeholderValues) {
    return this._prepare().execute(placeholderValues);
  }
  run(placeholderValues) {
    return this._prepare().execute(placeholderValues);
  }
  values(placeholderValues) {
    return this._prepare().execute(placeholderValues);
  }
`;

const patches = [
  { file: "pg-core/effect/select.js", regex: /execute\s*=\s*\(placeholderValues\)\s*=>\s*\{[\s\S]*?\};/ },
  { file: "pg-core/effect/insert.js", regex: /execute\s*=\s*\(placeholderValues\)\s*=>\s*\{[\s\S]*?\};/ },
  { file: "pg-core/effect/update.js", regex: /execute\s*=\s*\(placeholderValues\s*=\s*{}\)\s*=>\s*\{[\s\S]*?\};/ },
  { file: "pg-core/effect/delete.js", regex: /execute\s*=\s*\(placeholderValues\)\s*=>\s*\{[\s\S]*?\};/ },
  { file: "pg-core/effect/query.js", regex: /execute\s*\(placeholderValues\)\s*\{[\s\S]*?\}/ },
];

let patched = 0;

for (const patch of patches) {
  const filePath = path.join(DRIZZLE_ROOT, patch.file);
  if (!fs.existsSync(filePath)) {
    console.error(`SKIP ${patch.file}: file not found`);
    continue;
  }

  let content = fs.readFileSync(filePath, "utf8");

  if (content.includes("get(placeholderValues)")) {
    console.log(`SKIP ${patch.file}: already patched`);
    continue;
  }

  // Check if we need Effect import
  if (!content.includes('import * as Effect from "effect/Effect"') && !content.includes('import { Effect }')) {
    content = 'import * as Effect from "effect/Effect";\n' + content;
  }

  // Find the execute method and insert our methods after it
  const match = content.match(patch.regex);
  if (!match) {
    console.error(`FAIL ${patch.file}: execute method not found`);
    console.log("Content preview:", content.slice(0, 500));
    continue;
  }

  const insertAt = match.index + match[0].length;
  const methods = METHODS.trim();

  content = content.slice(0, insertAt) + "\n  " + methods + "\n" + content.slice(insertAt);

  fs.writeFileSync(filePath, content, "utf8");
  console.log(`PATCHED ${patch.file} (matched: ${match[0].slice(0, 60)}...)`);
  patched++;
}

console.log(`\nDone: ${patched}/${patches.length} files patched`);
