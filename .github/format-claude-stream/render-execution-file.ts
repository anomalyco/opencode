#!/usr/bin/env bun
/**
 * securecode 固有のラッパ（ベンダリングした Khan/format-claude-stream の上に追加したもの）。
 *
 * anthropics/claude-code-action の `execution_file` 出力は、stream-json の各行を
 * そのまま並べた JSONL ではなく、SDKMessage を 1 つの配列にまとめて pretty-print した
 * JSON ファイル（`JSON.stringify(messages, null, 2)`）になっている。
 * 一方ベンダリング元の CLI (`src/cli/main.ts`) は 1 行 = 1 JSON の JSONL を前提にしている。
 *
 * そこでこのラッパは execution_file を配列として読み込み、要素（= stream-json イベントと
 * 同じ形）を 1 件ずつ formatter に渡して、人間が読みやすいログへ整形する。
 *
 * 使い方:
 *   bun render-execution-file.ts <execution_file.json> [--color]
 *
 *   --color   ANSI カラーを付ける（端末・Actions のジョブログ向け）。
 *             省略時はプレーンテキスト（GITHUB_STEP_SUMMARY の code block 向け）。
 */
import {readFile} from "node:fs/promises";
import {ClaudeStreamFormatter} from "./src/claude-stream-formatter.ts";
import {StandardOutput} from "./src/adapters/standard-output.ts";
import {NullColorizer} from "./src/core/ports/null-colorizer.ts";
import type {Colorizer} from "./src/core/ports/colorizer.ts";

const args = process.argv.slice(2);
const useColor = args.includes("--color");
const filePath = args.find((arg) => !arg.startsWith("-"));

if (!filePath) {
    process.stderr.write(
        "usage: bun render-execution-file.ts <execution_file.json> [--color]\n",
    );
    process.exit(1);
}

const raw = await readFile(filePath, "utf8");

let messages: unknown;
try {
    messages = JSON.parse(raw);
} catch (e) {
    process.stderr.write(`execution_file の JSON 解析に失敗しました: ${e}\n`);
    process.exit(1);
}

// claude-code-action は配列で書き出すが、将来の形式変更や JSONL にも一応備えておく。
const events: unknown[] = Array.isArray(messages)
    ? messages
    : typeof messages === "object" && messages !== null
      ? [messages]
      : [];

// 既定はプレーン（GITHUB_STEP_SUMMARY の code block 向け）。
// --color のときだけ chalk を動的 import する。chalk は既定の依存に含めていない
// （CI で取得するパッケージを zod だけに絞るため）ので、無ければプレーンに戻す。
let colorizer: Colorizer = new NullColorizer();
if (useColor) {
    try {
        const {ChalkColorizer} = await import(
            "./src/adapters/chalk-colorizer.ts"
        );
        colorizer = new ChalkColorizer();
    } catch {
        process.stderr.write(
            "chalk が見つからないためカラー出力を無効化し、プレーンで続行します。\n",
        );
    }
}

const formatter = new ClaudeStreamFormatter(new StandardOutput(), {
    colorizer,
    cwd: process.cwd(),
});

for (const event of events) {
    try {
        await formatter.write(event);
    } catch (e) {
        process.stderr.write(`イベントの整形に失敗しました: ${e}\n`);
    }
}
