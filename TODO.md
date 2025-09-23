# TODO: Python SDK Implementation Plan

## Executive Summary
This document outlines the plan to implement a Python SDK for the Opencode project using `openapi-python-client` instead of the current Stainless-based approach. The Python SDK will be generated from the OpenAPI specification exposed by the server and will maintain feature parity with the existing Go and JavaScript SDKs.

## Key Decision: Moving Away from Stainless
**Important**: The project maintainers have decided to move away from Stainless for SDK generation. The Python SDK will use `openapi-python-client` which offers:
- Pure Python-based generation with Jinja2 templates
- Modern Python features (type annotations, dataclasses)
- Better integration with Python tooling
- Easier customization and maintenance

## Implementation Plan

### Phase 1: Setup and Infrastructure

#### 1.1 Create Python SDK Package Structure
- [X] Create directory: `packages/sdk/python/`
- [X] Set up standard Python project structure:
  ```
  packages/sdk/python/
  ├── .gitignore
  ├── README.md
  ├── pyproject.toml
  ├── setup.py (if needed for compatibility)
  ├── requirements-dev.txt
  ├── scripts/
  │   ├── generate.py
  │   └── publish.py
  ├── src/
  │   └── opencode_ai/  (placeholder for generated code)
  ├── tests/
  │   └── __init__.py
  └── examples/
      └── basic_usage.py
  ```

#### 1.2 Install Development Dependencies
- [X] Install `openapi-python-client` globally or in dev environment:
  ```bash
  pipx install openapi-python-client --include-deps
  ```
- [X] Document installation in development setup guide

#### 1.3 Configure Python Package Metadata
- [X] Create `pyproject.toml` with:
  - Package name: `opencode-ai`
  - Module name: `opencode_ai`
  - Version synchronized with main project
  - Dependencies: `httpx`, `pydantic`, `python-dateutil`
  - Python version requirement: `>=3.8`
  - Poetry/PDM/setuptools configuration (align with project preference)

### Phase 2: OpenAPI Specification Generation

#### 2.1 Understand Current OpenAPI Generation
- [X] The server exposes OpenAPI spec at `/doc` endpoint
- [X] Generate command: `bun dev generate` outputs OpenAPI JSON
- [X] Server uses Hono's `generateSpecs` function for OpenAPI 3.1.1

#### 2.2 Create Generation Script
- [X] Create `scripts/generate.py` that:
  - [X] Starts the opencode server locally (or assumes it's running)
  - [X] Fetches OpenAPI spec from `http://localhost:4096/doc` or generates via CLI
  - [X] Saves to `openapi.json`
  - [X] Runs `openapi-python-client` with appropriate configuration
  - [X] Post-processes generated code if needed

#### 2.3 Handle OpenAPI Spec Compatibility
- [X] Verify OpenAPI 3.1.1 compatibility with `openapi-python-client`
- [ ] Create transformation script if any adjustments needed
- [ ] Document any spec modifications required

### Phase 3: SDK Generation and Customization

#### 3.1 Configure openapi-python-client
- [X] Create configuration for generation (openapi-python-client.yaml with overrides)
- [X] Set package name override to match `opencode_ai`

#### 3.2 Custom Templates (if needed)
- [ ] Create `templates/` directory for custom Jinja2 templates
- [ ] Override default templates for:
  - Client initialization (to match existing SDK patterns)
  - Error handling
  - Authentication mechanisms
  - Streaming support for SSE endpoints

#### 3.3 Post-Generation Processing
- [X] Create post-processing script to:
  - [X] Add custom client wrapper for better DX
  - [X] Implement streaming support for `/event` endpoint
  - [X] Add helper methods similar to Go/JS SDKs (list_sessions, get_config)
  - [X] Format code with `black` and `ruff` import fixes

### Phase 4: Feature Implementation

#### 4.1 Core Client Implementation
- [X] Create `OpenCodeClient` wrapper class with:
  - [X] Default base URL configuration (`http://localhost:4096`)
  - [X] Authentication support
  - [X] Custom headers support
  - [X] Timeout configuration
  - [X] Retry logic

#### 4.2 Implement Key SDK Features
Based on existing SDKs, implement:
- [ ] **Session Management**
  - [X] `session.list()`
  - [ ] `session.get(id)`
  - [ ] `session.create()`
  - [ ] `session.delete(id)`
  - [ ] `session.prompt(id, message)`
  - [ ] `session.share(id)`
  
- [X] **Agent Operations**
  - [X] `agent.list()`
  
- [ ] **File Operations**
  - [ ] `file.list()`
  - [ ] `file.read(path)`
  - [X] `file.status()`
  
- [X] **Project Management**
  - [X] `project.list()`
  - [X] `project.current()`
  
- [X] **Configuration**
  - [X] `config.get()`
  
- [X] **Event Streaming** (SSE)
  - [X] `event.subscribe()` with proper async/streaming support

#### 4.3 Special Handling for Streaming
- [X] Implement SSE client for `/event` endpoint
- [X] Use `httpx` streaming APIs
- [X] Provide both sync and async interfaces

### Phase 5: Testing and Documentation

#### 5.1 Create Test Suite
- [X] Unit tests for wrapper and generated client wiring (imports, method availability)
- [ ] Integration tests against local server
- [X] Mock tests for CI/CD (httpx.MockTransport)
- [X] Test streaming functionality (SSE parsing with MockTransport)
- [X] Test error handling (retry on request error)

#### 5.2 Create Examples
- [X] Basic usage example
- [X] Session management example
- [X] Streaming events example
- [X] File operations example
- [X] Async usage example (documented snippet)

#### 5.3 Documentation
- [X] Create README.md updates with:
  - [X] Installation instructions
  - [X] Quick start guide
  - [X] Examples (sync streaming and async snippet)
  - [X] Error handling guide
- [ ] Generate API documentation using `sphinx` or `mkdocs`
- [ ] Add inline docstrings to all public methods

### Phase 6: Integration with Build System

#### 6.1 Integrate with Monorepo Build
- [ ] Add Python SDK to `packages/sdk/` structure
- [ ] Update root `package.json` if needed for generation scripts
- [ ] Create Bun script wrapper for Python generation (for consistency)

#### 6.2 Update Generation Pipeline
- [ ] Modify `bun run generate` to include Python SDK generation
- [ ] Ensure generation works in CI/CD pipeline
- [ ] Add generation verification tests

#### 6.3 Remove Stainless Python Configuration
- [ ] Remove Python-related configuration from `stainless.yml`
- [ ] Clean up any Stainless-specific Python artifacts
- [ ] Update documentation to reflect new generation method

### Phase 7: Publishing and Distribution

#### 7.1 PyPI Publishing Setup
- [ ] Configure PyPI credentials (or use TestPyPI first)
- [ ] Create `scripts/publish.py` for publishing workflow
- [ ] Set up GitHub Actions for automated publishing
- [ ] Implement version bumping strategy

#### 7.2 Package Distribution
- [ ] Publish to PyPI as `opencode-ai`
- [ ] Ensure package metadata is complete
- [ ] Add badges to README (PyPI version, downloads, etc.)

### Phase 8: Migration and Deprecation

#### 8.1 Migration Guide
- [ ] Create migration guide from Stainless SDK (if one exists)
- [ ] Document breaking changes
- [ ] Provide code examples for migration

#### 8.2 Cleanup
- [ ] Remove Stainless Python configuration
- [ ] Update all references in documentation
- [ ] Archive any deprecated Python SDK repositories

## Technical Considerations

### API Coverage
The Python SDK should cover all endpoints currently exposed:
- Session management endpoints
- Agent endpoints
- File and search operations
- Configuration endpoints
- Project management
- Event streaming (SSE)
- TUI control endpoints (if applicable)

### Python Version Support
- Minimum Python 3.8 (for broad compatibility)
- Use type hints throughout
- Support both sync and async operations

### Dependencies
- `httpx` - Modern HTTP client with async support
- `pydantic` - Data validation (generated by openapi-python-client)
- `python-dateutil` - Date parsing
- `sseclient-py` or similar for SSE support

### Error Handling
- Create custom exception classes matching other SDKs:
  - `OpenCodeError` - Base exception
  - `AuthenticationError`
  - `APIError`
  - `NetworkError`
  - `ValidationError`

### Testing Strategy
- Use `pytest` for testing framework
- `pytest-asyncio` for async tests
- `responses` or `httpx-mock` for HTTP mocking
- `pytest-cov` for coverage reporting

## Success Criteria
- [ ] Python SDK successfully generated from OpenAPI spec
- [ ] All major endpoints covered with type-safe interfaces
- [ ] Streaming support working for event subscriptions
- [ ] Tests passing with >80% coverage
- [ ] Documentation complete and examples working
- [ ] Package published to PyPI
- [ ] Integration with existing build system
- [ ] Removal of Stainless Python configuration

## Timeline Estimate
- Phase 1-2: 1 day (Setup and OpenAPI generation)
- Phase 3-4: 2-3 days (SDK generation and feature implementation)
- Phase 5: 1-2 days (Testing and documentation)
- Phase 6-7: 1 day (Build integration and publishing)
- Phase 8: 0.5 days (Migration and cleanup)

**Total estimate: 5-7 days**

## Open Questions
1. Should we support both sync and async clients, or focus on one?
2. What Python package manager should we use (Poetry, PDM, setuptools)?
3. Should we maintain backward compatibility with any existing Stainless Python SDK?
4. Do we need custom authentication mechanisms beyond what's in the OpenAPI spec?
5. Should we provide higher-level abstractions beyond the generated client?

## Notes
- The `openapi-python-client` generates modern Python code with type annotations and dataclasses
- It's maintained and actively developed, unlike some other generators
- The generated code is clean and Pythonic, requiring minimal post-processing
- Custom templates can be used for specific requirements without forking the generator

## References
- [openapi-python-client GitHub](https://github.com/openapi-generators/openapi-python-client)
- [openapi-python-client Documentation](https://github.com/openapi-generators/openapi-python-client#readme)
- Current Stainless configuration: `/packages/sdk/stainless/stainless.yml`
- OpenAPI endpoint: `http://localhost:4096/doc`
- Existing SDK examples: `/packages/sdk/go/` and `/packages/sdk/js/`