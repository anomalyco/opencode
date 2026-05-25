"use client"

import { motion, useScroll, useTransform } from "framer-motion"
import { useRef } from "react"
import { Wordmark } from "./Wordmark"
import { TerminalChrome } from "./TerminalChrome"

export function Hero() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  })

  // ヒーロー全体を奥に押し込みながらフェード
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.9])
  const opacity = useTransform(scrollYProgress, [0, 0.9], [1, 0])
  const y = useTransform(scrollYProgress, [0, 1], [0, -120])

  return (
    <section
      id="top"
      ref={ref}
      className="relative isolate min-h-screen w-full overflow-hidden"
    >
      {/* ambient gradient */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_30%,rgba(252,83,58,0.18)_0%,transparent_60%),radial-gradient(circle_at_80%_80%,rgba(3,76,255,0.12)_0%,transparent_55%)]"
      />

      <motion.div
        style={{ scale, opacity, y }}
        className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-24"
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-8 flex w-full flex-col items-center gap-6"
        >
          <span className="text-stamp">
            CONFIDENTIAL AI SUITE
          </span>
          <div className="w-full max-w-3xl px-4 select-none">
            <Wordmark />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
          className="mt-2 max-w-2xl text-center"
        >
          <h1 className="text-balance text-2xl font-medium leading-tight text-sc-text md:text-3xl">
            機密ソースコードを漏洩させずに、
            <br />
            AI コーディング支援を実現する。
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-sc-text-mid md:text-base">
            Trusted Execution Environment (TEE) と専用ハーネスにより、
            <br className="hidden md:inline" />
            生成 AI の利用に強い制限がかかる組織でも、機密コードを守ったまま開発を加速する。
          </p>
        </motion.div>

        {/* Terminal mock — top-secure-code.png を再現 */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.6, ease: "easeOut" }}
          className="mt-12 w-full max-w-3xl"
        >
          <TerminalChrome status={<span>Code review · Sign up</span>}>
            <div className="px-6 py-10">
              <div className="flex items-center justify-center pb-8">
                <div className="w-full max-w-md opacity-90">
                  <Wordmark />
                </div>
              </div>
              <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-md border border-sc-border bg-sc-bg-elev px-4 py-3 font-mono text-xs">
                <div className="flex items-baseline gap-2 whitespace-nowrap text-sc-text-mid">
                  <span className="text-sc-ember">$</span>
                  <span className="hidden text-sc-text-dim sm:inline">
                    Ask anything...
                  </span>
                  <span className="text-sc-text">
                    “What is the tech stack of this project?”
                  </span>
                  <span className="cursor-blink ml-0.5 text-sc-ember">▌</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-sc-text-dim">
                  <span className="rounded bg-sc-bg px-1.5 py-0.5">Build</span>
                  <span className="text-sc-text-mid">Qwen3.6</span>
                  <span>securecode</span>
                </div>
              </div>
              <div className="mt-3 text-right font-mono text-[10px] text-sc-text-dim">
                tab agents &nbsp;&nbsp; ctrl+p commands
              </div>
              <div className="mt-6 text-center font-mono text-[11px] text-sc-text-dim">
                <span className="text-sc-mint">●</span> Tip Create a plugin to
                prevent agent from reading sensitive files
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-sc-border bg-sc-bg-elev/60 px-4 py-1.5 font-mono text-[10px] text-sc-text-dim">
              <span>~/project/billing</span>
              <span>
                <span className="mr-3">◯ 3 MCP</span>
                <span>/status</span>
                <span className="ml-3 text-sc-ember">Acompany</span>
              </span>
            </div>
          </TerminalChrome>
        </motion.div>

        {/* scroll hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4, duration: 0.8 }}
          className="mt-16 flex flex-col items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-sc-text-dim"
        >
          <span>SCROLL</span>
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            className="h-6 w-px bg-sc-text-dim"
          />
        </motion.div>
      </motion.div>
    </section>
  )
}
