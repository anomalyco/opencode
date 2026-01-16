/**
 * MCP Connector Form Component
 *
 * Dialog form for adding/editing MCP server connectors.
 * Feature: 004-mcp-connectors
 */

import { createSignal, createEffect, Show, For, on } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Select } from "@opencode-ai/ui/select"
import type { FormMode, ConnectorFormData } from "@/types/mcp-connectors"

// Common MCP server commands
const MCP_COMMANDS = [
	{ value: "npx", label: "npx", description: "Node.js packages (TypeScript/JavaScript servers)" },
	{ value: "node", label: "node", description: "Node.js runtime" },
	{ value: "uvx", label: "uvx", description: "Python packages (uv package manager)" },
	{ value: "python", label: "python", description: "Python runtime" },
	{ value: "python3", label: "python3", description: "Python 3 runtime" },
	{ value: "docker", label: "docker", description: "Docker containers" },
	{ value: "bunx", label: "bunx", description: "Bun packages" },
] as const

type McpCommand = (typeof MCP_COMMANDS)[number]

export interface McpConnectorFormProps {
	mode: FormMode
	open: boolean
	onClose: () => void
	onSubmit: (data: ConnectorFormData) => void | Promise<void>
	initialData?: Partial<ConnectorFormData>
	existingNames?: string[]
	showAdvancedOptions?: boolean
}

export function McpConnectorForm(props: McpConnectorFormProps) {
	const dialog = useDialog()
	const [formData, setFormData] = createSignal<ConnectorFormData>({
		name: props.initialData?.name || "",
		command: props.initialData?.command || "",
		args: props.initialData?.args || [],
		env: props.initialData?.env || {},
	})

	const [errors, setErrors] = createSignal<Record<string, string>>({})
	const [isSubmitting, setIsSubmitting] = createSignal(false)

	// Validate form
	function validate(): boolean {
		const data = formData()
		const newErrors: Record<string, string> = {}

		// Server name validation
		if (!data.name.trim()) {
			newErrors.name = "Server name is required"
		} else if (
			props.existingNames?.includes(data.name) &&
			data.name !== props.initialData?.name
		) {
			newErrors.name = "Server name already exists"
		}

		// Command validation
		if (!data.command.trim()) {
			newErrors.command = "Command is required"
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	// Handle form submit
	async function handleSubmit(e: Event) {
		e.preventDefault()

		if (!validate()) {
			return
		}

		setIsSubmitting(true)
		try {
			await props.onSubmit(formData())
			dialog.close()
			props.onClose()
		} catch (error) {
			setErrors({ submit: error instanceof Error ? error.message : "Failed to save connector" })
		} finally {
			setIsSubmitting(false)
		}
	}

	// Update form field
	function updateField<K extends keyof ConnectorFormData>(
		field: K,
		value: ConnectorFormData[K]
	) {
		setFormData((prev) => ({ ...prev, [field]: value }))
		// Clear error for this field
		if (errors()[field]) {
			setErrors((prev) => {
				const { [field]: _, ...rest } = prev
				return rest
			})
		}
	}

	// Track when dialog should be shown/hidden - use `on` to prevent tracking inner signals
	createEffect(on(() => props.open, (isOpen) => {
		if (isOpen) {
			// Reset form state when opening
			setFormData({
				name: props.initialData?.name || "",
				command: props.initialData?.command || "",
				args: props.initialData?.args || [],
				env: props.initialData?.env || {},
			})
			setErrors({})
			setIsSubmitting(false)

			// Show dialog with form content component
			dialog.show(() => (
				<ConnectorFormDialog
					mode={props.mode}
					formData={formData}
					setFormData={setFormData}
					errors={errors}
					setErrors={setErrors}
					isSubmitting={isSubmitting}
					handleSubmit={handleSubmit}
					updateField={updateField}
					onClose={() => { dialog.close(); props.onClose(); }}
				/>
			))
		}
	}))

	// Component returns null - dialog is shown via service
	return null
}

// ============================================================================
// Form Dialog Content Component
// ============================================================================

interface ConnectorFormDialogProps {
	mode: FormMode
	formData: () => ConnectorFormData
	setFormData: (fn: (prev: ConnectorFormData) => ConnectorFormData) => void
	errors: () => Record<string, string>
	setErrors: (fn: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void
	isSubmitting: () => boolean
	handleSubmit: (e: Event) => Promise<void>
	updateField: <K extends keyof ConnectorFormData>(field: K, value: ConnectorFormData[K]) => void
	onClose: () => void
}

function ConnectorFormDialog(props: ConnectorFormDialogProps) {
	return (
		<Dialog
			title={props.mode === "add" ? "Add Connector" : "Edit Connector"}
			description={props.mode === "add"
				? "Configure a new MCP server connector"
				: "Update the MCP server connector configuration"}
		>
			<form onSubmit={props.handleSubmit} class="space-y-4">
				{/* Server Name Field */}
				<TextField
					label="Server Name"
					value={props.formData().name}
					onInput={(e) => props.updateField("name", e.currentTarget.value)}
					required
					placeholder="e.g., serper-search"
					disabled={props.isSubmitting()}
				/>
				<Show when={props.errors().name}>
					<div class="text-xs text-danger-base mt-1">{props.errors().name}</div>
				</Show>

				{/* Command Field */}
				<div class="space-y-2">
					<label class="block text-sm font-medium text-text-base">
						Command <span class="text-danger-base">*</span>
					</label>
					<Select<McpCommand>
						options={[...MCP_COMMANDS]}
						current={MCP_COMMANDS.find((c) => c.value === props.formData().command)}
						value={(c) => c.value}
						label={(c) => `${c.label} — ${c.description}`}
						placeholder="Select a command..."
						onSelect={(cmd) => {
							if (cmd) props.updateField("command", cmd.value)
						}}
						disabled={props.isSubmitting()}
						class="w-full"
						variant="secondary"
					/>
					<p class="text-xs text-text-weak">
						Common commands for running MCP servers
					</p>
				</div>
				<Show when={props.errors().command}>
					<div class="text-xs text-danger-base mt-1">{props.errors().command}</div>
				</Show>

				{/* Arguments Section */}
				<div>
					<label class="block text-sm font-medium text-text-base mb-2">
						Arguments (optional)
					</label>
					<ArgsArrayInput
						value={props.formData().args}
						onChange={(args) => props.updateField("args", args)}
						readonly={props.isSubmitting()}
					/>
				</div>

				{/* Environment Variables Section */}
				<div>
					<label class="block text-sm font-medium text-text-base mb-2">
						Environment Variables (optional)
					</label>
					<EnvVarInput
						value={props.formData().env}
						onChange={(env) => props.updateField("env", env)}
						readonly={props.isSubmitting()}
					/>
				</div>

				{/* Submit Error */}
				<Show when={props.errors().submit}>
					<div class="px-3 py-2 bg-danger-surface text-danger-base text-sm rounded">
						{props.errors().submit}
					</div>
				</Show>

				{/* Form Actions */}
				<div class="flex gap-2 justify-end mt-4">
					<Button
						variant="ghost"
						onClick={props.onClose}
						disabled={props.isSubmitting()}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={props.isSubmitting()}>
						<Show when={props.isSubmitting()} fallback={props.mode === "add" ? "Add Connector" : "Save Changes"}>
							<Icon name="circle-check" class="animate-spin mr-2" size="small" />
							{props.mode === "add" ? "Adding..." : "Saving..."}
						</Show>
					</Button>
				</div>
			</form>
		</Dialog>
	)
}

// ============================================================================
// Helper Components
// ============================================================================

interface ArgsArrayInputProps {
	value: string[]
	onChange: (args: string[]) => void
	readonly?: boolean
	placeholder?: string
}

function ArgsArrayInput(props: ArgsArrayInputProps) {
	const [newArg, setNewArg] = createSignal("")

	function addArg() {
		const arg = newArg().trim()
		if (!arg) return

		props.onChange([...props.value, arg])
		setNewArg("")
	}

	function removeArg(index: number) {
		props.onChange(props.value.filter((_, i) => i !== index))
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault()
			addArg()
		}
	}

	return (
		<div class="space-y-2">
			{/* Existing Args List */}
			<Show when={props.value.length > 0}>
				<div class="space-y-1">
					<For each={props.value}>
						{(arg, index) => (
							<div class="flex items-center gap-2 px-3 py-2 bg-surface-base border border-border-base rounded">
								<code class="flex-1 text-sm text-text-base">{arg}</code>
								<IconButton
									icon="close"
									variant="ghost"
									onClick={() => removeArg(index())}
									disabled={props.readonly}
								/>
							</div>
						)}
					</For>
				</div>
			</Show>

			{/* Add New Arg Input */}
			<div class="flex gap-2">
				<TextField
					value={newArg()}
					onInput={(e) => setNewArg(e.currentTarget.value)}
					onKeyDown={handleKeyDown}
					placeholder={props.placeholder || "Add argument..."}
					disabled={props.readonly}
					class="flex-1"
				/>
				<Button onClick={addArg} disabled={!newArg().trim() || props.readonly} variant="secondary">
					Add
				</Button>
			</div>
		</div>
	)
}

interface EnvVarInputProps {
	value: Record<string, string>
	onChange: (env: Record<string, string>) => void
	readonly?: boolean
	showSensitiveWarnings?: boolean
}

interface EnvVarEntry {
	id: string
	key: string
	value: string
}

function EnvVarInput(props: EnvVarInputProps) {
	// Convert object to array for easier rendering
	const entries = (): EnvVarEntry[] => {
		return Object.entries(props.value).map(([key, value]) => ({
			id: key,
			key,
			value,
		}))
	}

	const [newKey, setNewKey] = createSignal("")
	const [newValue, setNewValue] = createSignal("")

	function isSensitiveKey(key: string): boolean {
		const sensitive = /api|key|token|secret|password|credential/i
		return sensitive.test(key)
	}

	function addEnvVar() {
		const key = newKey().trim()
		const value = newValue().trim()

		if (!key) return

		const newEnv = { ...props.value, [key]: value }
		props.onChange(newEnv)
		setNewKey("")
		setNewValue("")
	}

	function removeEnvVar(key: string) {
		const { [key]: _, ...rest } = props.value
		props.onChange(rest)
	}

	function updateEnvVar(oldKey: string, newKey: string, newValue: string) {
		const { [oldKey]: _, ...rest } = props.value
		props.onChange({ ...rest, [newKey]: newValue })
	}

	return (
		<div class="space-y-2">
			{/* Existing Env Vars List */}
			<Show when={entries().length > 0}>
				<div class="space-y-1">
					<For each={entries()}>
						{(entry) => (
							<div class="flex items-center gap-2 px-3 py-2 bg-surface-base border border-border-base rounded">
								<div class="flex-1 flex items-center gap-2">
									<code class="text-sm font-medium text-text-base">{entry.key}</code>
									<span class="text-text-weakest">=</span>
									<code class="flex-1 text-sm text-text-weak truncate">
										{entry.value || '""'}
									</code>
									<Show when={isSensitiveKey(entry.key)}>
										<span class="text-xs text-warning-base" title="Sensitive value">(sensitive)</span>
									</Show>
								</div>
								<IconButton
									icon="close"
									variant="ghost"
									onClick={() => removeEnvVar(entry.key)}
									disabled={props.readonly}
								/>
							</div>
						)}
					</For>
				</div>
			</Show>

			{/* Add New Env Var Inputs */}
			<div class="flex gap-2">
				<TextField
					value={newKey()}
					onInput={(e) => setNewKey(e.currentTarget.value)}
					placeholder="KEY"
					disabled={props.readonly}
					class="flex-1"
				/>
				<TextField
					value={newValue()}
					onInput={(e) => setNewValue(e.currentTarget.value)}
					placeholder="value"
					disabled={props.readonly}
					class="flex-1"
				/>
				<Button onClick={addEnvVar} disabled={!newKey().trim() || props.readonly} variant="secondary">
					Add
				</Button>
			</div>

			{/* Sensitive Key Warning */}
			<Show when={newKey().trim() && isSensitiveKey(newKey())}>
				<div class="flex items-start gap-2 px-3 py-2 bg-warning-surface text-warning-base text-xs rounded">
					<span class="mt-0.5">(sensitive)</span>
					<div>
						This looks like a sensitive value (API key, token, etc.). Make sure you trust this
						MCP server with this credential.
					</div>
				</div>
			</Show>
		</div>
	)
}
