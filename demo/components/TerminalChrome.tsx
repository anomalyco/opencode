// TerminalChrome.tsx
//
// 本体 TUI のスクリーンショット (github/assets/top-secure-code.png) を踏襲した
// macOS 風タイトルバー + プロンプト枠。LP 内のターミナルガワとして再利用する。

import type { ReactNode } from "react"

export function TerminalChrome({
  title = "securecode",
  status,
  children,
  className = "",
}: {
  title?: string
  status?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`terminal-window overflow-hidden ${className}`}>
      <div className="terminal-titlebar flex items-center gap-3 px-3 py-2">
        <div className="flex gap-1.5">
          <span className="block size-3 rounded-full bg-[#ff5f56]" />
          <span className="block size-3 rounded-full bg-[#ffbd2e]" />
          <span className="block size-3 rounded-full bg-[#27c93f]" />
        </div>
        <div className="flex-1 text-center text-[11px] tracking-wide text-sc-text-mid font-mono select-none">
          {title}
        </div>
        <div className="text-[11px] text-sc-text-dim font-mono">
          {status ?? <span className="opacity-60">Code review</span>}
        </div>
      </div>
      <div className="bg-sc-bg-soft scanlines">{children}</div>
    </div>
  )
}
