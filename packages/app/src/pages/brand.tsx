import { createSignal, createResource, Show, For, Suspense } from "solid-js"
import { useParams } from "@solidjs/router"
import { useServer } from "@/context/server"
import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"

// Local types until SDK is regenerated
interface BrandContext {
    id: string
    name?: string
    tone: string[]
    primaryColors: string[]
    visualPatterns: string[]
    assets: any[]
    status: "pending" | "processing" | "ready" | "approved"
    image?: string // Representative image
}

export default function BrandPage() {
    const params = useParams()
    const server = useServer()
    const [analyzing, setAnalyzing] = createSignal(false)

    const [brand, { refetch }] = createResource(async () => {
        // Manual fetch until SDK is updated
        return server.client.request({
            method: "GET",
            path: "/brand"
        }).then(r => r as BrandContext)
    })

    const handleUpload = async (e: Event) => {
        // Stub for upload
        alert("Upload implemented in next step (Requires Multipart support)")
    }

    const handleApprove = async () => {
        if (!confirm("Are you sure? This will lock the brand context.")) return
        await server.client.request({
            method: "POST",
            path: "/brand/approve"
        })
        refetch()
    }

    const handleInitialize = async () => {
        await server.client.request({
            method: "POST",
            path: "/brand",
            body: { name: params.dir }
        })
        refetch()
    }

    return (
        <div class="flex flex-col h-full bg-bg-base overflow-y-auto p-8 gap-8">
            <div class="flex justify-between items-center">
                <div>
                    <h1 class="text-2xl font-bold text-text-primary">Brand Ground Truth</h1>
                    <p class="text-text-weak">Phase 1: Brand Ingestion & Understanding</p>
                </div>
                <div class="flex gap-2">
                    <Show when={brand()?.status === "pending" || brand()?.status === "ready"}>
                        <Button variant="primary" onClick={handleApprove}>Confirm & Lock Brand</Button>
                    </Show>
                    <Show when={brand()?.status === "approved"}>
                        <div class="px-3 py-1 bg-green-500/10 text-green-500 rounded font-mono text-sm border border-green-500/20">
                            LOCKED & APPROVED
                        </div>
                    </Show>
                </div>
            </div>

            <Suspense fallback={<div>Loading context...</div>}>
                <Show when={brand()} fallback={
                    <div class="flex flex-col items-center justify-center p-20 border-2 border-dashed border-border-base rounded-lg gap-4">
                        <p>No Brand Context Found for {params.dir}</p>
                        <Button onClick={handleInitialize}>Initialize Brand Layer</Button>
                    </div>
                }>
                    {/* Identity Analysis Section */}
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <Card class="p-6 flex flex-col gap-4">
                            <h3 class="font-bold text-text-weak uppercase text-sm tracking-wider">Visual Identity</h3>
                            <div class="flex gap-2 flex-wrap">
                                <For each={brand()?.primaryColors}>
                                    {(color) => (
                                        <div class="size-12 rounded-full border border-border-base shadow-sm" style={{ "background-color": color }} title={color} />
                                    )}
                                </For>
                                <Show when={brand()?.primaryColors.length === 0}>
                                    <p class="text-sm text-text-weak italic">No colors extracted yet.</p>
                                </Show>
                            </div>
                        </Card>

                        <Card class="p-6 flex flex-col gap-4">
                            <h3 class="font-bold text-text-weak uppercase text-sm tracking-wider">Brand Tone</h3>
                            <div class="flex gap-2 flex-wrap">
                                <For each={brand()?.tone}>
                                    {(tone) => (
                                        <span class="px-2 py-1 bg-bg-surface border border-border-base rounded text-sm">{tone}</span>
                                    )}
                                </For>
                                <Show when={brand()?.tone.length === 0}>
                                    <p class="text-sm text-text-weak italic">No tone analysis yet.</p>
                                </Show>
                            </div>
                        </Card>

                        <Card class="p-6 flex flex-col gap-4">
                            <h3 class="font-bold text-text-weak uppercase text-sm tracking-wider">Patterns</h3>
                            <ul class="list-disc list-inside text-sm text-text-secondary">
                                <For each={brand()?.visualPatterns}>
                                    {(pattern) => <li>{pattern}</li>}
                                </For>
                                <Show when={brand()?.visualPatterns.length === 0}>
                                    <p class="text-sm text-text-weak italic">No patterns detected.</p>
                                </Show>
                            </ul>
                        </Card>
                    </div>

                    {/* Assets Section */}
                    <div class="flex flex-col gap-4">
                        <h2 class="text-xl font-semibold">Assets & Ingestion</h2>
                        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                            {/* Upload Card */}
                            <div class="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-border-base rounded-lg hover:bg-bg-surface cursor-pointer transition-colors"
                                onClick={() => document.getElementById("file-upload")?.click()}>
                                <span class="text-4xl text-text-weak">+</span>
                                <span class="text-sm text-text-weak mt-2">Upload Asset</span>
                                <input type="file" id="file-upload" class="hidden" multiple onChange={handleUpload} />
                            </div>

                            <For each={brand()?.assets}>
                                {(asset) => (
                                    <Card class="aspect-square relative group overflow-hidden">
                                        <img src={asset.path} class="size-full object-cover" />
                                        <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                                            <p class="text-white text-xs truncate">{asset.filename}</p>
                                        </div>
                                    </Card>
                                )}
                            </For>
                        </div>
                    </div>
                </Show>
            </Suspense>
        </div>
    )
}
