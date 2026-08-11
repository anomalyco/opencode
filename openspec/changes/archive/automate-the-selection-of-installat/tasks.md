# Tasks: Automate the selection of installation directory in the installation script.

## Phase 1 — Design and Implementation

### Task 1: Design the new installation directory selection mechanism
- [ ] 1.1. Review the current installation directory selection logic in the script.
  - Validation: `grep -r 'installation directory' scripts`
- [ ] 1.2. Define the new priority order for directory selection.
- [ ] 1.3. Sketch the user interface for directory selection.
  - Validation: `figmockup --save design.png`

### Task 2: Implement the new selection mechanism
- [ ] 2.1. Update the installation script to prompt the user for the installation directory.
  - Validation: `./install.sh --help | grep 'directory'`
- [ ] 2.2. Ensure the script respects the new priority order for directory selection.
- [ ] 2.3. Add a fallback mechanism for unsupported operating systems.
  - Validation: `./install.sh --os=unsupported_os`

## Phase 2 — Testing

### Task 3: Create unit tests for the installation directory selection
- [ ] 3.1. Write tests for the script's behavior in different environments.
  - Validation: `npm run test:install`
- [ ] 3.2. Validate the script's behavior with different installation directories.
  - Validation: `./install.sh --dir=/usr/local/bin`

### Task 4: Perform integration tests
- [ ] 4.1. Test the script in various environments (Linux, macOS, Windows).
  - Validation: `./install.sh --os=linux`
- [ ] 4.2. Check for any edge cases or unexpected behaviors.
  - Validation: `./install.sh --dir=/tmp --os=windows`

## Phase 3 — Documentation and Deployment

### Task 5: Update the documentation
- [ ] 5.1. Document the new installation directory selection mechanism in the README.
  - Validation: `git diff -- README.md`
- [ ] 5.2. Provide examples and guidelines for setting custom installation directories.
  - Validation: `git diff -- README.md`

### Task 6: Prepare for deployment
- [ ] 6.1. Ensure the installation script is executable.
  - Validation: `chmod +x ./install.sh`
- [ ] 6.2. Update the release notes with the new directory selection feature.
  - Validation: `git diff -- release_notes.md`