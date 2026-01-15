# Feature Specification: MCP Connectors Management

**Feature Branch**: `004-mcp-connectors`
**Created**: 2026-01-15
**Status**: Draft
**Input**: User description: "im desktop app i want to create a "Connectors" section on the bottom right hand corner that allows you to manage ".mcp.json" file inside the folder. Here's some sample:
{
    "inputs": [
        // The "inputs" section defines the inputs required for the MCP server configuration.
        {
            "type": "promptString"
        }
    ],
    "servers": {
        "serper-search": {
            "command": "npx",
            "args": [
                "-y",
                "serper-search-scrape-mcp-server"
            ],
            "env": {
                "SERPER_API_KEY": "54c4877533593aa77844c11e9fab1ac9da18f649"
            }
        },
        "mobile-mcp": {
        "command": "npx",
        "args": ["-y", "@mobilenext/mobile-mcp@latest"]
        }
    }
}

and the system should init an empty one if not exist"

## User Scenarios & Testing

### User Story 1 - View MCP Server Connectors (Priority: P1)

As a user, when I open the desktop app, I want to see a "Connectors" section in the bottom right corner that displays all configured MCP servers from the `.mcp.json` file in my current workspace folder, so I can quickly understand which integrations are available.

**Why this priority**: This is the foundation - users must first be able to see their connectors before managing them. Without visibility, no other connector management is possible.

**Independent Test**: Can be fully tested by opening the app with an existing `.mcp.json` file and verifying the Connectors section displays the server list, and delivers immediate value by showing configured integrations.

**Acceptance Scenarios**:

1. **Given** a workspace folder with a valid `.mcp.json` file containing configured servers, **When** the user opens the app, **Then** the Connectors section displays a list of all server names (e.g., "serper-search", "mobile-mcp")
2. **Given** a workspace folder without a `.mcp.json` file, **When** the user opens the app, **Then** the system automatically creates an empty `.mcp.json` file with default structure and displays an empty Connectors section
3. **Given** the Connectors section is displayed, **When** the user views it, **Then** each connector shows its name and key configuration details (command type)

---

### User Story 2 - Add New MCP Server Connector (Priority: P2)

As a user, I want to add new MCP server connectors through the Connectors section, so I can extend my workspace with additional integrations without manually editing JSON files.

**Why this priority**: After visibility, adding new connectors is the most critical management action. This enables users to expand functionality.

**Independent Test**: Can be tested by using the add connector interface to create a new server entry and verifying it persists to `.mcp.json` and appears in the list.

**Acceptance Scenarios**:

1. **Given** the Connectors section is open, **When** the user clicks "Add Connector", **Then** a form appears requesting server name, command, and arguments
2. **Given** the add connector form is displayed, **When** the user fills in valid server details and submits, **Then** the new connector appears in the list and is saved to `.mcp.json`
3. **Given** the add connector form is displayed, **When** the user provides environment variables (e.g., API keys), **Then** these are saved in the server's "env" configuration
4. **Given** the add connector form is displayed, **When** the user cancels, **Then** no changes are made to `.mcp.json`

---

### User Story 3 - Edit Existing MCP Server Connector (Priority: P3)

As a user, I want to modify existing MCP server configurations (update commands, args, or environment variables) through the Connectors section, so I can adjust integrations without manual file editing.

**Why this priority**: Editing is less critical than viewing and adding, as users can initially work around it by manually editing the file if needed.

**Independent Test**: Can be tested by selecting an existing connector, modifying its configuration, and verifying changes persist to `.mcp.json`.

**Acceptance Scenarios**:

1. **Given** a connector is displayed in the list, **When** the user clicks "Edit" on a connector, **Then** a form appears pre-filled with the current configuration
2. **Given** the edit form is displayed, **When** the user modifies any fields and saves, **Then** the changes are persisted to `.mcp.json` and reflected in the list
3. **Given** the edit form is displayed, **When** the user modifies environment variables, **Then** the updated values are saved securely

---

### User Story 4 - Remove MCP Server Connector (Priority: P3)

As a user, I want to remove MCP server connectors I no longer need, so I can keep my workspace configuration clean and relevant.

**Why this priority**: Removal is a maintenance action that's important but not critical for initial functionality.

**Independent Test**: Can be tested by deleting a connector and verifying it's removed from both the UI and `.mcp.json`.

**Acceptance Scenarios**:

1. **Given** a connector is displayed in the list, **When** the user clicks "Remove" on a connector, **Then** a confirmation dialog appears
2. **Given** the confirmation dialog is displayed, **When** the user confirms deletion, **Then** the connector is removed from the list and deleted from `.mcp.json`
3. **Given** the confirmation dialog is displayed, **When** the user cancels, **Then** no changes are made

---

### User Story 5 - Manage Input Configurations (Priority: P4)

As a user, I want to configure the "inputs" section of the `.mcp.json` file through the Connectors UI, so I can define what inputs are required for MCP server configuration.

**Why this priority**: This is an advanced feature that most users may not need to modify frequently. The default "promptString" input type covers common use cases.

**Independent Test**: Can be tested by adding/modifying input configurations and verifying they persist to the "inputs" array in `.mcp.json`.

**Acceptance Scenarios**:

1. **Given** the Connectors section is open, **When** the user accesses input configuration settings, **Then** they can view the current inputs array
2. **Given** the input configuration view is displayed, **When** the user adds a new input type, **Then** it's added to the "inputs" array in `.mcp.json`

---

### Edge Cases

- What happens when the `.mcp.json` file contains invalid JSON syntax?
- What happens when the `.mcp.json` file has incorrect schema (missing required fields)?
- What happens when a user tries to add a connector with a duplicate server name?
- What happens when the workspace folder is read-only and `.mcp.json` cannot be created or modified?
- What happens when environment variables contain sensitive data (API keys)?
- What happens when the `.mcp.json` file is modified externally while the app is open?
- What happens when a user provides invalid command paths or arguments?

## Requirements

### Functional Requirements

- **FR-001**: System MUST display a "Connectors" section in the bottom right corner of the desktop app interface
- **FR-002**: System MUST read and parse the `.mcp.json` file from the current workspace folder on app launch
- **FR-003**: System MUST automatically create an empty `.mcp.json` file with default structure if one doesn't exist in the workspace folder
- **FR-004**: System MUST display all configured MCP servers from the `.mcp.json` file in the Connectors section
- **FR-005**: Users MUST be able to add new MCP server connectors by providing server name, command, arguments, and optional environment variables
- **FR-006**: Users MUST be able to edit existing MCP server connector configurations
- **FR-007**: Users MUST be able to remove MCP server connectors with confirmation
- **FR-008**: System MUST persist all connector changes (add, edit, delete) to the `.mcp.json` file immediately
- **FR-009**: System MUST validate JSON structure before saving to prevent file corruption
- **FR-010**: System MUST handle `.mcp.json` file read/write errors gracefully with user-friendly error messages
- **FR-011**: System MUST support the `.mcp.json` schema including "inputs" and "servers" sections
- **FR-012**: System MUST allow users to configure environment variables for each server (stored in the "env" object)
- **FR-013**: System MUST allow users to configure the "inputs" section of `.mcp.json`
- **FR-014**: System MUST display the current state of each connector (e.g., command, args summary)
- **FR-015**: System MUST prevent duplicate server names when adding or editing connectors
- **FR-016**: System MUST handle concurrent file modifications (detect external changes to `.mcp.json`)

### Key Entities

- **MCP Configuration File**: Represents the `.mcp.json` file containing inputs array and servers object; located in workspace folder root
- **MCP Server**: Represents a configured integration service with attributes: name (unique identifier), command (executable), args (array of command arguments), env (object of environment variables)
- **Input Definition**: Represents an input requirement for MCP server configuration with attributes: type (e.g., "promptString")
- **Workspace Folder**: The current working directory containing the `.mcp.json` file

## Success Criteria

### Measurable Outcomes

- **SC-001**: Users can view all configured MCP servers within 2 seconds of opening the app
- **SC-002**: Users can add a new MCP server connector in under 1 minute
- **SC-003**: Users can edit an existing connector configuration in under 30 seconds
- **SC-004**: 100% of valid connector changes are successfully persisted to `.mcp.json` without data loss
- **SC-005**: System prevents 100% of invalid JSON structures from being saved
- **SC-006**: Users can complete all connector management tasks (view, add, edit, remove) without needing to manually edit the `.mcp.json` file
- **SC-007**: System successfully creates a default `.mcp.json` file in 100% of cases where one doesn't exist
- **SC-008**: 95% of users can locate and use the Connectors section without additional guidance

## Assumptions

- The `.mcp.json` file follows the structure shown in the user's example with "inputs" and "servers" sections
- The workspace folder is determined by the app's current working directory context
- Users have read/write permissions to the workspace folder
- The default empty `.mcp.json` structure includes an empty "inputs" array and empty "servers" object
- MCP servers use standard command-line execution patterns (npx, node, etc.)
- Environment variables are stored as plain text in the configuration file
- The Connectors section is visible by default when the app opens
- The "bottom right corner" refers to a panel or section in the app's layout, positioned in the lower-right quadrant

## Dependencies

- File system access to read/write `.mcp.json` in the workspace folder
- JSON parsing and validation capabilities
- UI framework supporting dynamic forms for connector management
- Workspace context to determine the current folder location
