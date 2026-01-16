# Feature Specification: Fix MCP Connectors API Alignment

**Feature Branch**: `006-fix-mcp-api-alignment`
**Created**: 2026-01-15
**Status**: Draft
**Input**: Fix MCP Connectors API alignment issues - resolve 52 TypeScript compilation errors across Dialog, Icon, Toast, File I/O, and Zod APIs

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View and Manage MCP Connectors (Priority: P1)

As a user, I want to open the application and see my configured MCP server connectors displayed in the settings panel, so that I can verify my integrations are properly configured.

**Why this priority**: This is the core functionality - if the app doesn't compile and render the connectors UI, no other MCP connector features work. The current 52 compilation errors completely block this functionality.

**Independent Test**: Can be fully tested by launching the application and navigating to the connectors section. Delivers value by allowing users to view their existing `.mcp.json` configuration.

**Acceptance Scenarios**:

1. **Given** the application compiles without TypeScript errors, **When** a user opens the settings panel, **Then** the MCP Connectors section is visible and renders correctly
2. **Given** a valid `.mcp.json` file exists in the workspace, **When** the connectors section loads, **Then** all configured connectors are displayed with their names and types
3. **Given** no `.mcp.json` file exists, **When** the connectors section loads, **Then** an empty state message is displayed indicating no connectors are configured

---

### User Story 2 - Add New MCP Connector (Priority: P2)

As a user, I want to add a new MCP server connector through a form dialog, so that I can integrate additional tools and services with my workspace.

**Why this priority**: Adding connectors is the primary write operation. Without the ability to add connectors, users cannot expand their MCP integrations.

**Independent Test**: Can be tested by clicking "Add Connector" button, filling out the form, and verifying the connector appears in the list and is persisted to `.mcp.json`.

**Acceptance Scenarios**:

1. **Given** the connectors section is displayed, **When** a user clicks "Add Connector", **Then** a form dialog appears with fields for connector configuration
2. **Given** the add connector form is open, **When** a user fills in valid details and clicks "Save", **Then** the connector is added to the list and saved to `.mcp.json`
3. **Given** the add connector form is open, **When** a user submits with missing required fields, **Then** validation errors are displayed for each missing field
4. **Given** the add connector form is open, **When** a user clicks "Cancel", **Then** the dialog closes without saving changes

---

### User Story 3 - Edit Existing MCP Connector (Priority: P3)

As a user, I want to edit an existing MCP connector's configuration, so that I can update settings like command arguments or environment variables without recreating the connector.

**Why this priority**: Editing is important for maintenance but less frequent than viewing or adding connectors.

**Independent Test**: Can be tested by clicking edit on an existing connector, modifying fields, saving, and verifying changes persist.

**Acceptance Scenarios**:

1. **Given** a connector exists in the list, **When** a user clicks the edit button, **Then** the form dialog opens pre-populated with the connector's current configuration
2. **Given** the edit form is open with changes, **When** a user clicks "Save", **Then** the connector is updated in the list and changes are persisted to `.mcp.json`

---

### User Story 4 - Remove MCP Connector (Priority: P4)

As a user, I want to remove an MCP connector with a confirmation step, so that I can declutter my configuration while being protected from accidental deletions.

**Why this priority**: Deletion is a destructive operation needed for maintenance but used less frequently than add/edit operations.

**Independent Test**: Can be tested by clicking remove, confirming in the dialog, and verifying the connector is removed from list and `.mcp.json`.

**Acceptance Scenarios**:

1. **Given** a connector exists in the list, **When** a user clicks the remove button, **Then** a confirmation dialog appears asking to confirm removal
2. **Given** the confirmation dialog is open, **When** a user confirms removal, **Then** the connector is removed from the list and deleted from `.mcp.json`
3. **Given** the confirmation dialog is open, **When** a user cancels, **Then** the dialog closes and the connector remains in the list

---

### Edge Cases

- What happens when the `.mcp.json` file contains invalid JSON? The system displays an error state with a message indicating the file is malformed.
- What happens when file write operations fail due to permissions? The system displays an error notification and the UI state remains unchanged.
- What happens when a user tries to add a connector with a duplicate server name? Validation prevents the duplicate and displays an error message.
- What happens when required fields are left empty in the form? Inline validation errors appear and form submission is blocked.

## Requirements *(mandatory)*

### Functional Requirements

**Compilation & Build**

- **FR-001**: System MUST compile without TypeScript errors after all API alignment fixes are applied
- **FR-002**: System MUST build successfully for development and production environments

**Dialog Components**

- **FR-003**: Add/Edit connector form MUST use the project's Dialog component with correct prop patterns (`title`, `description`, `action`)
- **FR-004**: Delete confirmation dialog MUST use the project's Dialog component and useDialog() hook for state management

**Icon Components**

- **FR-005**: All icon references MUST use icon names that exist in the project's icon set
- **FR-006**: IconButton components MUST NOT use `size="small"` as this variant does not exist

**File Operations**

- **FR-007**: File write operations MUST use the Tauri filesystem API (`writeTextFile`) instead of non-existent SDK methods
- **FR-008**: File operations MUST handle errors gracefully and display appropriate feedback to users

**Toast Notifications**

- **FR-009**: Success and error notifications MUST use the correct showToast() API signature

**Data Validation**

- **FR-010**: Zod validation error handling MUST use the correct `.issues` property instead of `.errors`
- **FR-011**: Type definitions MUST correctly represent the return types of all async operations

**Button Components**

- **FR-012**: Button variant props MUST use valid variant values from the project's design system

### Key Entities

- **McpConfig**: The root configuration object containing a map of server names to connector configurations
- **McpServerConfig**: Individual connector configuration including command, arguments, and environment variables
- **OperationResult**: Standard response type for async operations containing success status, optional data, and optional error message
- **ValidationError**: Structured error object containing field path and error message from Zod validation

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 52 TypeScript compilation errors are resolved (0 errors remaining)
- **SC-002**: Application builds and launches without runtime errors
- **SC-003**: Users can view configured connectors within 2 seconds of opening the settings panel
- **SC-004**: Users can successfully add a new connector in under 30 seconds
- **SC-005**: Users can edit an existing connector and see changes reflected immediately after save
- **SC-006**: Users can remove a connector with one confirmation step
- **SC-007**: All form validation errors are displayed inline within 100ms of form interaction
- **SC-008**: File persistence operations complete within 1 second under normal conditions
- **SC-009**: Error states (invalid JSON, file errors) display user-friendly messages instead of raw technical errors

## Assumptions

- The Tauri filesystem API (`@tauri-apps/api/fs`) is already available as a dependency
- The project's Dialog component uses a service-based pattern with useDialog() hook
- The project's icon set is finite and replacement icons can be found for all currently invalid references
- The showToast() function exists but requires investigation of its exact signature
- The existing MCP connector architecture (types, context, state management) is correct and only API surface adjustments are needed
