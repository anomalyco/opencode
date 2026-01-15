/**
 * Component Props Contracts
 *
 * This file defines the prop interfaces for all MCP Connectors UI components.
 * Used for type safety and component API documentation.
 *
 * @package @opencode-ai/app
 * @version 1.0.0
 */

import type { McpServer } from './mcp-connectors-context-api';

// ============================================================================
// McpConnectorsSection Component
// ============================================================================

/**
 * Props for the main Connectors section component
 *
 * Component: packages/app/src/components/mcp-connectors-section.tsx
 */
export interface McpConnectorsSectionProps {
  /**
   * Optional CSS class name for styling
   */
  class?: string;

  /**
   * Optional: Override default position
   * @default "bottom-right"
   */
  position?: 'bottom-right' | 'bottom-left' | 'sidebar';

  /**
   * Optional: Disable all interactions (read-only mode)
   * @default false
   */
  readonly?: boolean;
}

// ============================================================================
// McpConnectorItem Component
// ============================================================================

/**
 * Props for individual connector list item component
 *
 * Component: packages/app/src/components/mcp-connector-item.tsx
 */
export interface McpConnectorItemProps {
  /**
   * Server name (unique identifier)
   */
  name: string;

  /**
   * Server configuration object
   */
  server: McpServer;

  /**
   * Callback when edit button is clicked
   */
  onEdit?: (name: string) => void;

  /**
   * Callback when remove button is clicked
   */
  onRemove?: (name: string) => void;

  /**
   * Optional: Show sensitive environment variables
   * @default false (masked)
   */
  showSensitiveData?: boolean;

  /**
   * Optional: Highlight this item (e.g., after recent add/edit)
   * @default false
   */
  highlighted?: boolean;

  /**
   * Optional CSS class name
   */
  class?: string;
}

// ============================================================================
// McpConnectorForm Component
// ============================================================================

/**
 * Form mode type
 */
export type FormMode = 'add' | 'edit';

/**
 * Form data type (for add/edit operations)
 */
export interface ConnectorFormData {
  /** Server name */
  name: string;

  /** Command to execute */
  command: string;

  /** Command arguments (one per line in UI) */
  args: string[];

  /** Environment variables */
  env: Record<string, string>;
}

/**
 * Props for add/edit connector form dialog component
 *
 * Component: packages/app/src/components/mcp-connector-form.tsx
 */
export interface McpConnectorFormProps {
  /**
   * Form mode: add new or edit existing
   */
  mode: FormMode;

  /**
   * Dialog open state (controlled)
   */
  open: boolean;

  /**
   * Callback when dialog should close
   */
  onClose: () => void;

  /**
   * Callback when form is submitted with valid data
   */
  onSubmit: (data: ConnectorFormData) => void | Promise<void>;

  /**
   * Optional: Initial form data (for edit mode)
   */
  initialData?: Partial<ConnectorFormData>;

  /**
   * Optional: Existing server names (for duplicate validation)
   */
  existingNames?: string[];

  /**
   * Optional: Show advanced options (inputs section)
   * @default false
   */
  showAdvancedOptions?: boolean;
}

// ============================================================================
// Confirmation Dialog Component
// ============================================================================

/**
 * Props for delete confirmation dialog
 *
 * Component: Reuses @kobalte/core Dialog with custom content
 */
export interface DeleteConfirmDialogProps {
  /**
   * Dialog open state
   */
  open: boolean;

  /**
   * Server name being deleted (for display)
   */
  serverName: string;

  /**
   * Callback when delete is confirmed
   */
  onConfirm: () => void;

  /**
   * Callback when delete is cancelled
   */
  onCancel: () => void;
}

// ============================================================================
// Raw JSON Editor Component (P4 Feature)
// ============================================================================

/**
 * Props for raw JSON editor dialog
 *
 * Component: packages/app/src/components/mcp-json-editor.tsx (future)
 */
export interface McpJsonEditorProps {
  /**
   * Dialog open state
   */
  open: boolean;

  /**
   * Initial JSON string to edit
   */
  initialJson: string;

  /**
   * Callback when save is clicked with valid JSON
   */
  onSave: (json: string) => void | Promise<void>;

  /**
   * Callback when cancel is clicked
   */
  onCancel: () => void;

  /**
   * Optional: Read-only mode
   * @default false
   */
  readonly?: boolean;
}

// ============================================================================
// Env Var Input Component
// ============================================================================

/**
 * Props for environment variable key-value input component
 *
 * Component: Internal to McpConnectorForm
 */
export interface EnvVarInputProps {
  /**
   * Current environment variables object
   */
  value: Record<string, string>;

  /**
   * Callback when env vars change
   */
  onChange: (env: Record<string, string>) => void;

  /**
   * Optional: Show warning for sensitive-looking keys
   * @default true
   */
  showSensitiveWarnings?: boolean;

  /**
   * Optional: Read-only mode
   * @default false
   */
  readonly?: boolean;
}

/**
 * Individual env var entry (for form state)
 */
export interface EnvVarEntry {
  id: string;  // Unique ID for Solid.js keying
  key: string;
  value: string;
}

// ============================================================================
// Args Array Input Component
// ============================================================================

/**
 * Props for command arguments array input component
 *
 * Component: Internal to McpConnectorForm
 */
export interface ArgsArrayInputProps {
  /**
   * Current arguments array
   */
  value: string[];

  /**
   * Callback when args change
   */
  onChange: (args: string[]) => void;

  /**
   * Optional: Placeholder text for input
   * @default "Add argument..."
   */
  placeholder?: string;

  /**
   * Optional: Read-only mode
   * @default false
   */
  readonly?: boolean;
}

// ============================================================================
// Usage Examples in Components
// ============================================================================

/*

Example 1: Using McpConnectorsSection
--------------------------------------

import { McpConnectorsSection } from '@/components/mcp-connectors-section'

export function SessionView() {
  return (
    <div class="flex h-full">
      <div class="flex-1">
        {/* Main content *\/}
      </div>

      <McpConnectorsSection class="w-80 border-l" />
    </div>
  )
}


Example 2: Using McpConnectorItem
----------------------------------

import { McpConnectorItem } from '@/components/mcp-connector-item'
import { useMcpConnectors } from '@/context/mcp-connectors'

export function ConnectorsList() {
  const connectors = useMcpConnectors()
  const [editingName, setEditingName] = createSignal<string | null>(null)

  return (
    <For each={connectors.getServerNames()}>
      {(name) => {
        const server = connectors.getServer(name)!
        return (
          <McpConnectorItem
            name={name}
            server={server}
            onEdit={(name) => setEditingName(name)}
            onRemove={async (name) => {
              if (confirm(`Delete ${name}?`)) {
                await connectors.removeServer(name)
              }
            }}
          />
        )
      }}
    </For>
  )
}


Example 3: Using McpConnectorForm (Add mode)
---------------------------------------------

import { McpConnectorForm } from '@/components/mcp-connector-form'
import { useMcpConnectors } from '@/context/mcp-connectors'

export function AddConnectorButton() {
  const [isOpen, setIsOpen] = createSignal(false)
  const connectors = useMcpConnectors()

  const handleSubmit = async (data: ConnectorFormData) => {
    const result = await connectors.addServer(data.name, {
      command: data.command,
      args: data.args,
      env: data.env
    })

    if (result.success) {
      setIsOpen(false)
    } else {
      alert(result.error)
    }
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>
        Add Connector
      </Button>

      <McpConnectorForm
        mode="add"
        open={isOpen()}
        onClose={() => setIsOpen(false)}
        onSubmit={handleSubmit}
        existingNames={connectors.getServerNames()}
      />
    </>
  )
}


Example 4: Using McpConnectorForm (Edit mode)
----------------------------------------------

export function EditConnectorButton(props: { name: string }) {
  const [isOpen, setIsOpen] = createSignal(false)
  const connectors = useMcpConnectors()

  const server = () => connectors.getServer(props.name)

  const handleSubmit = async (data: ConnectorFormData) => {
    // Handle rename if name changed
    if (data.name !== props.name) {
      await connectors.renameServer(props.name, data.name)
    }

    await connectors.updateServer(data.name, {
      command: data.command,
      args: data.args,
      env: data.env
    })

    setIsOpen(false)
  }

  return (
    <>
      <IconButton onClick={() => setIsOpen(true)}>
        <EditIcon />
      </IconButton>

      <McpConnectorForm
        mode="edit"
        open={isOpen()}
        onClose={() => setIsOpen(false)}
        onSubmit={handleSubmit}
        initialData={{
          name: props.name,
          command: server()?.command || '',
          args: server()?.args || [],
          env: server()?.env || {}
        }}
        existingNames={connectors.getServerNames().filter(n => n !== props.name)}
      />
    </>
  )
}


Example 5: Using EnvVarInput
-----------------------------

import { EnvVarInput } from '@/components/mcp-connector-form'

export function MyForm() {
  const [env, setEnv] = createSignal<Record<string, string>>({})

  return (
    <div>
      <label>Environment Variables</label>
      <EnvVarInput
        value={env()}
        onChange={setEnv}
        showSensitiveWarnings={true}
      />
    </div>
  )
}

*/
