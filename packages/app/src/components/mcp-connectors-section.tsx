/**
 * MCP Connectors Section Component
 *
 * Main container for displaying and managing MCP server connectors.
 * Feature: 004-mcp-connectors
 */

import { Show, For, Match, Switch, createSignal } from "solid-js"
import { useMcpConnectors } from "@/context/mcp-connectors"
import { useLayout } from "@/context/layout"
import { McpConnectorItem } from "./mcp-connector-item"
import { McpConnectorForm } from "./mcp-connector-form"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { showToast } from "@opencode-ai/ui/toast"
import type { ConnectorFormData } from "@/types/mcp-connectors"

export interface McpConnectorsSectionProps {
	/** Optional CSS class name */
	class?: string
}

export function McpConnectorsSection(props: McpConnectorsSectionProps) {
	const connectors = useMcpConnectors()
	const layout = useLayout()
	const dialog = useDialog()

	const serverNames = () => connectors.getServerNames()
	const serverCount = () => connectors.getServerCount()

	// Form state
	const [isFormOpen, setIsFormOpen] = createSignal(false)
	const [editingName, setEditingName] = createSignal<string | null>(null)

	// Delete confirmation state
	const [deletingName, setDeletingName] = createSignal<string | null>(null)

	const formMode = () => (editingName() ? "edit" : "add")
	const initialFormData = () => {
		const name = editingName()
		if (!name) return undefined

		const server = connectors.getServer(name)
		if (!server) return undefined

		return {
			name,
			command: server.command,
			args: server.args || [],
			env: server.env || {},
		}
	}

	// Handle add connector
	async function handleAddConnector(data: ConnectorFormData) {
		const result = await connectors.addServer(data.name, {
			command: data.command,
			args: data.args,
			env: data.env,
		})

		if (result.success) {
			showToast({ title: `Connector "${data.name}" added successfully`, variant: "success" })
			setIsFormOpen(false)
		} else {
			throw new Error(result.error || "Failed to add connector")
		}
	}

	// Handle edit connector
	async function handleEditConnector(data: ConnectorFormData) {
		const oldName = editingName()
		if (!oldName) return

		// Handle rename if name changed
		if (data.name !== oldName) {
			const renameResult = await connectors.renameServer(oldName, data.name)
			if (!renameResult.success) {
				throw new Error(renameResult.error || "Failed to rename connector")
			}
		}

		// Update server config
		const result = await connectors.updateServer(data.name, {
			command: data.command,
			args: data.args,
			env: data.env,
		})

		if (result.success) {
			showToast({ title: `Connector "${data.name}" updated successfully`, variant: "success" })
			setIsFormOpen(false)
			setEditingName(null)
		} else {
			throw new Error(result.error || "Failed to update connector")
		}
	}

	// Handle form submit (add or edit)
	async function handleFormSubmit(data: ConnectorFormData) {
		if (formMode() === "edit") {
			return handleEditConnector(data)
		} else {
			return handleAddConnector(data)
		}
	}

	// Handle edit button click
	function handleEdit(name: string) {
		setEditingName(name)
		setIsFormOpen(true)
	}

	// Handle form close
	function handleFormClose() {
		setIsFormOpen(false)
		setEditingName(null)
	}

	// Handle remove button click
	function handleRemove(name: string) {
		setDeletingName(name)
		dialog.show(() => (
			<Dialog
				title="Remove Connector"
				description={`Are you sure you want to remove the connector "${name}"? This action cannot be undone.`}
			>
				<div class="flex gap-2 justify-end mt-4">
					<Button variant="ghost" onClick={() => { dialog.close(); setDeletingName(null); }}>
						Cancel
					</Button>
					<Button variant="primary" onClick={async () => {
						const result = await connectors.removeServer(name)
						if (result.success) {
							showToast({ title: `Connector "${name}" removed successfully`, variant: "success" })
							dialog.close()
							setDeletingName(null)
						} else {
							showToast({ title: result.error || "Failed to remove connector", variant: "error" })
						}
					}}>
						Remove
					</Button>
				</div>
			</Dialog>
		))
	}

	return (
		<Show when={layout.connectors.opened()}>
			<div class={`border-t border-border-weak-base ${props.class || ""}`}>
				<Collapsible
					variant="ghost"
					class="w-full"
					defaultOpen={!layout.connectors.collapsed()}
					onOpenChange={(isOpen) => layout.connectors.setCollapsed(!isOpen)}
				>
					<Collapsible.Trigger class="w-full px-3 py-2 flex items-center justify-between text-sm font-medium text-text-base hover:bg-surface-secondary-base">
						<span>Connectors</span>
						<div class="flex items-center gap-2">
							<span class="text-xs text-text-weak">({serverCount()})</span>
							<IconButton
								icon="plus-small"
								variant="ghost"
								onClick={(e) => {
									e.stopPropagation()
									setIsFormOpen(true)
								}}
								title="Add connector"
							/>
						</div>
					</Collapsible.Trigger>
					<Collapsible.Content>
						<div class="px-2 pb-2">
							<Switch>
								{/* Loading State */}
								<Match when={connectors.isLoading()}>
									<div class="flex items-center justify-center py-4 text-text-weak">
										<Icon name="circle-check" class="animate-spin mr-2" size="small" />
										<span class="text-sm">Loading connectors...</span>
									</div>
								</Match>

								{/* Error State */}
								<Match when={connectors.error()}>
									<div class="px-3 py-4 text-sm text-danger-base">
										<div class="flex items-start gap-2">
											<Icon name="circle-x" size="small" class="mt-0.5" />
											<div>
												<div class="font-medium">Failed to load connectors</div>
												<div class="text-xs text-text-weak mt-1">{connectors.error()}</div>
											</div>
										</div>
									</div>
								</Match>

								{/* Empty State */}
								<Match when={serverCount() === 0}>
									<div class="px-3 py-6 text-center text-sm text-text-weak">
										<div class="mb-2">No connectors configured</div>
										<div class="text-xs text-text-weakest">
											Add MCP servers to .mcp.json
										</div>
									</div>
								</Match>

								{/* Connector List */}
								<Match when={serverCount() > 0}>
									<For each={serverNames()}>
										{(name) => {
											const server = connectors.getServer(name)
											return (
												<Show when={server}>
													<McpConnectorItem
														name={name}
														server={server!}
														onEdit={handleEdit}
														onRemove={handleRemove}
													/>
												</Show>
											)
										}}
									</For>
								</Match>
							</Switch>
						</div>
					</Collapsible.Content>
				</Collapsible>
			</div>

			{/* Add/Edit Connector Form Dialog */}
			<McpConnectorForm
				mode={formMode()}
				open={isFormOpen()}
				onClose={handleFormClose}
				onSubmit={handleFormSubmit}
				initialData={initialFormData()}
				existingNames={serverNames().filter((n) => n !== editingName())}
			/>

		</Show>
	)
}
