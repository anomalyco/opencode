---
name: react-components
description: Use when creating React components, hooks, or functional components with TypeScript. Activate for React development, component creation, or when user mentions React, JSX, hooks, or component patterns.
allowed-tools: [Read, Write, Edit, Grep, Glob]
---

# React Components Skill

This skill helps you create high-quality React components following modern best practices.

## Guidelines

### Component Structure

1. **Functional Components**: Always use functional components with hooks
2. **TypeScript**: Use explicit prop types with TypeScript interfaces
3. **File Organization**: One component per file
4. **Naming**: PascalCase for components, camelCase for functions

### Best Practices

- Use `React.FC` or explicit return types
- Destructure props in function parameters
- Use `useMemo` and `useCallback` for optimization
- Implement proper error boundaries
- Add PropTypes or TypeScript for type safety

### Common Patterns

```typescript
interface ComponentProps {
  title: string
  onAction: (id: string) => void
  children?: React.ReactNode
}

export const MyComponent: React.FC<ComponentProps> = ({
  title,
  onAction,
  children,
}) => {
  const [state, setState] = useState<string>('')

  const handleClick = useCallback(() => {
    onAction(state)
  }, [state, onAction])

  return (
    <div className="component">
      <h1>{title}</h1>
      {children}
    </div>
  )
}
```

## When to Use

Activate this skill when:
- Creating new React components
- Refactoring class components to functional components
- Implementing React hooks (useState, useEffect, useContext, etc.)
- Setting up component props and TypeScript types
- Building reusable UI components

See reference.md for detailed API documentation.
See examples.md for common component patterns.
