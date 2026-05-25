"use client"

import { motion } from "framer-motion"
import { MicroCta } from "./MicroCta"

// セキュアコードのハーネスは「AI に機密を渡さない」ためのものではない。
// 機密は TEE 越しに AI へ渡してよい設計なので、ハーネスの役割は
// 「AI に自由に作業させた上で、外側を組織側から縛る」ことにある。
// ここでは 3 つの統制レイヤを提示する:
//   1. permission-policy (実装済み, packages/opencode/src/securecode/plugins)
//   2. 外部通信先・編集可能フォルダの縛り (予定)
//   3. 管理者アカウントによる MCP / URL の一元管理 (予定)

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
          <span className="text-stamp">03 / 価値 2 · ハーネス</span>
          <h2 className="mt-3 text-balance text-3xl font-medium leading-tight md:text-5xl">
            AI に自由を、
            <br className="md:hidden" />
            <span className="text-sc-ember">運用に統制</span> を。
          </h2>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-sc-text-mid md:text-base">
            機密コードを丸ごと AI に渡してよい設計だからこそ、AI が出す操作・通信を
            組織側から縛れることが要になる。Acompanyセキュアコードは AI 自身が
            改変できない設定ファイルと管理者アカウントによって、AI とエンドユーザーの
            双方を信頼することなく安全性を担保する。
          </p>
        </motion.div>

        <PermissionGate />
        <ExternalAccessControl />
        <CentralMcpManagement />

        <MicroCta label="ハーネス連携を相談する" />
      </div>
    </section>
  )
}

// ---- 1. 永続的な権限ポリシー (実装済み) -------------------------------

function PermissionGate() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.7 }}
      className="mb-24 grid gap-8 md:grid-cols-[1fr_1.2fr] md:items-start"
    >
      <div>
        <StatusBadge kind="shipped" />
        <span className="ml-3 font-mono text-[10px] tracking-[0.2em] text-sc-ember">
          POLICY · 権限ゲート
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

// ---- 2. 外部通信先・編集可能フォルダの縛り (予定) ----------------------

function ExternalAccessControl() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.7 }}
      className="mb-24 grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-start"
    >
      <div className="overflow-hidden rounded-lg border border-sc-border bg-sc-bg-soft font-mono text-[12px] leading-relaxed">
        <div className="border-b border-sc-border bg-sc-bg-elev/60 px-3 py-1.5 text-[10px] text-sc-text-dim">
          /etc/securecode/policy.toml · 読み取り専用 (AI 不可触)
        </div>
        <pre className="px-4 py-3 text-sc-text-mid">
{`# 編集可能パス (これ以外は read-only)
[fs.writable]
allow = [
  "{project}/src/**",
  "{project}/tests/**",
]
deny = [
  "{project}/.env*",
  "{project}/secrets/**",
]

# 外部通信先 (これ以外は禁止)
[net.outbound]
allow = [
  "https://api.github.com/*",
  "https://registry.npmjs.org/*",
]
deny_all_others = true`}
        </pre>
        <div className="border-t border-sc-border bg-sc-bg-elev/60 px-3 py-1.5 text-[10px] text-sc-ember">
          ✕ AI からの書き込み試行 → policy.toml により拒否
        </div>
      </div>

      <div>
        <StatusBadge kind="planned" />
        <span className="ml-3 font-mono text-[10px] tracking-[0.2em] text-sc-ember">
          GUARDRAIL · ファイル / ネットワーク
        </span>
        <h3 className="mt-2 text-xl font-medium leading-snug md:text-2xl">
          編集可能パスと
          <br />
          外部通信先を、外から縛る
        </h3>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-sc-text-mid">
          <li>
            <span className="font-mono text-sc-text">▪</span>{" "}
            セキュアコードのプロセス外、AI が触れない場所に置く設定ファイル
          </li>
          <li>
            <span className="font-mono text-sc-text">▪</span>{" "}
            「書き換えてよいパス」「到達してよいネットワーク先」をホワイトリスト化
          </li>
          <li>
            <span className="font-mono text-sc-text">▪</span>{" "}
            AI も開発者も信頼せずに、運用責任者の意図を機械的に強制
          </li>
        </ul>
      </div>
    </motion.div>
  )
}

// ---- 3. 管理者アカウントによる MCP / URL の一元管理 (予定) ------------

function CentralMcpManagement() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.7 }}
      className="grid gap-8 md:grid-cols-[1fr_1.2fr] md:items-start"
    >
      <div>
        <StatusBadge kind="planned" />
        <span className="ml-3 font-mono text-[10px] tracking-[0.2em] text-sc-ember">
          GOVERNANCE · 管理者統制
        </span>
        <h3 className="mt-2 text-xl font-medium leading-snug md:text-2xl">
          連携 MCP・接続 URL は
          <br />
          管理者が一元管理
        </h3>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-sc-text-mid">
          <li>
            <span className="font-mono text-sc-text">▪</span>{" "}
            開発者が勝手に MCP サーバーを追加できない。管理者が承認したものだけが選べる
          </li>
          <li>
            <span className="font-mono text-sc-text">▪</span>{" "}
            接続可能な外部 URL のホワイトリストを管理者アカウントから配信
          </li>
          <li>
            <span className="font-mono text-sc-text">▪</span>{" "}
            ポリシー変更は監査ログ付き。誰が何を許可したかを追跡できる
          </li>
        </ul>
      </div>

      <div className="overflow-hidden rounded-lg border border-sc-border bg-sc-bg-soft font-mono text-[12px] leading-relaxed">
        <div className="border-b border-sc-border bg-sc-bg-elev/60 px-3 py-1.5 text-[10px] text-sc-text-dim">
          Admin Console · MCP allowlist (org: acompany)
        </div>
        <div className="divide-y divide-sc-border/60">
          <McpRow status="approved" name="github" desc="リポジトリ閲覧 / Issue / PR" />
          <McpRow status="approved" name="confluence-internal" desc="社内 Wiki 検索" />
          <McpRow status="approved" name="postgres-readonly" desc="ステージング DB 参照" />
          <McpRow status="pending" name="slack-mcp" desc="承認待ち · 申請者: dev-a" />
          <McpRow status="blocked" name="random-3rd-party" desc="未承認ベンダー" />
        </div>
        <div className="border-t border-sc-border bg-sc-bg-elev/60 px-3 py-1.5 text-[10px] text-sc-text-dim">
          開発者の設定ファイルはこの一覧の subset でしか書けない
        </div>
      </div>
    </motion.div>
  )
}

function McpRow({
  status,
  name,
  desc,
}: {
  status: "approved" | "pending" | "blocked"
  name: string
  desc: string
}) {
  const tone = {
    approved: { dot: "bg-sc-mint", text: "text-sc-mint", label: "APPROVED" },
    pending: { dot: "bg-sc-amber", text: "text-sc-amber", label: "PENDING" },
    blocked: { dot: "bg-sc-ember", text: "text-sc-ember", label: "BLOCKED" },
  }[status]
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span className={`block size-1.5 rounded-full ${tone.dot}`} />
      <span className="w-28 text-sc-text">{name}</span>
      <span className="flex-1 text-sc-text-dim">{desc}</span>
      <span className={`text-[10px] tracking-wider ${tone.text}`}>
        {tone.label}
      </span>
    </div>
  )
}

// ---- shared ------------------------------------------------------------

function StatusBadge({ kind }: { kind: "shipped" | "planned" }) {
  if (kind === "shipped") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-sc-mint/40 bg-sc-mint/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-sc-mint">
        <span className="block size-1 rounded-full bg-sc-mint" />
        SHIPPED
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-sc-amber/40 bg-sc-amber/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-sc-amber">
      <span className="block size-1 rounded-full bg-sc-amber" />
      PLANNED
    </span>
  )
}
