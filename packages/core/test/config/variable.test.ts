import path from "path"
import fs from "fs/promises"
import { expect } from "bun:test"
import { Effect } from "effect"
import { type ParseError, parse } from "jsonc-parser"
import { ConfigVariable } from "@opencode/core/config/variable"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(FSUtil.node))
const windows = String.raw`C:\Users\Example`

for (const entry of [
  {
    name: "preserves raw arrays and scalar env values during fallback",
    text: '"value": {env:VALUE}',
    value: '[false, 42, null, {"nested": "ok"}]',
    expected: { value: [false, 42, null, { nested: "ok" }] },
  },
  {
    name: "uses each occurrence's context for a repeated env value",
    text: '"value": {env:VALUE}, "quoted": "{env:VALUE}"',
    value: '{"nested": "ok"}',
    expected: { value: { nested: "ok" }, quoted: '{"nested": "ok"}' },
  },
  {
    name: "tracks original offsets across several env placeholders in one string",
    text: '"value": "prefix-{env:VALUE}-{env:WINDOWS}-{env:VALUE}-suffix"',
    value: String.raw`a\"b`,
    expected: { value: `prefix-a"b-${windows}-a"b-suffix` },
  },
  {
    name: "preserves valid JSON escapes in a path when another env forces fallback",
    text: '"value": "{env:VALUE}"',
    value: String.raw`C:\temp\new`,
    expected: { value: "C:\temp\new" },
  },
  {
    name: "escapes a trailing backslash during fallback",
    text: '"value": "{env:VALUE}"',
    value: "trailing\\",
    expected: { value: "trailing\\" },
  },
  {
    name: "escapes control characters during fallback",
    text: '"value": "{env:VALUE}"',
    value: "first\nsecond\t\u0000",
    expected: { value: "first\nsecond\t\u0000" },
  },
  {
    name: "keeps a string value from adding JSON properties during fallback",
    text: '"value": "{env:VALUE}"',
    value: 'end", "added": true, "other": "start',
    expected: { value: 'end", "added": true, "other": "start' },
  },
  {
    name: "keeps env substitutions inside line and block comments during fallback",
    text: '// {env:VALUE}\n/* {env:VALUE} */ "value": "ok",',
    value: 'first\n"second"\\',
    expected: { value: "ok" },
  },
  {
    name: "recognizes string tokens after escaped quotes and comment markers",
    text: String.raw`"value": "\" // /* {env:VALUE}"`,
    value: String.raw`a\"b`,
    expected: { value: '" // /* a"b' },
  },
]) {
  it.effect(entry.name, () =>
    Effect.gen(function* () {
      const text = yield* ConfigVariable.substitute({
        type: "virtual",
        source: "test",
        dir: "/",
        text: `{ "windows": "{env:WINDOWS}", ${entry.text} }`,
        env: { WINDOWS: windows, VALUE: entry.value },
      })
      const errors: ParseError[] = []
      expect(parse(text, errors, { allowTrailingComma: true })).toEqual({ windows, ...entry.expected })
      expect(errors).toEqual([])
    }),
  )
}

it.live("combines fallback with relative file contents for path and virtual sources", () =>
  Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
    Effect.flatMap((tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "value.txt"), 'file "contents"\nnext'))
        for (const source of [
          { type: "path", path: path.join(tmp.path, "opencode.jsonc") },
          { type: "virtual", source: "test", dir: tmp.path },
        ] as const) {
          const text = yield* ConfigVariable.substitute({
            ...source,
            text: '{ "windows": "{env:WINDOWS}", "file": "{file:value.txt}", "raw": {env:RAW} }',
            env: { WINDOWS: windows, RAW: '{"ok": true}' },
          })
          expect(JSON.parse(text)).toEqual({ windows, file: 'file "contents"\nnext', raw: { ok: true } })
        }
      }),
    ),
  ),
)
