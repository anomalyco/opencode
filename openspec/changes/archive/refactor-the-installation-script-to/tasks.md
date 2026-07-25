# Tasks

## Phase 1 — Analysis

- [ ] 1.1. Review the current installation script to understand its purpose and functionality.
  - Validation: `cat scripts/install.sh`
- [ ] 1.2. Identify the different installation paths and their priority.
  - Validation: Review the script and relevant documentation.
- [ ] 1.3. Determine the current behavior when multiple installation paths are specified.
  - Validation: Test installations with different paths.

## Phase 2 — Design

- [ ] 2.1. Design a new structure for handling installation paths.
  - Validation: Outline the new script structure.
- [ ] 2.2. Define the priority order for installation paths.
  - Validation: Document the priority order.
- [ ] 2.3. Ensure the script handles custom installation paths explicitly.
  - Validation: Implement a test case for a custom installation path.

## Phase 3 — Implementation

- [ ] 3.1. Refactor the installation script to handle different installation paths.
  - Validation: Run the script with various installation paths.
- [ ] 3.2. Update the documentation to reflect the changes.
  - Validation: Review and update the README.md.
- [ ] 3.3. Add tests to cover the new behavior.
  - Validation: Run the test cases to ensure the script behaves as expected.

## Phase 4 — Testing and Validation

- [ ] 4.1. Test the installation script with different installation paths.
  - Validation: `bash scripts/install.sh` with various paths.
- [ ] 4.2. Validate the script's behavior with custom installation paths.
  - Validation: Set `OPENCODE_INSTALL_DIR` and `XDG_BIN_DIR` and test.
- [ ] 4.3. Ensure the script handles errors gracefully.
  - Validation: Introduce errors and check the script's response.

## Phase 5 — Documentation and Release

- [ ] 5.1. Update the README.md with the new installation instructions.
  - Validation: Review the updated README.md.
- [ ] 5.2. Prepare release notes.
  - Validation: Draft release notes for the refactored script.
- [ ] 5.3. Merge the changes into the main branch.
  - Validation: Merge the changes into the dev branch.
