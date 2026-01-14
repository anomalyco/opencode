import { createMemo, For, Show, createSignal, onMount } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useParams, useNavigate, useSearchParams } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"

// --- Dynamic Data Types ---
type AnalysisScenario = {
  type: 'pricing' | 'inventory' | 'marketing' | 'general'
  title: string
  summary: string
  recommendation: string
  breakdown: {
    headers: string[]
    rows: Array<{
      label: string
      values: Array<{ text: string, type: 'positive' | 'negative' | 'neutral', icon?: string, rotate?: boolean }>
    }>
  }
  assumptions: string
  actions: Array<{
    id: string
    title: string
    badge: string
    detail: string
  }>
}

export default function SessionPage() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [stage, setStage] = createSignal(0)
  const [executionStatus, setExecutionStatus] = createSignal<'idle' | 'running' | 'completed'>('idle')
  const [executedAction, setExecutedAction] = createSignal("")
  const [executionLog, setExecutionLog] = createSignal<string[]>([])

  // Detailed process steps state
  type ActivityStep = {
    id: string
    type: 'thinking' | 'reading' | 'analyzing' | 'writing' | 'done'
    label: string
    detail: string
    status: 'pending' | 'active' | 'completed'
  }
  const [processSteps, setProcessSteps] = createSignal<ActivityStep[]>([])

  // Prioritize search param 'prompt' (from ?prompt=...), fallback to route param, then default
  const rawPrompt = searchParams.prompt || params.prompt || "Analysis"
  const promptText = decodeURIComponent(rawPrompt)

  // --- Intelligence Engine (Simulated) ---
  const data = createMemo<AnalysisScenario>(() => {
    const p = promptText.toLowerCase()

    // Scenario 1: Inventory / Stock
    if (p.includes("stock") || p.includes("inventory") || p.includes("restock") || p.includes("running out")) {
      return {
        type: 'inventory',
        title: "Inventory Risk Analysis",
        summary: "Sales velocity for 'Blue Linen Shirts' has accelerated by 40% in the last 7 days. At this rate, stockout will occur in 4 days, potentially losing ₹85,000 in revenue.",
        recommendation: "Immediate restock required or price increase to slow velocity.",
        breakdown: {
          headers: ["Metric", "Current", "Projected (7 Days)", "Risk Level"],
          rows: [
            {
              label: "Daily Velocity",
              values: [
                { text: "12 units/day", type: "neutral" },
                { text: "18 units/day", type: "negative", icon: "arrow-up" },
                { text: "High", type: "negative" }
              ]
            },
            {
              label: "Stock Remaining",
              values: [
                { text: "48 units", type: "neutral" },
                { text: "0 units", type: "negative" },
                { text: "Critical", type: "negative" }
              ]
            }
          ]
        },
        assumptions: "Assumes consistent demand acceleration. Does not account for potential festive spikes.",
        actions: [
          { id: "rush_order", title: "Place Rush Order (Supplier A)", badge: "High Priority", detail: "Generate PO for 200 units. ETA 3 days." },
          { id: "raise_price", title: "Slow Velocity (Raise Price)", badge: "Temporary Fix", detail: "Increase price by 15% to conserve stock." }
        ]
      }
    }

    // Scenario 2: Marketing / Ads
    if (p.includes("ad") || p.includes("marketing") || p.includes("roas") || p.includes("meta") || p.includes("instagram")) {
      return {
        type: 'marketing',
        title: "Ad Performance Review",
        summary: "ROAS on the 'Summer Collection' campaign has dropped below 2.0. Spend has increased, but conversion rate is down 1.5%.",
        recommendation: "Pause underperforming ad sets and reallocate budget to retargeting.",
        breakdown: {
          headers: ["Channel", "Spend", "ROAS", "Trend"],
          rows: [
            {
              label: "Instagram (Reels)",
              values: [
                { text: "₹12,000", type: "neutral" },
                { text: "1.8", type: "negative" },
                { text: "Declining", type: "negative", icon: "arrow-down" }
              ]
            },
            {
              label: "Google Shopping",
              values: [
                { text: "₹8,500", type: "neutral" },
                { text: "4.2", type: "positive" },
                { text: "Stable", type: "positive", icon: "check" }
              ]
            }
          ]
        },
        assumptions: "Attribution window: 7 days click-through. Creative fatigue detected in Reel #4.",
        actions: [
          { id: "pause_ads", title: "Pause Low ROAS Ad Sets", badge: "Cost Saving", detail: "Stop spend on sets with ROAS < 2.0." },
          { id: "rotate_creative", title: "Rotate Creative Assets", badge: "Optimization", detail: "Deploy 'User Testimonial' video variants." }
        ]
      }
    }

    // Scenario 3: Pricing (Default)
    return {
      type: 'pricing',
      title: "Price Sensitivity Analysis",
      summary: "Reducing the price by ₹200 increases Amazon sales volume by 12% but reduces overall profit margin. On Flipkart, both volume and profit differ significantly.",
      recommendation: "Proceed with a targeted drop on Flipkart only to maximize margin safety.",
      breakdown: {
        headers: ["Marketplace", "Volume Est.", "Margin Impact", "Net Profit"],
        rows: [
          {
            label: "Amazon",
            values: [
              { text: "+12%", type: "positive", icon: "arrow-up" },
              { text: "-4%", type: "negative", icon: "arrow-up", rotate: true },
              { text: "-₹12,400", type: "negative" }
            ]
          },
          {
            label: "Flipkart",
            values: [
              { text: "+18%", type: "positive", icon: "arrow-up" },
              { text: "0%", type: "neutral" },
              { text: "+₹24,100", type: "positive" }
            ]
          }
        ]
      },
      assumptions: "This analysis assumes a moderate price sensitivity (elasticity 1.4) based on your Q4 sales data.",
      actions: [
        { id: "price_flipkart", title: "Apply Price Drop on Flipkart", badge: "Low Risk", detail: "Immediate execution. Updates price to ₹1,299." },
        { id: "simulate_bundle", title: "Simulate Amazon Bundling", badge: "Research", detail: "Explore if bundling can offset margin loss." }
      ]
    }
  })

  // Simulate Report Generation
  onMount(() => {
    const scenario = data().type

    // Define sequence based on scenario
    const sequence: ActivityStep[] = [
      { id: '1', type: 'thinking', label: "Thinking", detail: "Parsing intent & context...", status: 'pending' },
      { id: '2', type: 'reading', label: "Reading Data", detail: scenario === 'inventory' ? "Reading 'inventory_logs.csv' 1.2MB" : scenario === 'marketing' ? "Fetching Meta Ads API..." : "Accessing Amazon Seller Central...", status: 'pending' },
      { id: '3', type: 'analyzing', label: "Analyzing", detail: "Correlating metrics...", status: 'pending' },
      { id: '4', type: 'writing', label: "Writing Report", detail: "Drafting executive summary...", status: 'pending' }
    ]

    setProcessSteps(sequence)

    // Animation Timeline
    // T=0: Start Thinking
    setTimeout(() => setProcessSteps(p => p.map(s => s.id === '1' ? { ...s, status: 'active' } : s)), 100)

    // T=1.5s: Finish Thinking, Start Reading
    setTimeout(() => setProcessSteps(p => p.map(s => s.id === '1' ? { ...s, status: 'completed' } : s.id === '2' ? { ...s, status: 'active' } : s)), 1500)

    // T=3.0s: Finish Reading, Start Analyzing
    setTimeout(() => setProcessSteps(p => p.map(s => s.id === '2' ? { ...s, status: 'completed' } : s.id === '3' ? { ...s, status: 'active' } : s)), 3000)

    // T=4.5s: Finish Analyzing, Start Writing
    setTimeout(() => setProcessSteps(p => p.map(s => s.id === '3' ? { ...s, status: 'completed' } : s.id === '4' ? { ...s, status: 'active' } : s)), 4500)

    // T=6.0s: Finish All, User Stage 1
    setTimeout(() => {
      setProcessSteps(p => p.map(s => ({ ...s, status: 'completed' } as ActivityStep)))
      setStage(1)
    }, 6000)

    setTimeout(() => setStage(2), 6500)
    setTimeout(() => setStage(3), 7000)
  })

  // Simulate Action Execution
  const handleAction = (actionId: string, actionTitle: string) => {
    setExecutionStatus('running')
    setExecutedAction(actionTitle)
    setExecutionLog([])

    const startLog = (log: string, delay: number) => setTimeout(() => setExecutionLog(p => [...p, log]), delay)

    if (actionId === 'price_flipkart') {
      startLog("Initiating 'Price Update' Protocol...", 500)
      startLog("Validating credentials with Flipkart Seller Hub...", 1500)
      startLog("Pushing SKU #WBK-2024 update (₹1,499 -> ₹1,299)...", 3000)
      startLog("Verifying listing status...", 4500)
    } else if (actionId === 'rush_order') {
      startLog("Connecting to Supplier Portal...", 500)
      startLog("Generating Purchase Order #PO-9921...", 1500)
      startLog("Emailing Supplier A (orders@suppliera.com)...", 3000)
      startLog("Awaiting acknowledgment...", 4500)
    } else if (actionId === 'pause_ads') {
      startLog("Authenticating with Meta Marketing API...", 500)
      startLog("Identifying Ad Sets with ROAS < 2.0...", 1500)
      startLog("Pausing 'Summer_Reel_V2'...", 3000)
      startLog("Pausing 'Static_Carousel_Blue'...", 3500)
      startLog("Confirming campaign status update...", 4500)
    } else {
      startLog("Initializing workflow...", 500)
      startLog("Processing request parameters...", 1500)
      startLog("Executing task agent...", 3000)
      startLog("Finalizing output...", 4500)
    }

    // Complete
    setTimeout(() => {
      setExecutionStatus('completed')
    }, 5500)
  }

  return (
    <div class="bg-white min-h-screen text-black w-full flex flex-col items-center">

      <div class="w-full max-w-3xl px-8 py-12 flex flex-col gap-10">

        {/* 1. Header */}
        <div class="flex flex-col gap-2 transition-opacity duration-500 ease-out"
          classList={{ 'opacity-0': stage() < 1, 'opacity-100': stage() >= 1 }}>
          <h1 class="text-2xl font-semibold tracking-tight text-black first-letter:uppercase">
            {data().title}
          </h1>
          <div class="text-sm text-[#71717a] flex items-center gap-2">
            <span>Based on prompt: "{promptText}"</span>
            <span class="w-1 h-1 rounded-full bg-[#d4d4d8]" />
            <span>Updated just now</span>
          </div>
        </div>

        {/* Loading State Overlay (Dynamic Activity Modules) */}
        <Show when={stage() < 1}>
          <div class="absolute inset-x-0 top-32 flex flex-col items-center justify-start z-10 px-6 gap-3 pointer-events-none">

            <For each={processSteps()}>
              {(step) => (
                <Show when={step.status !== 'pending'}>
                  <div class="pointer-events-auto backdrop-blur-sm p-6 rounded-3xl shadow-2xl min-w-[360px] max-w-md flex flex-col gap-3 animate-in slide-in-from-bottom-8 fade-in duration-700 fill-mode-forwards" style={{
                    borderColor: step.type === 'thinking' ? '#3b82f6' :
                      step.type === 'reading' ? '#f59e0b' :
                        step.type === 'analyzing' ? '#a855f7' :
                          '#10b981'
                  }}>

                    {/* Metadata Row */}
                    <div class="flex justify-between items-center text-[10px] font-mono uppercase tracking-wider px-1" style={{ color: "#71717a" }}>
                      <span class="flex items-center gap-1.5">
                        <span class={`w-2 h-2 rounded-full ${step.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-zinc-300'}`} />
                        <span style={{ color: "#000000", fontWeight: "bold" }}>{step.status === 'active' ? 'Processing' : 'Completed'}</span>
                      </span>
                      <span style={{ color: "#52525b", fontWeight: "600" }}>
                        {step.type === 'reading' ? 'Data: 1.2MB' : step.type === 'writing' ? 'Gen: 4 Tokens' : 'Agent: v1.0'}
                      </span>
                    </div>

                    {/* Main Content */}
                    <div class="flex items-center gap-4">
                      {/* Icon */}
                      <div class={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 shadow-md ${step.type === 'thinking' ? "bg-gradient-to-br from-blue-500 to-blue-600 text-white" :
                        step.type === 'reading' ? "bg-gradient-to-br from-amber-500 to-orange-500 text-white" :
                          step.type === 'analyzing' ? "bg-gradient-to-br from-purple-500 to-pink-500 text-white" :
                            "bg-gradient-to-br from-emerald-500 to-green-500 text-white"
                        }`}>
                        <Show when={step.status === 'active'}>
                          <Icon name={
                            step.type === 'thinking' ? 'brain' :
                              step.type === 'reading' ? 'archive' :
                                step.type === 'writing' ? 'code' :
                                  'magnifying-glass'
                          } class="animate-pulse" size="large" />
                        </Show>
                        <Show when={step.status === 'completed'}>
                          <Icon name="check" class="w-7 h-7" />
                        </Show>
                      </div>

                      {/* Text */}
                      <div class="flex flex-col gap-1.5">
                        <span class="text-xl font-bold leading-none tracking-tight" style={{ color: "#000000" }}>
                          {step.label}
                        </span>
                        <span class="text-sm font-medium leading-relaxed" style={{ color: "#52525b" }}>
                          {step.detail}
                        </span>
                      </div>
                    </div>
                  </div>
                </Show>
              )}
            </For>

          </div>
        </Show>

        {/* Main Report Content (Hidden when executing) */}
        <Show when={executionStatus() === 'idle'}>
          <Show when={stage() >= 1}>
            <div class="bg-[#fafafa] p-6 rounded-xl border border-[#e4e4e7] animate-in">
              <h2 class="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-3">Executive Summary</h2>
              <p class="text-lg leading-relaxed text-black">
                {data().summary}
                <br /><br />
                <span class="font-medium">Recommendation:</span> {data().recommendation}
              </p>
            </div>
          </Show>

          <Show when={stage() >= 2}>
            <div class="flex flex-col gap-4 animate-in" style={{ "animation-delay": "100ms" }}>
              <h2 class="text-xs font-semibold text-[#71717a] uppercase tracking-wider">Analysis Breakdown</h2>

              <div class="w-full border-t border-b border-[#e4e4e7]">
                <div class="grid gap-2 py-3 text-xs font-semibold text-[#71717a] uppercase tracking-wider"
                  style={{ "grid-template-columns": `repeat(${data().breakdown.headers.length}, 1fr)` }}>
                  <For each={data().breakdown.headers}>
                    {(h, i) => <span class={i() === data().breakdown.headers.length - 1 ? "text-right" : ""}>{h}</span>}
                  </For>
                </div>

                <For each={data().breakdown.rows}>
                  {(row) => (
                    <div class="grid gap-2 py-4 border-t border-[#f4f4f5] items-center"
                      style={{ "grid-template-columns": `repeat(${data().breakdown.headers.length}, 1fr)` }}>
                      <span class="font-medium text-black">{row.label}</span>

                      <For each={row.values}>
                        {(val, i) => (
                          <span class={`flex items-center gap-1 font-medium ${val.type === 'positive' ? 'text-[#22c55e]' :
                            val.type === 'negative' ? 'text-[#ef4444]' : 'text-black'
                            } ${i() === row.values.length && i() > 0 ? "justify-end" : ""}`}>
                            <Show when={val.icon}>
                              <Icon name={val.icon as any} size="small" style={val.rotate ? { transform: "rotate(180deg)" } : {}} />
                            </Show>
                            {val.text}
                          </span>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={stage() >= 2}>
            <div class="flex flex-col gap-2 animate-in" style={{ "animation-delay": "200ms" }}>
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full bg-[#22c55e]" />
                <span class="text-sm font-medium text-black">High Confidence Analysis</span>
              </div>
              <p class="text-sm text-[#71717a] leading-relaxed max-w-xl">
                {data().assumptions}
              </p>
            </div>
          </Show>

          <Show when={stage() >= 3}>
            <div class="flex flex-col gap-4 pt-4 animate-in" style={{ "animation-delay": "300ms" }}>
              <h2 class="text-xs font-semibold text-[#71717a] uppercase tracking-wider">Recommended Decisions</h2>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <For each={data().actions}>
                  {(action) => {
                    // Determine color scheme based on badge/priority
                    const isHighPriority = action.badge.toLowerCase().includes('high') || action.badge.toLowerCase().includes('priority')
                    const isRisk = action.badge.toLowerCase().includes('risk')
                    const isOptimization = action.badge.toLowerCase().includes('optim') || action.badge.toLowerCase().includes('cost')

                    const accentColor = isHighPriority || isRisk ? '#ef4444' : isOptimization ? '#22c55e' : '#3b82f6'
                    const bgGradient = isHighPriority || isRisk
                      ? 'from-red-50/80 to-rose-50/80'
                      : isOptimization
                        ? 'from-emerald-50/80 to-green-50/80'
                        : 'from-blue-50/80 to-indigo-50/80'
                    const badgeBg = isHighPriority || isRisk
                      ? 'bg-red-100/70 text-red-700'
                      : isOptimization
                        ? 'bg-emerald-100/70 text-emerald-700'
                        : 'bg-blue-100/70 text-blue-700'

                    return (
                      <div onClick={() => handleAction(action.id, action.title)}
                        class={`relative overflow-hidden p-5 rounded-2xl cursor-pointer group bg-gradient-to-br ${bgGradient} backdrop-blur-sm hover:shadow-xl transition-all duration-300 active:scale-[0.98] border-0`}
                        style={{
                          "box-shadow": "0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03)"
                        }}>
                        {/* Accent border on left */}
                        <div class="absolute left-0 top-0 bottom-0 w-1 transition-all duration-300 group-hover:w-1.5"
                          style={{ "background-color": accentColor }} />

                        {/* Subtle top glow */}
                        <div class="absolute top-0 left-0 right-0 h-px opacity-50"
                          style={{ "background": `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }} />

                        <div class="flex justify-between items-start mb-3">
                          <span class="font-bold text-black group-hover:translate-x-0.5 transition-transform duration-200 pr-2 leading-tight">{action.title}</span>
                          <span class={`${badgeBg} text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider font-semibold shrink-0 shadow-sm`}>
                            {action.badge}
                          </span>
                        </div>
                        <p class="text-sm text-zinc-600 leading-relaxed">{action.detail}</p>

                        {/* Hover indicator */}
                        <div class="mt-3 flex items-center gap-1.5 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                          style={{ color: accentColor }}>
                          <span>Click to execute</span>
                          <Icon name="chevron-right" size="small" />
                        </div>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>
          </Show>

          <Show when={stage() >= 3}>
            <div class="pt-8 flex justify-center animate-in" style={{ "animation-delay": "400ms" }}>
              <Button variant="ghost" class="text-[#a1a1aa] hover:text-black text-xs uppercase tracking-widest gap-2">
                <Icon name="archive" size="small" /> View Detailed Logs
              </Button>
            </div>
          </Show>
        </Show>

        {/* Execution State */}
        <Show when={executionStatus() !== 'idle'}>
          <div class="flex flex-col gap-6 animate-in">
            <div class="flex items-center gap-3 pb-4 border-b border-[#e4e4e7]">
              <Show when={executionStatus() === 'running'}>
                <div class="w-5 h-5 border-2 border-[#e4e4e7] border-t-black rounded-full animate-spin" />
              </Show>
              <Show when={executionStatus() === 'completed'}>
                <div class="w-5 h-5 bg-[#22c55e] rounded-full flex items-center justify-center">
                  <Icon name="check" size="small" class="text-white" />
                </div>
              </Show>
              <h2 class="text-lg font-medium text-black">
                {executionStatus() === 'running' ? `Executing: ${executedAction()}` : `Completed: ${executedAction()}`}
              </h2>
            </div>

            {/* Live Logs */}
            <div class="flex flex-col gap-3 font-mono text-sm max-h-[300px] overflow-y-auto">
              <For each={executionLog()}>
                {(log) => (
                  <div class="flex items-center gap-3 animate-in">
                    <span class="text-[#a1a1aa]">{new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" })}</span>
                    <span class="text-[#3f3f46]">&gt; {log}</span>
                  </div>
                )}
              </For>
              <Show when={executionStatus() === 'running'}>
                <div class="w-2 h-4 bg-black/50 animate-pulse ml-[60px]" />
              </Show>
            </div>

            {/* Success Card with Details */}
            <Show when={executionStatus() === 'completed'}>
              <div class="mt-8 overflow-hidden rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] animate-in shadow-sm">
                <div class="p-6 border-b border-[#bbf7d0]/50 flex items-start gap-4">
                  <div class="p-2 bg-[#dcfce7] rounded-full text-[#15803d]">
                    <Icon name="check" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <h3 class="font-semibold text-lg text-[#166534]">Execution Successful</h3>
                    <p class="text-[#15803d] text-sm leading-relaxed">
                      The requested action has been processed and synchronized with the relevant business systems.
                    </p>
                  </div>
                </div>
                <div class="p-4 bg-[#dcfce7]/30 flex justify-end">
                  <Button onClick={() => navigate("/")}
                    class="bg-white border border-[#bbf7d0] text-[#166534] hover:bg-[#166534] hover:text-white transition-colors shadow-sm font-medium">
                    Return to Dashboard
                  </Button>
                </div>
              </div>
            </Show>
          </div>
        </Show>

      </div>
    </div>
  )
}
