"use client"

import { motion } from "framer-motion"
import { MicroCta } from "./MicroCta"
import { TerminalChrome } from "./TerminalChrome"

// 価値 3: 実際の AI コーディング支援フローを、ターミナル風に体験させる。
// 各メッセージ・各 tool use は whileInView で逐次表示される。

const FLOW = [
  {
    kind: "user",
    body: "BillingService の月額利用料計算に、年契約割引を 15% で追加して。テストも合わせて書いて。",
  },
  {
    kind: "agent-think",
    body: "Reading the project layout to find the existing pricing module…",
  },
  {
    kind: "tool",
    name: "read",
    summary: "src/billing/pricing.ts (172 lines)",
  },
  {
    kind: "tool",
    name: "grep",
    summary: "annual / yearly / discount — 4 matches in 2 files",
  },
  {
    kind: "agent-think",
    body: "既存の DiscountRule に annual バリアントを追加し、計算側を 1 箇所だけ拡張するのが最小変更。",
  },
  {
    kind: "tool",
    name: "edit",
    summary: "src/billing/pricing.ts — +14 −2",
    diff: [
      ["+", "  annual: { kind: 'annual', rate: 0.15 } as const,"],
      ["", "  monthly: { kind: 'monthly', rate: 0 } as const,"],
      ["-", "  return base * (1 - rule.rate)"],
      ["+", "  if (rule.kind === 'annual') return base * 12 * (1 - rule.rate)"],
      ["+", "  return base * (1 - rule.rate)"],
    ],
  },
  {
    kind: "tool",
    name: "write",
    summary: "test/billing/pricing.test.ts (new)",
  },
  {
    kind: "tool",
    name: "bash",
    summary: "$ bun test packages/billing — 8 pass, 0 fail (412ms)",
    ok: true,
  },
  {
    kind: "agent",
    body:
      "年契約割引 15% を DiscountRule.annual として追加し、適用箇所は applyDiscount() の 1 行のみ拡張しました。月額側の挙動は不変、テストは 8 件すべて緑です。",
  },
] as const

export function SectionCoding() {
  return (
    <section id="coding" className="relative w-full bg-sc-bg">
      <div className="mx-auto max-w-6xl px-6 py-32 md:py-48">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.7 }}
        >
          <span className="text-stamp">04 / 価値 3 · AI 開発</span>
          <h2 className="mt-3 text-balance text-3xl font-medium leading-tight md:text-5xl">
            ターミナル完結の UI による、
            <br className="md:hidden" />
            <span className="text-sc-ember">開発速度の圧倒的向上</span>
          </h2>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-sc-text-mid md:text-base">
            ターミナル中心のワークフローを崩さず、コード生成・レビュー・リファクタ・バグ修正・テスト生成までを
            ひとつのセッションでこなす。
          </p>
        </motion.div>

        <div className="mt-12 grid gap-8 lg:grid-cols-[2fr_1fr]">
          <TerminalChrome
            title="securecode · /private/tmp/billing"
            status={
              <span>
                <span className="text-sc-mint">●</span> Qwen3.6
              </span>
            }
          >
            <div className="max-h-[640px] overflow-y-auto px-5 py-5 font-mono text-[12px] leading-relaxed">
              {FLOW.map((m, i) => (
                <FlowLine key={i} index={i} item={m} />
              ))}
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: FLOW.length * 0.15 + 0.4 }}
                className="mt-4 flex items-center gap-2 text-sc-text-dim"
              >
                <span className="text-sc-ember">$</span>
                <span className="text-sc-text-dim">Ask anything...</span>
                <span className="cursor-blink text-sc-ember">▌</span>
              </motion.div>
            </div>
            <div className="flex items-center justify-between border-t border-sc-border bg-sc-bg-elev/60 px-4 py-1.5 font-mono text-[10px] text-sc-text-dim">
              <span>/private/tmp/billing</span>
              <span>
                <span className="mr-3">◯ 3 MCP</span>
                <span>/status</span>
                <span className="ml-3 text-sc-ember">Acompany</span>
              </span>
            </div>
          </TerminalChrome>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="space-y-6"
          >
            <h3 className="font-mono text-[10px] tracking-[0.2em] text-sc-text-dim">
              SELECT MODEL
            </h3>
            <ModelPicker />

            <div>
              <h3 className="font-mono text-[10px] tracking-[0.2em] text-sc-text-dim">
                THIS SESSION
              </h3>
              <dl className="mt-2 space-y-1 text-xs">
                <SessionRow k="tool calls" v="6" />
                <SessionRow k="edited files" v="2" />
                <SessionRow k="masked secrets" v="0" />
                <SessionRow k="permission asks" v="1" />
                <SessionRow k="tokens (in / out)" v="9.1k / 1.4k" />
                <SessionRow k="latency p50" v="820 ms" />
              </dl>
            </div>
          </motion.div>
        </div>

        <MicroCta label="実機を試したい旨を相談する" />
      </div>
    </section>
  )
}

function FlowLine({
  index,
  item,
}: {
  index: number
  item: (typeof FLOW)[number]
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-30px" }}
      transition={{ delay: index * 0.08, duration: 0.4 }}
      className="mb-3"
    >
      {item.kind === "user" && (
        <div className="flex gap-2">
          <span className="text-sc-ember">›</span>
          <span className="text-sc-text">{item.body}</span>
        </div>
      )}
      {item.kind === "agent-think" && (
        <div className="ml-2 flex gap-2 text-sc-text-dim">
          <span className="text-sc-cobalt">◇</span>
          <span className="italic">{item.body}</span>
        </div>
      )}
      {item.kind === "agent" && (
        <div className="ml-2 flex gap-2 text-sc-text-mid">
          <span className="text-sc-mint">●</span>
          <span>{item.body}</span>
        </div>
      )}
      {item.kind === "tool" && (
        <div className="ml-4 rounded-md border border-sc-border bg-sc-bg-elev/50 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="rounded bg-sc-bg px-1.5 py-0.5 text-sc-cobalt">
              {item.name}
            </span>
            <span className="text-sc-text-mid">{item.summary}</span>
            {"ok" in item && item.ok && (
              <span className="ml-auto text-sc-mint">ok</span>
            )}
          </div>
          {"diff" in item && item.diff && (
            <pre className="mt-2 overflow-x-auto text-[11px] leading-snug">
              {item.diff.map(([sign, line], i) => (
                <div
                  key={i}
                  className={
                    sign === "+"
                      ? "text-sc-mint"
                      : sign === "-"
                      ? "text-sc-ember"
                      : "text-sc-text-mid"
                  }
                >
                  <span className="select-none pr-2 opacity-60">
                    {sign || " "}
                  </span>
                  {line}
                </div>
              ))}
            </pre>
          )}
        </div>
      )}
    </motion.div>
  )
}

const MODELS = [
  { name: "Qwen3.6", note: "high", active: true },
  { name: "GPT-OSS-120B", note: "fast", active: false },
  { name: "GPT-OSS-20B", note: "lite", active: false },
] as const

function ModelPicker() {
  return (
    <div className="overflow-hidden rounded-md border border-sc-border bg-sc-bg-soft">
      <div className="border-b border-sc-border px-3 py-1.5 text-[11px] text-sc-text-mid">
        securecode
      </div>
      <ul>
        {MODELS.map((m) => (
          <li
            key={m.name}
            className={`flex items-center justify-between px-3 py-1.5 font-mono text-[11px] ${m.active ? "bg-sc-cobalt/15 text-sc-text" : "text-sc-text-mid"}`}
          >
            <span className="flex items-center gap-2">
              {m.active && <span className="text-sc-cobalt">●</span>}
              {!m.active && <span className="opacity-30">○</span>}
              {m.name}
            </span>
            <span className="text-[10px] text-sc-text-dim">{m.note}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-sc-border px-3 py-1.5 font-mono text-[10px] text-sc-text-dim">
        ctrl+a connect provider · ctrl+f favorite
      </div>
    </div>
  )
}

function SessionRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-sc-border/60 py-1 font-mono">
      <dt className="text-sc-text-dim">{k}</dt>
      <dd className="text-sc-text">{v}</dd>
    </div>
  )
}
