# Agent Guidelines for @opencode/app

## Build/Test Commands

- **Development**: `bun run dev` (starts Vite dev server on port 3000)
- **Build**: `bun run build` (production build)
- **Preview**: `bun run serve` (preview production build)
- **Validation**: Use `bun run typecheck` only - do not build or run project for validation
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

No special rules files found.
