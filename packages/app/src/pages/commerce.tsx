import { createSignal, createResource, Show, For, Suspense } from "solid-js"
import { useServer } from "@/context/server"
import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"
import { Icon } from "@opencode-ai/ui/icon"
import { DateTime } from "luxon"

// Types (Mirroring Backend)
interface Marketplace {
    id: string
    name: string
    currency: string
    rules: { commissionPct: number, fixedFee: number }
}

interface Dataset {
    timestamp: number
    performance: any[]
    economics: any[]
    products: any[]
}

import { AgentActivity } from "@/components/agent-activity"

export default function CommercePage() {
    const server = useServer()
    const [activeTab, setActiveTab] = createSignal<"performance" | "economics">("performance")
    const [isGenerating, setIsGenerating] = createSignal(false)
    const [agentStatus, setAgentStatus] = createSignal<{ title: string, detail: string }>({ title: "Thinking", detail: "Initializing..." })

    // Fetch Marketplaces
    const [marketplaces] = createResource(async () => {
        const res = await fetch(`${server.url}/commerce/marketplaces`)
        return res.json() as Promise<Marketplace[]>
    })

    // Fetch Data Snapshot
    const [data, { refetch }] = createResource(async () => {
        const res = await fetch(`${server.url}/commerce/generate`, { method: "POST" })
        return res.json() as Promise<Dataset>
    })

    const refreshData = async () => {
        setIsGenerating(true)

        // Agent Simulation Steps
        setAgentStatus({ title: "Analyzing Market", detail: "Querying Amazon, Flipkart API..." })
        await new Promise(r => setTimeout(r, 800))

        setAgentStatus({ title: "Simulating Orders", detail: "Generating 30-day mock transaction history..." })
        await new Promise(r => setTimeout(r, 800))

        setAgentStatus({ title: "Calculating Economics", detail: "Applying tax, logistics, and commission rules..." })
        await new Promise(r => setTimeout(r, 1000))

        await refetch()
        setIsGenerating(false)
    }

    return (
        <div class="flex flex-col h-full bg-background-base overflow-y-auto relative">
            <AgentActivity
                active={isGenerating()}
                type="writing"
                title={agentStatus().title}
                detail={agentStatus().detail}
            />

            {/* Header */}
            <header class="flex justify-between items-center px-8 py-6 border-b border-border-base bg-surface-base/50 backdrop-blur sticky top-0 z-10">
                <div class="flex flex-col gap-1">
                    <h1 class="text-xl font-medium text-text-strong tracking-tight">Commerce Substrate</h1>
                    <p class="text-sm text-text-weak">Multi-market data abstraction and simulation layer.</p>
                </div>
                <div class="flex items-center gap-3">
                    <div class="flex items-center gap-2 px-3 py-1.5 bg-surface-base border border-border-base text-text-secondary rounded-full text-xs font-medium font-mono">
                        <Icon name="server" size="small" />
                        <span>SOURCE: SYNTHETIC</span>
                    </div>
                    <Button variant="secondary" onClick={refreshData} disabled={isGenerating()}>
                        {isGenerating() ? "Simulating..." : "Regenerate Stream"}
                    </Button>
                </div>
            </header>

            <main class="max-w-7xl mx-auto w-full p-8 flex flex-col gap-10">

                {/* Marketplace Connectivity */}
                <section>
                    <h2 class="text-sm font-semibold text-text-weak uppercase tracking-wider mb-4 px-1">Connected Marketplaces</h2>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <For each={marketplaces()}>
                            {(market) => (
                                <Card class="p-5 border border-border-base bg-surface-raised-base rounded-lg flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow">
                                    <div class="flex justify-between items-start">
                                        <div class="flex items-center gap-3">
                                            <div class="size-10 rounded-md bg-white border border-border-base flex items-center justify-center shrink-0">
                                                <Icon name="server" class="text-text-secondary" />
                                            </div>
                                            <div>
                                                <h3 class="font-medium text-text-strong">{market.name}</h3>
                                                <div class="flex items-center gap-1.5 mt-0.5">
                                                    <div class="size-1.5 rounded-full bg-green-500"></div>
                                                    <span class="text-xs text-text-weak">Online</span>
                                                </div>
                                            </div>
                                        </div>
                                        <span class="text-xs font-mono text-text-weaker border border-border-base px-1.5 py-0.5 rounded">
                                            {market.currency}
                                        </span>
                                    </div>

                                    <div class="grid grid-cols-2 gap-y-2 gap-x-4 border-t border-border-base pt-4">
                                        <div>
                                            <p class="text-[10px] text-text-weaker uppercase">Marketplace ID</p>
                                            <p class="text-xs font-mono text-text-secondary">{market.id}</p>
                                        </div>
                                        <div>
                                            <p class="text-[10px] text-text-weaker uppercase">Take Rate</p>
                                            <p class="text-xs font-mono text-text-secondary">{(market.rules.commissionPct * 100).toFixed(1)}%</p>
                                        </div>
                                    </div>
                                </Card>
                            )}
                        </For>
                    </div>
                </section>

                {/* Data Views */}
                <section class="flex flex-col gap-4">
                    <div class="flex items-center justify-between border-b border-border-base pb-1">
                        <div class="flex gap-6">
                            <button
                                onClick={() => setActiveTab("performance")}
                                class={`pb-3 text-sm font-medium transition-colors relative ${activeTab() === "performance" ? "text-text-strong" : "text-text-weak hover:text-text-secondary"}`}
                            >
                                Performance Stream
                                <Show when={activeTab() === "performance"}><div class="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-text-strong"></div></Show>
                            </button>
                            <button
                                onClick={() => setActiveTab("economics")}
                                class={`pb-3 text-sm font-medium transition-colors relative ${activeTab() === "economics" ? "text-text-strong" : "text-text-weak hover:text-text-secondary"}`}
                            >
                                Unit Economics
                                <Show when={activeTab() === "economics"}><div class="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-text-strong"></div></Show>
                            </button>
                        </div>
                        <div class="pb-2 text-xs text-text-weaker font-mono">
                            Updated: {data() ? DateTime.fromMillis(data()!.timestamp).toFormat("HH:mm:ss") : "--:--:--"}
                        </div>
                    </div>

                    {/* Table Area */}
                    <div class="bg-surface-raised-base border border-border-base rounded-lg overflow-hidden min-h-[400px]">
                        <Suspense fallback={<div class="flex items-center justify-center h-full text-text-weak">Loading data stream...</div>}>

                            <Show when={activeTab() === "performance"}>
                                <table class="w-full text-left text-sm">
                                    <thead class="bg-surface-base border-b border-border-base text-text-weaker text-[11px] uppercase tracking-wider font-medium">
                                        <tr>
                                            <th class="px-6 py-3 font-medium w-32">Date</th>
                                            <th class="px-6 py-3 font-medium">Product</th>
                                            <th class="px-6 py-3 font-medium">Marketplace</th>
                                            <th class="px-6 py-3 font-medium text-right">Units Sold</th>
                                            <th class="px-6 py-3 font-medium text-right">Revenue</th>
                                            <th class="px-6 py-3 font-medium text-right">Ad Spend</th>
                                            <th class="px-6 py-3 font-medium w-24">Source</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-border-weak-base">
                                        <For each={data()?.performance.slice(0, 50)}>
                                            {(row) => (
                                                <tr class="hover:bg-surface-base transition-colors group">
                                                    <td class="px-6 py-3 text-text-secondary font-mono text-xs">{row.date}</td>
                                                    <td class="px-6 py-3 text-text-strong font-medium">{row.productID}</td>
                                                    <td class="px-6 py-3 text-text-secondary">
                                                        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-surface-base border border-border-base font-mono">
                                                            {row.marketplace}
                                                        </span>
                                                    </td>
                                                    <td class="px-6 py-3 text-right text-text-secondary font-mono">{row.unitsSold}</td>
                                                    <td class="px-6 py-3 text-right text-text-strong font-mono">₹{row.revenue.toLocaleString()}</td>
                                                    <td class="px-6 py-3 text-right text-text-secondary font-mono text-xs">₹{row.adSpend.toLocaleString()}</td>
                                                    <td class="px-6 py-3">
                                                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-blue-50 text-blue-600 border border-blue-100 font-medium tracking-wide uppercase">
                                                            {row.dataSource}
                                                        </span>
                                                    </td>
                                                </tr>
                                            )}
                                        </For>
                                    </tbody>
                                </table>
                            </Show>

                            <Show when={activeTab() === "economics"}>
                                <table class="w-full text-left text-sm">
                                    <thead class="bg-surface-base border-b border-border-base text-text-weaker text-[11px] uppercase tracking-wider font-medium">
                                        <tr>
                                            <th class="px-6 py-3 font-medium">Product</th>
                                            <th class="px-6 py-3 font-medium">Marketplace</th>
                                            <th class="px-6 py-3 font-medium text-right">Selling Price</th>
                                            <th class="px-6 py-3 font-medium text-right">Total Fees</th>
                                            <th class="px-6 py-3 font-medium text-right">Net Contribution</th>
                                            <th class="px-6 py-3 font-medium text-right">Margin %</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-border-weak-base">
                                        <For each={data()?.economics}>
                                            {(row) => (
                                                <tr class="hover:bg-surface-base transition-colors">
                                                    <td class="px-6 py-3 text-text-strong font-medium">{row.productID}</td>
                                                    <td class="px-6 py-3 text-text-secondary">
                                                        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-surface-base border border-border-base font-mono">
                                                            {row.marketplace}
                                                        </span>
                                                    </td>
                                                    <td class="px-6 py-3 text-right text-text-secondary font-mono">₹{row.sellingPrice.toLocaleString()}</td>
                                                    <td class="px-6 py-3 text-right text-text-weak font-mono text-xs">
                                                        ₹{((row.sellingPrice - row.netContribution)).toLocaleString()}
                                                    </td>
                                                    <td class="px-6 py-3 text-right text-text-strong font-mono font-medium">₹{row.netContribution.toLocaleString()}</td>
                                                    <td class="px-6 py-3 text-right">
                                                        <span class={`inline-flex items-center px-2 py-0.5 rounded font-mono text-xs font-medium 
                                                    ${row.marginPct > 40 ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                                                            {row.marginPct}%
                                                        </span>
                                                    </td>
                                                </tr>
                                            )}
                                        </For>
                                    </tbody>
                                </table>
                            </Show>

                        </Suspense>
                    </div>

                    <div class="text-xs text-text-weaker text-center py-4">
                        Showing {data()?.performance.length || 0} records across {marketplaces()?.length || 0} connected marketplaces.
                    </div>
                </section>

            </main>
        </div>
    )
}
