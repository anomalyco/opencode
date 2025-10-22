# OpenCode Code Conventions

## Style Guidelines
- **Functions**: Keep logic within single function unless composable/reusable
- **Destructuring**: Avoid unnecessary variable destructuring
- **Control Flow**: 
  - Avoid `else` statements unless necessary
  - Prefer `.catch()` over `try/catch` when possible
  - Avoid `try/catch` if it can be avoided
- **Types**: 
  - Avoid `any` type
  - Use precise TypeScript types
  - Leverage `@typescript/native-preview` for better performance
- **Variables**: 
  - Avoid `let` statements (prefer const)
  - Use single-word variable names when descriptive
  - Prefer immutable patterns
- **Runtime APIs**: Use Bun helpers like `Bun.file()` when applicable

## Code Organization
- Monorepo structure with workspaces
- Each package has its own package.json and tsconfig.json
- Shared dependencies managed through catalog in root package.json
- Use absolute imports where possible

## Formatting
- Prettier configuration: semi-colons disabled, 120 character width
- TypeScript strict mode enabled
- Consistent import ordering

## Development Workflow
- Small, focused pull requests preferred
- Link relevant issues in PR descriptions
- Avoid verbose LLM-generated PR descriptions
- Check for existing functionality before adding new features