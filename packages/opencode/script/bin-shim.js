#!/usr/bin/env node
// Inspired by esbuild's node-shim.ts
// https://github.com/evanw/esbuild/blob/v0.28.1/lib/npm/node-shim.ts
const { spawnSync } = require("child_process");
const path = require("path");
const os = require("os");

const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" };
const archMap = { x64: "x64", arm64: "arm64" };
const platform = platformMap[os.platform()] ?? os.platform();
const arch = archMap[os.arch()] ?? os.arch();
const name = `opencode-${platform}-${arch}`;
const binary = platform === "windows" ? "opencode.exe" : "opencode";

let binaryPath;
try {
  binaryPath = path.join(path.dirname(require.resolve(`${name}/package.json`)), "bin", binary);
} catch {
  binaryPath = path.join(__dirname, binary);
}

const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);
