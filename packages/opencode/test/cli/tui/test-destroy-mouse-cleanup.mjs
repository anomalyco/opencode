/**
 * Test: Verify that cleanupBeforeDestroy() disables mouse tracking before
 * disabling raw mode. Without the fix, setRawMode(false) re-enables terminal
 * ECHO while mouse tracking is still active, causing mouse events to appear
 * as garbled text.
 *
 * This test verifies the fix by reading the patched source and checking that
 * disableMouse() is called before setRawMode(false) in cleanupBeforeDestroy().
 * A full integration test would require a PTY, but this structural test catches
 * regressions in the patch ordering.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read the patched @opentui/core source
const corePath = resolve(
  __dirname,
  "../../../../../node_modules/.bun/@opentui+core@0.1.95+8e67d58793ed4a15/node_modules/@opentui/core/index-wv534m5j.js",
);
const source = readFileSync(corePath, "utf-8");

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    console.log(` OK | ${name}`);
    passed++;
  } else {
    console.log(`BUG | ${name}`);
    failed++;
  }
}

console.log("Testing @opentui/core destroy-path mouse cleanup ordering\n");

// Test 1: cleanupBeforeDestroy calls disableMouse
check(
  "cleanupBeforeDestroy() contains disableMouse() call",
  /cleanupBeforeDestroy\(\)\s*\{[\s\S]*?this\.disableMouse\(\)[\s\S]*?this\.stdin\.setRawMode\(false\)[\s\S]*?\n\s*\}/.test(
    source,
  ),
);

// Test 2: disableMouse comes BEFORE setRawMode(false) in cleanupBeforeDestroy
{
  // Extract cleanupBeforeDestroy method body
  const methodMatch = source.match(
    /cleanupBeforeDestroy\(\)\s*\{([\s\S]*?)(?=\n\s{2}\w|\n\s{2}(?:get |set |async ))/,
  );
  if (methodMatch) {
    const body = methodMatch[1];
    const disableMouseIdx = body.indexOf("this.disableMouse()");
    const setRawModeIdx = body.indexOf("this.stdin.setRawMode(false)");
    check(
      "disableMouse() is called BEFORE setRawMode(false)",
      disableMouseIdx !== -1 &&
        setRawModeIdx !== -1 &&
        disableMouseIdx < setRawModeIdx,
    );
  } else {
    check("Found cleanupBeforeDestroy method body", false);
  }
}

// Test 3: stdin drain exists between disableMouse and setRawMode
{
  const methodMatch = source.match(
    /cleanupBeforeDestroy\(\)\s*\{([\s\S]*?)(?=\n\s{2}\w|\n\s{2}(?:get |set |async ))/,
  );
  if (methodMatch) {
    const body = methodMatch[1];
    const drainIdx = body.indexOf("while (this.stdin.read() !== null)");
    const setRawModeIdx = body.indexOf("this.stdin.setRawMode(false)");
    check(
      "stdin drain exists before setRawMode(false)",
      drainIdx !== -1 && setRawModeIdx !== -1 && drainIdx < setRawModeIdx,
    );
  } else {
    check("Found cleanupBeforeDestroy method body for drain check", false);
  }
}

// Test 4: suspend() also has correct ordering (regression guard)
{
  const suspendMatch = source.match(
    /suspend\(\)\s*\{([\s\S]*?)(?=\n\s{2}resume\(\)|\n\s{2}\w)/,
  );
  if (suspendMatch) {
    const body = suspendMatch[1];
    const disableMouseIdx = body.indexOf("this.disableMouse()");
    const setRawModeIdx = body.indexOf("this.stdin.setRawMode(false)");
    check(
      "suspend() still has correct ordering (disableMouse before setRawMode)",
      disableMouseIdx !== -1 &&
        setRawModeIdx !== -1 &&
        disableMouseIdx < setRawModeIdx,
    );
  } else {
    check("Found suspend method body", false);
  }
}

// Test 5: Verify DEFAULT_TIMEOUT_MS is bumped
check(
  "DEFAULT_TIMEOUT_MS is >= 25",
  /var DEFAULT_TIMEOUT_MS = (\d+)/.test(source) &&
    parseInt(source.match(/var DEFAULT_TIMEOUT_MS = (\d+)/)[1]) >= 25,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
