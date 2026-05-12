// Pre-commit hook: check for forbidden cross-package relative path references
// Only catches patterns that reference old "opencode" directory in relative paths:
//   ../opencode, ../../opencode, etc.
// This is what caused P7 build failures in the v0.1.0 migration.
//
// Note: `.opencode/` and `opencode.jsonc` are the CURRENT config paths and are NOT flagged.

const FORBIDDEN = [
  { pattern: /["'`]\.\.+\/opencode\b/, desc: "relative path pointing to old 'opencode' directory (use 'octopus' instead)" },
//  { pattern: /@opencode-ai\//, desc: "npm scope @opencode-ai/" }, // handled by verify-rebrand.ts
];

const results: { file: string; line: number; match: string; desc: string }[] = [];

for await (const entry of new Bun.Glob("**/*.{ts,tsx,js,jsx,mjs,cjs}").scan({
  cwd: process.cwd(),
  absolute: true,
  dot: true,
  onlyFiles: true,
})) {
  if (entry.includes("node_modules") || entry.includes(".git/") || entry.includes(".turbo")) continue;
  if (entry.includes("/out/") || entry.includes("/dist/") || entry.includes("/build/")) continue;
  if (entry.endsWith("check-cross-package-refs.ts")) continue;

  const content = await Bun.file(entry).text();
  let lineNo = 0;
  for (const line of content.split("\n")) {
    lineNo++;
    for (const rule of FORBIDDEN) {
      const m = line.match(rule.pattern);
      if (m) {
        results.push({ file: entry, line: lineNo, match: m[0], desc: rule.desc });
      }
    }
  }
}

if (results.length > 0) {
  console.error(`\n❌ Found ${results.length} forbidden cross-package path reference(s):\n`);
  for (const r of results) {
    const short = r.file.replace(process.cwd() + "/", "");
    console.error(`  ${short}:${r.line}  ${r.desc}`);
    console.error(`    → ${r.match}\n`);
  }
  console.error("Commit blocked. Fix these references before committing.\n");
  process.exit(1);
}

console.log("✅ No forbidden cross-package path references found.");
