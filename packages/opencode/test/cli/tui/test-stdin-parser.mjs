// Direct import from bun's cache — avoids loading native bindings, only the JS parser is needed.
// This path is populated by `bun install` with the patch applied.
import { StdinParser } from "../../../../../node_modules/.bun/@opentui+core@0.1.90+8e67d58793ed4a15/node_modules/@opentui/core/index-e89anq5x.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function test(name, chunks, delayMs) {
  const events = [];
  const parser = new StdinParser({
    timeoutMs: 10,
    armTimeouts: true,
    onTimeoutFlush: () => {
      parser.drain((e) => events.push(e));
    },
  });

  for (let i = 0; i < chunks.length; i++) {
    parser.push(Buffer.from(chunks[i]));
    parser.drain((e) => events.push(e));
    if (i < chunks.length - 1) await sleep(delayMs);
  }
  // Final drain after all timeouts settle
  await sleep(delayMs + 5);
  parser.drain((e) => events.push(e));

  const summary = events.map((e) => {
    if (e.type === "key") return `KEY:"${e.key?.name || e.raw}"`;
    if (e.type === "mouse") return `MOUSE:${e.event?.type}`;
    if (e.type === "response") return `RESP:${e.protocol}`;
    if (e.type === "paste") return `PASTE`;
    return `${e.type}`;
  });

  const hasKeyLeak = events.some((e) => e.type === "key" && !["escape"].includes(e.key?.name));
  console.log(`${hasKeyLeak ? "BUG" : " OK"} | ${name}`);
  console.log(`     events: [${summary.join(", ")}]`);
  console.log();
  parser.destroy();
}

console.log("Testing opentui StdinParser v0.1.90 SGR mouse fragmentation\n");
console.log("If any line shows BUG — mouse bytes leaked as key events.\n");

// Complete sequence — should always work
await test("Complete sequence in one push", ["\x1b[<0;50;15M"], 0);

// Split mid-coordinates — deferred state should handle
await test("Split mid-coords, 15ms gap", ["\x1b[<0;50;1", "5M"], 15);

// ESC alone then rest — timeout flushes ESC
await test("ESC alone, rest after 15ms", ["\x1b", "[<0;50;15M"], 15);

// Triple split — ESC, [, rest
await test("ESC / [ / rest, 15ms gaps", ["\x1b", "[", "<0;50;15M"], 15);

// Quadruple split — ESC, [, <, rest
await test("ESC / [ / < / rest, 15ms gaps", ["\x1b", "[", "<", "0;50;15M"], 15);

// Every byte separate with 15ms gaps
const fullSeq = "\x1b[<0;50;15M";
const byteByByte = [...fullSeq].map((c) => c);
await test("Every byte separate, 15ms gaps", byteByByte, 15);

// Scroll event
await test("Scroll event complete", ["\x1b[<65;50;15M"], 0);
await test("Scroll event split", ["\x1b[<65;5", "0;15M"], 15);
await test("Scroll ESC alone", ["\x1b", "[<65;50;15M"], 15);

console.log("Done.");
