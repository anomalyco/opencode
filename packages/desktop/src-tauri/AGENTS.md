# Agent Guidelines for @opencode/desktop

## Build/Test Commands

### Development

- **Web Dev**: `bun run dev` (starts Vite dev server on port 3000, responsive mobile UI at < 768px)
- **macOS Desktop**: `bun run tauri:dev` or `cargo tauri dev`
- **iOS Simulator**: `bun run ios:dev` or `cargo tauri ios dev "iPhone 16 Pro"`
- **Validation**: Use `bun run typecheck` only - do not build or run project for validation

### Production Builds

- **Build All**: `./scripts/build-all.sh` (builds web, macOS desktop, and iOS)
- **Web Only**: `bun run build` (production web build)
- **macOS Desktop**: `bun run build:macos` (creates .app and .dmg)
- **iOS for Mac**: `bun run build:ios` (creates IPA that runs on iPhone, iPad, and Apple Silicon Macs)
- **iOS Simulator**: `bun run build:ios-sim` (for testing in simulator)

### Testing

- **Preview**: `bun run serve` (preview production build)
- **Testing**: Do not create or run automated tests

## Code Style

- **Framework**: SolidJS with TypeScript
- **Imports**: Use `@/` alias for src/ directory (e.g., `import Button from "@/ui/button"`)
- **Formatting**: Prettier configured with semicolons disabled, 120 character line width
- **Components**: Use function declarations, splitProps for component props
- **Types**: Define interfaces for component props, avoid `any` type
- **CSS**: TailwindCSS with custom CSS variables theme system
- **Naming**: PascalCase for components, camelCase for variables/functions, snake_case for file names
- **File Structure**: UI primitives in `/ui/`, higher-level components in `/components/`, pages in `/pages/`, providers in `/providers/`

## Key Dependencies

- SolidJS, @solidjs/router, @kobalte/core (UI primitives)
- TailwindCSS 4.x with @tailwindcss/vite
- Custom theme system with CSS variables
- Tauri for desktop app framework
- Rust backend with Cargo.toml configuration
