import test from "node:test";
import assert from "node:assert/strict";
import { SseParser } from "../src/core/sse.ts";

test("SseParser handles chunk boundaries mid-event", () => {
  const parser = new SseParser();
  const all = [
    ...parser.push('data: {"a"'),
    ...parser.push(':1}\n'),
    ...parser.push("\n"),
    ...parser.flush(),
  ];
  assert.equal(all.length, 1);
  assert.deepEqual(JSON.parse(all[0]!.data), { a: 1 });
});

test("SseParser splits multiple events in one chunk", () => {
  const parser = new SseParser();
  const events = parser.push('data: one\n\ndata: two\n\n');
  assert.equal(events.length, 2);
  assert.equal(events[0]!.data, "one");
  assert.equal(events[1]!.data, "two");
});

test("SseParser supports named events and multi-line data", () => {
  const parser = new SseParser();
  const events = parser.push("event: error\ndata: line1\ndata: line2\n\n");
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event, "error");
  assert.equal(events[0]!.data, "line1\nline2");
});

test("SseParser ignores comments and CRLF endings", () => {
  const parser = new SseParser();
  const events = parser.push(": keepalive\r\ndata: hello\r\n\r\n");
  assert.equal(events.length, 1);
  assert.equal(events[0]!.data, "hello");
});

test("sseStream yields events across async byte chunks", async () => {
  async function* bytes() {
    yield new TextEncoder().encode("data: hel");
    yield new TextEncoder().encode("lo\n\nda");
    yield new TextEncoder().encode("ta: world\n\n");
  }
  const out = [];
  for await (const ev of (await import("../src/core/sse.ts")).sseStream(bytes())) {
    out.push(ev);
  }
  assert.deepEqual(out.map((e) => e.data), ["hello", "world"]);
});

test("consecutive data lines join into one multi-line event", () => {
  const parser = new SseParser();
  // No blank line between the two data lines -> single event per SSE spec.
  const events = parser.push("data: [DO");
  assert.equal(events.length, 0);
  const more = parser.push("NE]\ndata: x\n\n");
  assert.equal(more.length, 1);
  assert.equal(more[0]!.data, "[DONE]\nx");
});
