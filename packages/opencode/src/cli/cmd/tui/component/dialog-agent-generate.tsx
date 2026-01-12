import { createSignal } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"

export function DialogAgentGenerate() {
    const dialog = useDialog()
    const sdk = useSDK()
    const toast = useToast()
    const local = useLocal()
    const sync = useSync()

    const onAI = async () => {
        const description = await DialogPrompt.show(dialog, "Agent Description", {
            placeholder: "e.g., A Rust expert that focuses on memory safety and async patterns.",
        })
        if (!description) {
            dialog.clear()
            return
        }

        toast.show({ message: "Generating agent...", variant: "info" })
        try {
            if (!sdk.url) throw new Error("SDK URL is not initialized")
            const url = new URL("/agent/generate", sdk.url).toString()
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            }
            if (sdk.directory) {
                headers["x-opencode-directory"] = sdk.directory
            }

            const response = await sdk.fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({ description }),
            }).catch(err => {
                throw new Error(`Connection failed to ${url}: ${err.message}`)
            })

            if (!response.ok) throw new Error("Failed to generate agent")
            const generated = await response.json()

            const confirmed = await DialogConfirm.show(
                dialog,
                "Save Agent?",
                `Generated agent "${generated.identifier}".\n\nPrompt snippet: ${generated.systemPrompt.slice(0, 100)}...\n\nSave to .opencode/agents/${generated.identifier}.md?`,
            )

            if (confirmed) {
                const saveUrl = new URL("/agent/save", sdk.url).toString()
                const saveResponse = await sdk.fetch(saveUrl, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        name: generated.identifier,
                        description: generated.whenToUse,
                        systemPrompt: generated.systemPrompt,
                    }),
                }).catch(err => {
                    throw new Error(`Connection failed to ${saveUrl}: ${err.message}`)
                })

                if (!saveResponse.ok) throw new Error(`Failed to save agent: ${saveResponse.statusText}`)
                toast.show({ message: `Agent "${generated.identifier}" saved!`, variant: "success" })
                await sync.bootstrap()
            }
        } catch (e) {
            toast.error(e)
        } finally {
            dialog.clear()
        }
    }

    const onManual = async () => {
        const name = await DialogPrompt.show(dialog, "Agent Name", {
            placeholder: "e.g., rust-expert",
        })
        if (!name) {
            dialog.clear()
            return
        }

        try {
            if (!sdk.url) throw new Error("SDK URL is not initialized")
            const url = new URL("/agent/save", sdk.url).toString()
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            }
            if (sdk.directory) {
                headers["x-opencode-directory"] = sdk.directory
            }

            const saveResponse = await sdk.fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    name,
                    systemPrompt: "# Role\n\nYou are a specialized agent...",
                }),
            }).catch(err => {
                throw new Error(`Connection failed to ${url}: ${err.message}`)
            })

            if (!saveResponse.ok) throw new Error(`Failed to save template: ${saveResponse.statusText}`)
            toast.show({ message: `Template saved to .opencode/agents/${name}.md`, variant: "success" })
            await sync.bootstrap()
        } catch (e) {
            toast.error(e)
        } finally {
            dialog.clear()
        }
    }

    return (
        <DialogSelect
            title="Create new agent"
            options={[
                {
                    value: "ai",
                    title: "AI Generated",
                    description: "Describe what you want and let the AI draft the system prompt.",
                },
                {
                    value: "manual",
                    title: "Manual (Template)",
                    description: "Create a blank Markdown file to define the agent yourself.",
                },
            ]}
            onSelect={(option) => {
                if (option.value === "ai") onAI()
                else onManual()
            }}
        />
    )
}
