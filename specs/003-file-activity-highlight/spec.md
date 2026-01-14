# Feature Specification: File Activity Highlight

**Feature Branch**: `003-file-activity-highlight`
**Created**: 2026-01-14
**Status**: Draft
**Input**: User description: "whenever a file is read or write by the running AI model, I want the system to highlight that file within the file explorer on the righthand side with different color with some tag showing that this file is used in the workspace, and this file is edited or created in the workspace"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Files Read by AI (Priority: P1)

As a user working with an AI assistant, I want to see which files the AI has read during the session so I can understand what context the AI is using to make its responses.

**Why this priority**: Understanding which files the AI has accessed is fundamental to trusting and verifying AI responses. This provides transparency into AI behavior and helps users validate that the AI is working with the correct context.

**Independent Test**: Can be fully tested by triggering an AI file read operation and verifying the file appears highlighted in the file explorer with a "read" indicator.

**Acceptance Scenarios**:

1. **Given** an AI session is active and the file explorer is visible, **When** the AI reads a file, **Then** that file is immediately highlighted with a distinct color indicating "read" status
2. **Given** the AI has read multiple files, **When** the user views the file explorer, **Then** all read files are visually distinguished from unread files
3. **Given** a file has been read by the AI, **When** the user hovers over or inspects that file, **Then** a tag/badge indicating "read" or "used" is visible

---

### User Story 2 - View Files Written/Edited by AI (Priority: P1)

As a user working with an AI assistant, I want to see which files the AI has written to or edited during the session so I can quickly identify changes made and review them.

**Why this priority**: Knowing which files have been modified is critical for code review, version control, and understanding the scope of AI changes. This has equal priority with read tracking as both are essential for full visibility.

**Independent Test**: Can be fully tested by triggering an AI file write/edit operation and verifying the file appears highlighted with an "edited/created" indicator.

**Acceptance Scenarios**:

1. **Given** an AI session is active and the file explorer is visible, **When** the AI writes to or creates a file, **Then** that file is immediately highlighted with a distinct color indicating "edited" or "created" status
2. **Given** the AI has edited multiple files, **When** the user views the file explorer, **Then** all edited files are visually distinguished with a different color than read-only files
3. **Given** a file has been created by the AI (did not exist before), **When** the user views the file explorer, **Then** the file shows a "created" tag to differentiate from edited existing files

---

### User Story 3 - Distinguish Between Activity Types (Priority: P2)

As a user, I want to clearly distinguish between files that were only read versus files that were edited or created, so I can prioritize which files need my review.

**Why this priority**: Differentiation between read and write activities helps users focus their review efforts on modified files while still maintaining awareness of the AI's context.

**Independent Test**: Can be tested by having the AI read some files and write others, then verifying that the visual indicators clearly differentiate between the two activity types.

**Acceptance Scenarios**:

1. **Given** the AI has both read and written to different files, **When** the user views the file explorer, **Then** read-only files have one visual indicator (color/tag) and written files have a different, distinguishable indicator
2. **Given** a file was first read then later edited by the AI, **When** the user views the file explorer, **Then** the file shows the "edited" status (highest activity level takes precedence)
3. **Given** activity indicators are displayed, **When** a new user sees the file explorer, **Then** the meaning of each indicator is understandable (through legend, tooltip, or intuitive design)

---

### User Story 4 - Clear Activity State for New Session (Priority: P3)

As a user starting a new AI session, I want the activity highlights to be cleared so I have a fresh view without confusion from previous session activities.

**Why this priority**: Prevents confusion between sessions and ensures activity indicators remain meaningful and accurate for the current context.

**Independent Test**: Can be tested by having activity highlights from a session, starting a new session, and verifying all highlights are cleared.

**Acceptance Scenarios**:

1. **Given** files have activity highlights from a previous session, **When** the user starts a new AI session, **Then** all previous activity highlights are cleared
2. **Given** a new session has started, **When** the AI reads or writes files, **Then** only the new session's activities are highlighted

---

### Edge Cases

- What happens when a file that was highlighted is deleted (by AI or user)? The highlight is removed along with the file entry.
- What happens when a file is moved or renamed by the AI? The highlight follows the file to its new location/name.
- What happens when the same file is read multiple times? The highlight remains unchanged (no stacking of indicators).
- How does the system handle files in collapsed/hidden directories? Parent directories show an aggregated indicator if they contain highlighted files.
- What happens if the file explorer is refreshed? Activity highlights persist until the session ends or is manually cleared.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST visually highlight files in the file explorer when they are read by the AI model
- **FR-002**: System MUST visually highlight files in the file explorer when they are written to or edited by the AI model
- **FR-003**: System MUST visually highlight files in the file explorer when they are created by the AI model
- **FR-004**: System MUST use distinct visual indicators (colors and/or tags) to differentiate between:
  - Files that were only read
  - Files that were edited (existing files modified)
  - Files that were created (new files)
- **FR-005**: System MUST display a tag or badge on highlighted files indicating the type of activity ("read", "edited", "created")
- **FR-006**: System MUST update the file explorer highlights in real-time as the AI performs file operations
- **FR-007**: System MUST clear all activity highlights when a new AI session begins
- **FR-008**: System MUST maintain highlight state even if the file explorer is refreshed during a session
- **FR-009**: System MUST show an aggregated indicator on parent directories when collapsed directories contain highlighted files
- **FR-010**: System MUST update the highlight from "read" to "edited" if a file is first read then later written to

### Key Entities

- **File Activity State**: Represents the AI's interaction with a file; attributes include file path, activity type (read/edited/created), timestamp of last activity
- **Session Activity Log**: Collection of all file activities within the current AI session; used to track and display highlights
- **Visual Indicator**: The UI representation of file activity; includes color scheme and tag/badge for each activity type

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can identify all files touched by the AI within 2 seconds of viewing the file explorer
- **SC-002**: Activity highlights appear within 500ms of the AI performing a file operation
- **SC-003**: 95% of users can correctly distinguish between read, edited, and created files on first viewing
- **SC-004**: Users report increased confidence in understanding AI behavior (qualitative feedback)
- **SC-005**: Zero cases of activity highlights persisting incorrectly after session reset

## Assumptions

- The file explorer is always visible or accessible on the right-hand side of the interface
- The system has access to real-time events for AI file read/write operations
- Users are working in a single workspace context where file paths are consistent
- Colors used for highlighting are accessible and distinguishable (WCAG AA compliant contrast)
- The current session boundary is well-defined (new conversation/chat = new session)
