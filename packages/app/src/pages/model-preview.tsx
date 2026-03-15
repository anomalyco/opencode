import { Tag } from "@opencode-ai/ui/tag"
import { Logo } from "@opencode-ai/ui/logo"
import { createEffect } from "solid-js"

const hint = 'Ask anything... "Review the secure boot patch before release"'

export default function ModelPreview() {
  createEffect(() => {
    document.title = "Acompany Secure Code /model"
  })

  return (
    <div class="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(57,60,105,0.28),transparent_36%),linear-gradient(180deg,#181a2f_0%,#17192b_52%,#141628_100%)] text-white">
      <div class="relative flex min-h-screen items-center justify-center px-6 py-12">
        <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(124,233,203,0.06),transparent_26%)]" />

        <div class="relative flex w-full max-w-[980px] flex-col items-center">
          <div class="mb-6 flex items-center gap-3 rounded-full border border-white/10 bg-black/20 px-4 py-2 backdrop-blur-md">
            <div class="relative flex size-8 items-center justify-center rounded-full border border-[#2b4f45] bg-[#10271f]">
              <div class="size-2 rounded-full bg-[#91f1d7]" />
            </div>
            <div class="text-[12px] uppercase tracking-[0.28em] text-[#9bcabf]">Acompany Secure Code route enabled</div>
            <Tag class="border border-[#2b4f45] bg-[#10271f] text-[#91f1d7]">attested</Tag>
          </div>

          <div class="flex w-full max-w-[900px] flex-col items-center">
            <Logo class="w-full max-w-[860px] opacity-95 drop-shadow-[0_10px_28px_rgba(0,0,0,0.38)]" />
            <div class="mt-4 text-[12px] uppercase tracking-[0.42em] text-[#7d84a8]">
              confidential coding route for protected repositories
            </div>
          </div>

          <div class="mt-10 w-full max-w-[760px] rounded-[4px] border border-[#25263d] bg-[linear-gradient(180deg,rgba(6,7,13,0.96),rgba(7,8,14,0.98))] shadow-[0_28px_80px_rgba(0,0,0,0.4)]">
            <div class="flex items-center gap-3 border-b border-white/6 px-4 py-4">
              <div class="h-8 w-1 rounded-full bg-[#b29cff]" />
              <div class="min-w-0 font-mono text-[22px] leading-none text-[#eef1ff]">
                <span class="text-[#d6d9ea]">A</span>
                <span class="ml-2 truncate text-[#8d92ad]">{hint}</span>
              </div>
            </div>

            <div class="flex items-center justify-between gap-4 px-4 py-4 font-mono text-[21px] leading-none text-[#d2d6ee]">
              <div class="flex min-w-0 items-center gap-3">
                <span class="text-[#c8b8ff]">Build</span>
                <span class="whitespace-nowrap">qwen3.5-27b</span>
                <span class="shrink-0 rounded-full border border-[#2b4f45] bg-[#10271f] px-3 py-1 text-[15px] tracking-[0.08em] text-[#91f1d7]">
                  [SecureCode]
                </span>
              </div>
              <div class="shrink-0 text-[14px] uppercase tracking-[0.14em] text-[#8d93b4]">tab agents&nbsp;&nbsp;ctrl+p</div>
            </div>
          </div>

          <div class="mt-6 flex items-center gap-3 font-mono text-[15px] text-[#9da3c3]">
            <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">/model</span>
            <span>provider: Acompany Secure Code</span>
            <span class="text-[#6e7391]">retention disabled</span>
          </div>
        </div>
      </div>
    </div>
  )
}
