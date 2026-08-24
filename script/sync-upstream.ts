#!/usr/bin/env bun

import fs from "fs";
import path from "path";
import { parseArgs } from "util";

const root = path.resolve(import.meta.dir, "..");
const today = new Date().toISOString().slice(0, 10);
const stamp = today.replaceAll("-", "");

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		apply: { type: "boolean", default: false },
		push: { type: "boolean", default: false },
		fetch: { type: "boolean", default: true },
		branch: { type: "string", default: `sync/upstream-${stamp}` },
		worktree: {
			type: "string",
			default: path.resolve(root, "..", `${path.basename(root)}-sync-${stamp}`),
		},
		base: { type: "string", default: "origin/dev" },
		upstream: { type: "string", default: "upstream/dev" },
		help: { type: "boolean", short: "h", default: false },
	},
});

if (values.help) {
	console.log(`
Usage: bun script/sync-upstream.ts [options]

Prepares a clean upstream sync branch in a dedicated worktree.
Dry-run by default; pass --apply to perform the work.

Options:
      --apply             Create the worktree branch and merge upstream into it
      --push              Push the sync branch to origin after a successful merge
      --fetch             Fetch origin and upstream first (default: true)
      --branch <name>     Branch to create (default: sync/upstream-${stamp})
      --worktree <path>   Worktree path to create
      --base <ref>        Base ref for the sync branch (default: origin/dev)
      --upstream <ref>    Upstream ref to merge in (default: upstream/dev)
  -h, --help              Show this help message

Examples:
  bun script/sync-upstream.ts
  bun script/sync-upstream.ts --apply
  bun script/sync-upstream.ts --apply --push --branch sync/upstream-${stamp}
`);
	process.exit(0);
}

await ensureGitRoot();

const plan = [
	values.fetch ? `git fetch origin --prune` : undefined,
	values.fetch ? `git fetch upstream --prune` : undefined,
	`git worktree add -b ${quote(values.branch)} ${quote(values.worktree)} ${quote(values.base)}`,
	`git -C ${quote(values.worktree)} merge --no-ff ${quote(values.upstream)}`,
	values.push
		? `git -C ${quote(values.worktree)} push -u origin ${quote(values.branch)}`
		: undefined,
].filter(Boolean);

console.log(`Sync branch: ${values.branch}`);
console.log(`Worktree: ${values.worktree}`);
console.log(`Base ref: ${values.base}`);
console.log(`Upstream ref: ${values.upstream}`);
console.log(`\nPlan:`);
for (const step of plan) console.log(`  ${step}`);

if (!values.apply) {
	console.log(`\nDry run only. Re-run with --apply to execute.`);
	process.exit(0);
}

if (fs.existsSync(values.worktree)) {
	throw new Error(`Worktree path already exists: ${values.worktree}`);
}

if (await hasRef(values.branch)) {
	throw new Error(`Branch already exists: ${values.branch}`);
}

if (values.fetch) {
	await run(["git", "fetch", "origin", "--prune"], root);
	await run(["git", "fetch", "upstream", "--prune"], root);
}

await run(
	["git", "worktree", "add", "-b", values.branch, values.worktree, values.base],
	root,
);
await run(["git", "merge", "--no-ff", values.upstream], values.worktree);

if (values.push) {
	await run(["git", "push", "-u", "origin", values.branch], values.worktree);
}

console.log(`\nCreated sync worktree at ${values.worktree}`);
console.log(`Next steps:`);
console.log(`  1. cd ${values.worktree}`);
console.log(`  2. Run the narrow validation commands for the merge`);
console.log(`  3. Merge ${values.branch} back into dev once satisfied`);
console.log(`  4. Tag the resulting dev commit before porting into skein`);

async function ensureGitRoot() {
	const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = (await new Response(proc.stdout).text()).trim();
	const err = (await new Response(proc.stderr).text()).trim();
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(err || "Failed to determine git root");
	}
	if (path.resolve(out) !== root) {
		throw new Error(`Run this script from ${root}, got ${out}`);
	}
}

async function hasRef(ref: string) {
	const proc = Bun.spawn(["git", "show-ref", "--verify", `refs/heads/${ref}`], {
		cwd: root,
		stdout: "ignore",
		stderr: "ignore",
	});
	return (await proc.exited) === 0;
}

async function run(cmd: string[], cwd: string) {
	const proc = Bun.spawn(cmd, {
		cwd,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`Command failed (${code}): ${cmd.join(" ")}`);
	}
}

function quote(value: string) {
	return JSON.stringify(value);
}
