/**
 * MCP Connector Item Component
 *
 * Displays a single connector with its name and command.
 * Feature: 004-mcp-connectors / User Story 1 (View)
 */

import { IconButton } from "@opencode-ai/ui/icon-button"
import type { McpServer } from "@/types/mcp-connectors"

export interface McpConnectorItemProps {
	/** Server name (unique identifier) */
	name: string

	/** Server configuration object */
	server: McpServer

	/** Callback when edit button is clicked */
	onEdit?: (name: string) => void

	/** Callback when remove button is clicked */
	onRemove?: (name: string) => void

	/** Optional CSS class name */
	class?: string
}

export function McpConnectorItem(props: McpConnectorItemProps) {
	return (
		<div class={`flex items-center justify-between px-3 py-2 rounded hover:bg-surface-secondary-base transition-colors group ${props.class || ""}`}>
			<div class="flex-1 min-w-0">
				<div class="font-medium text-sm text-text-base truncate">
					{props.name}
				</div>
				<div class="text-xs text-text-weak truncate">
					{props.server.command}
					{props.server.args && props.server.args.length > 0 && (
						<span class="ml-1 text-text-weakest">
							({props.server.args.length} arg{props.server.args.length !== 1 ? "s" : ""})
						</span>
					)}
				</div>
			</div>

			{/* Action Buttons - shown on hover */}
			<div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
				{props.onEdit && (
					<IconButton
						icon="pencil-line"
						variant="ghost"
						onClick={() => props.onEdit?.(props.name)}
						title="Edit connector"
					/>
				)}
				{props.onRemove && (
					<IconButton
						icon="close"
						variant="ghost"
						onClick={() => props.onRemove?.(props.name)}
						title="Remove connector"
					/>
				)}
			</div>
		</div>
	)
}
