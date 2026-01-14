import { createSignal, createResource, Show, For, Suspense } from "solid-js"
import { useParams } from "@solidjs/router"
import { useServer } from "@/context/server"
import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"
import { Icon } from "@opencode-ai/ui/icon"

// Types
interface BrandContext {
    id: string
    name?: string
    tone: string[]
    primaryColors: string[]
    visualPatterns: string[]
    assets: any[]
    status: "pending" | "processing" | "ready" | "approved"
    image?: string
}

import { AgentActivity } from "@/components/agent-activity"

export default function BrandPage() {
    const params = useParams()
    const server = useServer()
    const [analyzing, setAnalyzing] = createSignal(false)
    const [agentStatus, setAgentStatus] = createSignal<{ title: string, detail: string }>({ title: "Thinking", detail: "Initializing..." })

    const [brand, { refetch }] = createResource(async () => {
        // Using fetch directly as SDK types are not updated
        const res = await fetch(`${server.url}/brand`)
        return res.json() as Promise<BrandContext>
    })

    // Simulating Asset Analysis
    const handleUpload = async (e: Event) => {
        setAnalyzing(true)

        setAgentStatus({ title: "Ingesting Asset", detail: "Parsing file structure..." })
        await new Promise(r => setTimeout(r, 600))

        setAgentStatus({ title: "Running OCR", detail: "Extracting text layers and typography..." })
        await new Promise(r => setTimeout(r, 800))

        setAgentStatus({ title: "Visual Analysis", detail: "Identifying primary colors and logo spacing..." })
        await new Promise(r => setTimeout(r, 800))

        setAnalyzing(false)
        refetch()
    }

    const handleApprove = async () => {
        setAnalyzing(true)
        setAgentStatus({ title: "Locking Context", detail: "Generating immutable brand guidelines..." })
        await fetch(`${server.url}/brand/approve`, { method: "POST" })
        await new Promise(r => setTimeout(r, 1000))
        setAnalyzing(false)
        refetch()
    }

    const handleInitialize = async () => {
        setAnalyzing(true)
        setAgentStatus({ title: "Initializing Layer", detail: "Creating brand namespace..." })
        await fetch(`${server.url}/brand`, {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: params.dir })
        })
        await new Promise(r => setTimeout(r, 500))
        setAnalyzing(false)
        refetch()
    }

    return (
        <div class="flex flex-col h-full bg-background-base overflow-y-auto relative">
            <AgentActivity
                active={analyzing()}
                type="thinking"
                title={agentStatus().title}
                detail={agentStatus().detail}
            />
            {/* Header */}
            <header class="flex justify-between items-center px-8 py-6 border-b border-border-base bg-surface-base/50 backdrop-blur sticky top-0 z-10">
                <div class="flex flex-col gap-1">
                    <h1 class="text-xl font-medium text-text-strong tracking-tight">Brand Ground Truth</h1>
                    <p class="text-sm text-text-weak">Manage the visual identity and guidelines for the AI.</p>
                </div>
                <div class="flex items-center gap-3">
                    <Show when={brand()?.status === "approved"}>
                        <div class="flex items-center gap-2 px-3 py-1.5 bg-surface-success-weak text-text-on-success-strong rounded-full text-xs font-medium">
                            <Icon name="check-small" size="small" />
                            <span>Active & Locked</span>
                        </div>
                    </Show>
                    <Show when={brand()?.status !== "approved" && brand()?.status !== "pending"}>
                        <div class="flex items-center gap-2 px-3 py-1.5 bg-surface-warning-weak text-text-on-warning-strong rounded-full text-xs font-medium">
                            <span>Draft Mode</span>
                        </div>
                        <Button variant="primary" onClick={handleApprove}>Lock Brand Context</Button>
                    </Show>
                </div>
            </header>

            {/* Main Content */}
            <main class="max-w-6xl mx-auto w-full p-8 flex flex-col gap-12">

                <Suspense fallback={<div class="flex items-center justify-center py-20 text-text-weak">Loading context...</div>}>
                    <Show when={brand()} fallback={
                        <div class="flex flex-col items-center justify-center p-20 border-2 border-dashed border-border-base rounded-xl gap-4 bg-surface-base">
                            <div class="size-16 rounded-full bg-surface-raised-base flex items-center justify-center">
                                <Icon name="folder-add-left" size="large" class="text-text-base" />
                            </div>
                            <p class="text-text-base font-medium">No Brand Context Found</p>
                            <p class="text-text-weak text-sm max-w-sm text-center">Initialize the brand layer to start uploading assets and defining guidelines.</p>
                            <Button onClick={handleInitialize} variant="primary">Initialize Brand Layer</Button>
                        </div>
                    }>

                        {/* Identity Grid */}
                        <section class="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Visual Identity */}
                            <Card class="p-6 flex flex-col gap-5 border border-border-base shadow-sm bg-surface-raised-base rounded-lg">
                                <div class="flex items-center justify-between">
                                    <h3 class="font-semibold text-text-base">Visual Identity</h3>
                                    <Icon name="pencil-line" class="text-text-weak" />
                                </div>

                                <div class="gap-4 flex flex-col">
                                    <div>
                                        <h4 class="text-xs uppercase tracking-wider text-text-weak mb-3 font-semibold">Primary Colors</h4>
                                        <div class="flex gap-2">
                                            <For each={brand()?.primaryColors}>
                                                {(color) => (
                                                    <div class="group relative size-12 rounded-full border border-border-base shadow-sm hover:scale-105 transition-transform duration-200 cursor-pointer"
                                                        style={{ "background-color": color }}>
                                                        <div class="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-black text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {color}
                                                        </div>
                                                    </div>
                                                )}
                                            </For>
                                            <Show when={brand()?.primaryColors.length === 0}>
                                                <div class="h-12 w-full flex items-center justify-center border border-dashed border-border-base rounded-lg text-text-weaker text-xs italic bg-background-base">
                                                    No colors extracted
                                                </div>
                                            </Show>
                                        </div>
                                    </div>
                                </div>
                            </Card>

                            {/* Tone of Voice */}
                            <Card class="p-6 flex flex-col gap-5 border border-border-base shadow-sm bg-surface-raised-base rounded-lg">
                                <div class="flex items-center justify-between">
                                    <h3 class="font-semibold text-text-base">Tone of Voice</h3>
                                    <Icon name="speech-bubble" class="text-text-weak" />
                                </div>
                                <div class="flex gap-2 flex-wrap content-start h-full">
                                    <For each={brand()?.tone}>
                                        {(tone) => (
                                            <span class="px-3 py-1.5 bg-surface-base border border-border-base rounded-full text-sm text-text-base shadow-sm">
                                                {tone}
                                            </span>
                                        )}
                                    </For>
                                    <Show when={brand()?.tone.length === 0}>
                                        <div class="w-full flex items-center justify-center text-text-weaker text-xs italic h-20">
                                            No tone attributes analyzed
                                        </div>
                                    </Show>
                                </div>
                            </Card>

                            {/* Visual Patterns */}
                            <Card class="p-6 flex flex-col gap-5 border border-border-base shadow-sm bg-surface-raised-base rounded-lg">
                                <div class="flex items-center justify-between">
                                    <h3 class="font-semibold text-text-base">Visual Rules</h3>
                                    <Icon name="layout-left" class="text-text-weak" />
                                </div>

                                <ul class="space-y-3">
                                    <For each={brand()?.visualPatterns}>
                                        {(pattern) => (
                                            <li class="flex items-start gap-2 text-sm text-text-secondary">
                                                <div class="mt-1.5 size-1.5 rounded-full bg-surface-info-base shrink-0" />
                                                <span class="leading-relaxed">{pattern}</span>
                                            </li>
                                        )}
                                    </For>
                                    <Show when={brand()?.visualPatterns.length === 0}>
                                        <div class="w-full flex items-center justify-center text-text-weaker text-xs italic h-20">
                                            No patterns detected
                                        </div>
                                    </Show>
                                </ul>
                            </Card>
                        </section>

                        {/* Assets Section */}
                        <section class="flex flex-col gap-6">
                            <div class="flex items-end justify-between border-b border-border-base pb-4">
                                <div>
                                    <h2 class="text-lg font-medium text-text-strong">Brand Assets</h2>
                                    <p class="text-sm text-text-weak">Logos, guidelines, and product imagery.</p>
                                </div>
                                <span class="text-xs text-text-weaker font-mono">{brand()?.assets.length || 0} ITEMS</span>
                            </div>

                            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                                {/* Upload Dropzone */}
                                <div class="aspect-[4/5] flex flex-col items-center justify-center border border-dashed border-border-strong rounded-xl hover:bg-surface-base hover:border-border-interactive-base cursor-pointer transition-all group bg-background-base"
                                    onClick={() => document.getElementById("file-upload")?.click()}>
                                    <div class="size-12 rounded-full bg-surface-base group-hover:bg-surface-interactive-weak flex items-center justify-center transition-colors mb-3">
                                        <Icon name="plus" class="text-text-weak group-hover:text-text-interactive-base" />
                                    </div>
                                    <span class="text-sm font-medium text-text-secondary group-hover:text-text-strong">Upload Asset</span>
                                    <span class="text-xs text-text-weaker mt-1">PNG, PDF, SVG</span>
                                    <input type="file" id="file-upload" class="hidden" multiple onChange={handleUpload} />
                                </div>

                                {/* Asset Cards */}
                                <For each={brand()?.assets}>
                                    {(asset) => (
                                        <Card class="aspect-[4/5] relative group overflow-hidden rounded-xl border border-border-base bg-white shadow-sm hover:shadow-md transition-shadow">
                                            <div class="size-full p-4 flex items-center justify-center bg-gray-50">
                                                <Show when={asset.type === 'logo' || asset.type === 'product'}>
                                                    <img src={asset.path} class="max-w-full max-h-full object-contain" />
                                                </Show>
                                                <Show when={asset.type !== 'logo' && asset.type !== 'product'}>
                                                    <Icon name="copy" size="large" class="text-text-weak" />
                                                </Show>
                                            </div>

                                            {/* Overlay */}
                                            <div class="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent pt-8 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
                                                <p class="text-white text-xs font-medium truncate">{asset.filename}</p>
                                                <p class="text-white/80 text-[10px] uppercase tracking-wide mt-0.5">{asset.type}</p>
                                            </div>

                                            {/* Status Indicator (Mock) */}
                                            <div class="absolute top-3 right-3">
                                                <span class="relative flex size-2.5">
                                                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                                    <span class="relative inline-flex rounded-full size-2.5 bg-green-500"></span>
                                                </span>
                                            </div>
                                        </Card>
                                    )}
                                </For>

                                {/* Mock Skeleton when analyzing */}
                                <Show when={analyzing()}>
                                    <Card class="aspect-[4/5] rounded-xl border border-border-base bg-surface-base animate-pulse flex items-center justify-center">
                                        <span class="text-xs text-text-weaker">Analyzing...</span>
                                    </Card>
                                </Show>
                            </div>
                        </section>

                        {/* Analysis Pipeline Status (Footer) */}
                        <section class="mt-8 pt-8 border-t border-border-base flex items-center justify-between text-xs text-text-weaker font-mono">
                            <div>BRAND ID: {brand()?.id}</div>
                            <div class="flex gap-4">
                                <span>VISION: ACTIVE</span>
                                <span>OCR: ACTIVE</span>
                                <span>CONTEXT_VERSION: {brand()?.version}</span>
                            </div>
                        </section>

                    </Show>
                </Suspense>
            </main>
        </div>
    )
}
