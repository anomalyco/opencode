import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const electron = require("electron");

const TIMEOUT_MS = 90_000;

console.log(`launching electron (${path.basename(String(electron))}) in smoke mode…`);

const child = spawn(String(electron), [".", "--smoke"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let output = "";
let settled = false;
const timer = setTimeout(() => {
  if (settled) return;
  settled = true;
  console.error(`SMOKE_FAIL timed out after ${TIMEOUT_MS}ms`);
  console.error(output);
  child.kill();
  process.exit(1);
}, TIMEOUT_MS);

child.stdout.on("data", (d) => {
  const text = d.toString();
  output += text;
  process.stdout.write(text);
});

child.stderr.on("data", (d) => {
  const text = d.toString();
  output += text;
  process.stderr.write(text);
});

child.on("exit", (code) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  const ok = code === 0 && output.includes("SMOKE_OK");
  if (ok) {
    console.log("SMOKE_PASS window created and renderer loaded");
    process.exit(0);
  }
  console.error(`SMOKE_FAIL exit=${code}`);
  process.exit(1);
});
