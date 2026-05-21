"use client"

import { motion, useScroll, useTransform } from "framer-motion"
import { useRef } from "react"

// 機密値・大量出力・危険コマンドの 3 種の "ハーネス" を順に紹介する scrollytelling。
// 実装の根拠:
//   packages/opencode/src/securecode/plugins/secret-mask.ts
//   packages/opencode/src/securecode/plugins/overflow-guard.ts
//   packages/opencode/src/permission

const RAW_TOOL_OUTPUT = `[curl] GET https://api.acompany.tech/v1/billing
HTTP/2 200
authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyXzQyIn0.s9k_signed
x-api-key: ghp_VyXc4nQk6mP9aZ2tWfRb8sLpHj3uG7Md1eOe

{
  "aws_access_key_id": "AKIAIOSFODNN7EXAMPLE",
  "db_url": "postgres://app:hunter2@db.acompany.local:5432/prod",
  "billing": { "amount": 12_400, "currency": "JPY" }
}`

const MASKED_TOOL_OUTPUT = `[curl] GET https://api.acompany.tech/v1/billing
HTTP/2 200
authorization: [REDACTED_AUTH]
x-api-key: [REDACTED_GITHUB_PAT]

{
  "aws_access_key_id": "[REDACTED_AWS_ACCESS_KEY]",
  "db_url": "postgres://app:[REDACTED_URL_PASS]@db.acompany.local:5432/prod",
  "billing": { "amount": 12_400, "currency": "JPY" }
}`

export function SectionHarness() {
  return (
    <section id="harness" className="relative w-full">
      <div className="mx-auto max-w-6xl px-6 py-32 md:py-48">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.7 }}
          className="mb-16"
        >
          <span className="text-stamp">03 / 価値 2</span>
          <h2 className="mt-3 text-balance text-3xl font-medium leading-tight md:text-5xl">
            AI に渡る前に、
            <br />
            <span className="text-sc-ember">ハーネス</span> が
            <br className="md:hidden" />
            止める・隠す・刈り込む。
          </h2>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-sc-text-mid md:text-base">
            opencode・claude code との差別化はここ。エージェントの自律的な振る舞いを、
            プラグイン層で常時監視する。社内のセキュリティポリシーに合わせて
            プラグインを足せば、AI の挙動はそのまま統制下に入る。
          </p>
        </motion.div>

        <HarnessSecretMask />
        <HarnessOverflowGuard />
        <HarnessPermissionGate />
      </div>
    </section>
  )
}

function HarnessSecretMask() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 80%", "end 30%"],
  })

  // 0..1 でマスク済み版へクロスフェード
  const rawOpacity = useTransform(scrollYProgress, [0.2, 0.5], [1, 0])
  const maskedOpacity = useTransform(scrollYProgress, [0.4, 0.7], [0, 1])
  const beamX = useTransform(scrollYProgress, [0.2, 0.7], ["-100%", "100%"])

  return (
    <div ref={ref} className="mb-24 grid gap-8 md:grid-cols-[1fr_1.2fr] md:items-start">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        <span className="font-mono text-[10px] tracking-[0.2em] text-sc-ember">
          PLUGIN · secret-mask
        </span>
        <h3 className="mt-2 text-xl font-medium leading-snug md:text-2xl">
          tool output から、
          <br />
          機密値を黒塗りしてから LLM へ
        </h3>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-sc-text-mid">
          <li>
            <span className="font-mono text-sc-text">▪</span> AWS / GitHub /
            GitLab / Slack トークン
          </li>
          <li>
            <span className="font-mono text-sc-text">▪</span> Bearer ・ JWT ・
            Authorization ヘッダ
          </li>
          <li>
            <span className="font-mono text-sc-text">▪</span> Basic auth 入り
            URL ・ password / api_key 形式
          </li>
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-sc-text-dim">
          experimental.chat.messages.transform フックで全 tool output を
          走査し、検出パターンに合致した値を [REDACTED_*] に置換。
        </p>
      </motion.div>

      <div className="relative overflow-hidden rounded-lg border border-sc-border bg-sc-bg-soft">
        {/* スキャンビーム */}
        <motion.div
          aria-hidden
          style={{ x: beamX }}
          className="absolute inset-y-0 left-0 z-20 w-32 bg-gradient-to-r from-transparent via-sc-ember/30 to-transparent"
        />
        <div className="flex items-center justify-between border-b border-sc-border bg-sc-bg-elev/60 px-3 py-1.5">
          <span className="font-mono text-[10px] text-sc-text-dim">
            tool: bash · status: completed
          </span>
          <motion.span
            style={{ opacity: maskedOpacity }}
            className="rounded bg-sc-ember/20 px-2 py-0.5 font-mono text-[10px] tracking-wider text-sc-ember"
          >
            MASKED · 4
          </motion.span>
        </div>
        <div className="relative h-[280px]">
          <motion.pre
            style={{ opacity: rawOpacity }}
            className="absolute inset-0 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed"
          >
            <HighlightSecrets text={RAW_TOOL_OUTPUT} />
          </motion.pre>
          <motion.pre
            style={{ opacity: maskedOpacity }}
            className="absolute inset-0 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-sc-text"
          >
            <HighlightRedactions text={MASKED_TOOL_OUTPUT} />
          </motion.pre>
        </div>
      </div>
    </div>
  )
}

function HighlightSecrets({ text }: { text: string }) {
  // ざっくり「いかにも秘密」な部分を赤強調する
  const pattern = /(Bearer\s+\S+|ghp_\S+|AKIA[0-9A-Z]+|hunter2)/g
  const parts = text.split(pattern)
  return (
    <code>
      {parts.map((p, i) =>
        pattern.test(p) ? (
          <span
            key={i}
            className="rounded bg-sc-ember/15 px-0.5 text-sc-ember"
          >
            {p}
          </span>
        ) : (
          <span key={i} className="text-sc-text-mid">
            {p}
          </span>
        ),
      )}
    </code>
  )
}

function HighlightRedactions({ text }: { text: string }) {
  const pattern = /(\[REDACTED[_A-Z]*\])/g
  const parts = text.split(pattern)
  return (
    <code>
      {parts.map((p, i) =>
        pattern.test(p) ? (
          <span
            key={i}
            className="rounded bg-sc-mint/15 px-0.5 text-sc-mint"
          >
            {p}
          </span>
        ) : (
          <span key={i} className="text-sc-text-mid">
            {p}
          </span>
        ),
      )}
    </code>
  )
}

function HarnessOverflowGuard() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 90%", "end 30%"],
  })
  // バーの「切り取られた」割合
  const cutWidth = useTransform(scrollYProgress, [0.2, 0.7], ["0%", "62%"])
  const savedTokens = useTransform(scrollYProgress, [0.2, 0.7], [0, 14_280])

  return (
    <div ref={ref} className="mb-24 grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-start">
      <div className="relative overflow-hidden rounded-lg border border-sc-border bg-sc-bg-soft p-6">
        <div className="font-mono text-[10px] tracking-wider text-sc-text-dim">
          /v1/chat/completions · prompt tokens (estimated)
        </div>

        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-sc-bg-elev">
          <div className="relative h-full w-full">
            <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-sc-cobalt-mid via-sc-cobalt to-sc-ember" />
            <motion.div
              style={{ width: cutWidth }}
              className="absolute inset-y-0 right-0 bg-sc-bg-elev"
            />
            <div className="absolute inset-y-0 right-[38%] w-px bg-sc-amber" />
          </div>
        </div>

        <div className="mt-2 flex justify-between font-mono text-[10px] text-sc-text-dim">
          <span>0</span>
          <span className="text-sc-amber">context limit</span>
          <span>32k</span>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4">
          <div className="rounded-md border border-sc-border bg-sc-bg p-4">
            <div className="font-mono text-[10px] tracking-widest text-sc-text-dim">
              BEFORE
            </div>
            <div className="mt-1 font-mono text-2xl text-sc-text">23,118</div>
            <div className="font-mono text-[10px] text-sc-text-dim">tokens</div>
          </div>
          <div className="rounded-md border border-sc-ember/40 bg-sc-ember/5 p-4">
            <div className="font-mono text-[10px] tracking-widest text-sc-ember">
              AFTER
            </div>
            <motion.div className="mt-1 font-mono text-2xl text-sc-text">
              <SavedNumber value={savedTokens} from={23_118} />
            </motion.div>
            <div className="font-mono text-[10px] text-sc-text-dim">
              head + tail 残し / 中央を要約
            </div>
          </div>
        </div>
      </div>

      <div>
        <span className="font-mono text-[10px] tracking-[0.2em] text-sc-ember">
          PLUGIN · overflow-guard
        </span>
        <h3 className="mt-2 text-xl font-medium leading-snug md:text-2xl">
          小さなコンテキストに、
          <br />
          意味のある情報だけ残す
        </h3>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-sc-text-mid">
          <li>
            <span className="font-mono text-sc-text">▪</span> 巨大な tool 出力
            (ログ・grep 結果) を head + tail で head 8KB · tail 8KB に切り詰め
          </li>
          <li>
            <span className="font-mono text-sc-text">▪</span> CJK にも安全な UTF-8
            境界整合・置換マーカー付き
          </li>
          <li>
            <span className="font-mono text-sc-text">▪</span>{" "}
            事前見積もりでコンテキスト溢れを検知し maxOutputTokens を縮める
          </li>
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-sc-text-dim">
          小さなコンテキスト幅しか持たないオープン LLM
          (Qwen 系) でも、賢く動かすための足回り。
        </p>
      </div>
    </div>
  )
}

function SavedNumber({
  value,
  from,
}: {
  value: import("framer-motion").MotionValue<number>
  from: number
}) {
  const display = useTransform(value, (v) => Math.round(from - v).toLocaleString())
  return <motion.span>{display}</motion.span>
}

function HarnessPermissionGate() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.7 }}
      className="grid gap-8 md:grid-cols-[1fr_1.2fr] md:items-start"
    >
      <div>
        <span className="font-mono text-[10px] tracking-[0.2em] text-sc-ember">
          POLICY · permission
        </span>
        <h3 className="mt-2 text-xl font-medium leading-snug md:text-2xl">
          危険な操作は、
          <br />
          必ず人間で止める
        </h3>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-sc-text-mid">
          <li>
            <span className="font-mono text-sc-text">▪</span>{" "}
            shell・write・edit・patch 系 tool に粒度別の許可ポリシー
          </li>
          <li>
            <span className="font-mono text-sc-text">▪</span>{" "}
            プロジェクトごとに allow / ask / deny を上書き
          </li>
          <li>
            <span className="font-mono text-sc-text">▪</span>{" "}
            監査ログに残るので 誰が何を承認したか後追いできる
          </li>
        </ul>
      </div>

      <div className="overflow-hidden rounded-lg border border-sc-border bg-sc-bg-soft font-mono text-[12px] leading-relaxed">
        <div className="border-b border-sc-border bg-sc-bg-elev/60 px-3 py-1.5 text-[10px] text-sc-text-dim">
          permission · bash
        </div>
        <div className="space-y-1 px-4 py-3">
          <div className="text-sc-text-mid">
            <span className="text-sc-ember">●</span> tool requested:{" "}
            <span className="text-sc-text">bash</span>
          </div>
          <pre className="my-2 rounded border border-sc-border bg-sc-bg px-3 py-2 text-sc-text">
            $ rm -rf /var/lib/secrets/*
          </pre>
          <div className="text-sc-text-mid">
            policy: <span className="text-sc-amber">ask</span> · matched pattern:
            destructive_rm
          </div>
          <div className="text-sc-text-mid">approve? [y/n]</div>
          <div className="mt-2 text-sc-ember">
            ✕ denied by user — agent will continue without this tool result.
          </div>
        </div>
      </div>
    </motion.div>
  )
}
