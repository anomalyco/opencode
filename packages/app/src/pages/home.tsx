import { BusinessPulse } from "@/components/business-pulse"
import { AttentionCard } from "@/components/attention-card"
import { DecisionItem } from "@/components/decision-item"
import { useGlobalSync } from "@/context/global-sync"
import { createMemo, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useServer } from "@/context/server"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { useLayout } from "@/context/layout"

export default function Home() {
  const sync = useGlobalSync()
  const server = useServer()
  const navigate = useNavigate()
  const layout = useLayout()

  const handleAsk = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
      const value = e.currentTarget.value.trim()

      // Find the most recent project or defalt to first
      const recentProject = sync.data.project.toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))[0]

      if (recentProject) {
        layout.projects.open(recentProject.worktree)
        navigate(`/${base64Encode(recentProject.worktree)}/session/new?prompt=${encodeURIComponent(value)}`)
      } else {
        // Fallback if no projects exist (unlikely in this persona flow but safe)
        alert("Please create a project first to start an agent.")
      }
    }
  }

  return (
    <div class="bg-white min-h-screen text-black mx-auto mt-16 w-full max-w-2xl px-6 pb-20">

      {/* 1. BUSINESS PULSE */}
      <BusinessPulse
        summary="You made ₹4.2L this week. Margins are stable."
        detail="Amazon volume is up, but D2C conversion slipped slightly."
        trend="neutral"
      />

      <div class="w-full h-px bg-border-weak-base my-8 opacity-50" />

      {/* 2. WHAT NEEDS ATTENTION */}
      <div class="flex flex-col gap-6 mb-12">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-md">
              <Icon name="bubble-5" size="small" />
            </div>
            <h3 class="text-xs font-bold tracking-widest uppercase" style={{ color: "#18181b" }}>Needs Attention</h3>
          </div>
          <span class="text-xs font-bold bg-gradient-to-r from-amber-100 to-orange-100 text-amber-900 px-3 py-1.5 rounded-full border-2 border-amber-400 shadow-sm">3 items</span>
        </div>

        <div class="flex flex-col gap-4">
          <AttentionCard
            title="Margin drop on 'Wool Blend Kurta'"
            impact="Ad spend increased 15% without sales lift."
            action="Review Ads"
            urgency="high"
          />
          <AttentionCard
            title="Competitor Price Match"
            impact="FabIndia is undercutting you by ₹150 on Amazon."
            action="Simulate Price Cut"
            urgency="medium"
          />
          <AttentionCard
            title="Low Inventory Warning"
            impact="Blue Linen Shirts will stock out in 4 days."
            action="Restock Strategy"
            urgency="medium"
          />
        </div>
      </div>

      {/* 3. DECISIONS FOR TODAY */}
      <div class="flex flex-col gap-4 mb-16">
        <div class="flex items-center gap-2.5 mb-2">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white shadow-md">
            <Icon name="brain" size="small" />
          </div>
          <h3 class="text-xs font-bold tracking-widest uppercase" style={{ color: "#18181b" }}>Decisions You Can Make Today</h3>
        </div>

        <div class="flex flex-col divide-y divide-border-weak-base/50 bg-white border border-border-weak-base rounded-xl overflow-hidden shadow-sm">
          <div class="px-4 hover:bg-surface-base transition-colors">
            <DecisionItem
              question="Should I clear out winter inventory?"
              impact="Calculated Risk: Low revenue impact, releases ₹40k cash flow."
            />
          </div>
          <div class="px-4 hover:bg-surface-base transition-colors">
            <DecisionItem
              question="Should I double down on Instagram Ads?"
              impact="Projected: +20% sales volume, -5% margin."
            />
          </div>
          <div class="px-4 hover:bg-surface-base transition-colors">
            <DecisionItem
              question="Why did Flipkart returns spike?"
              impact="Root cause analysis ready for review."
            />
          </div>
        </div>
      </div>

      {/* Subtle Divider */}
      <div class="w-full h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent my-8" />

      {/* 4. SUBTLE ENTRY */}
      <div class="relative group mt-4">
        {/* Subtle background glow on focus */}
        <div class="absolute -inset-1 bg-gradient-to-r from-blue-50 to-emerald-50 rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 blur-sm -z-10" />

        <div class="relative bg-white border border-zinc-200 rounded-xl shadow-sm hover:shadow-md group-focus-within:shadow-lg group-focus-within:border-blue-300 transition-all duration-200">
          <div class="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Icon name="magnifying-glass" class="text-zinc-400 group-focus-within:text-blue-600 transition-colors" size="small" />
          </div>

          <input
            type="text"
            placeholder="Ask a question about your business..."
            onKeyDown={handleAsk}
            style={{ color: "black", opacity: 1 }}
            class="w-full bg-transparent rounded-xl py-4 pl-12 pr-24 text-black placeholder:text-zinc-400 outline-none text-base font-medium"
          />

          <div class="absolute inset-y-0 right-4 flex items-center gap-2">
            <div class="hidden group-focus-within:flex items-center gap-1.5 text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
              <div class="px-2 py-1 bg-zinc-100 border border-zinc-200 rounded-md shadow-sm">
                <span class="text-zinc-700">↵</span>
              </div>
              <span>to ask</span>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-8 flex justify-center items-center gap-3 text-[10px] text-zinc-400 uppercase tracking-widest font-medium">
        <span>ShopOS v1.2</span>
        <span class="w-1 h-1 rounded-full bg-zinc-300" />
        <span class="flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {server.name} Active
        </span>
      </div>

    </div>
  )
}
