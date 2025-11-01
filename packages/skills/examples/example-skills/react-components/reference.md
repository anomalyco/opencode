# React Components Reference

## Core Hooks

### useState
```typescript
const [state, setState] = useState<Type>(initialValue)
```

### useEffect
```typescript
useEffect(() => {
  // Side effect
  return () => {
    // Cleanup
  }
}, [dependencies])
```

### useCallback
```typescript
const memoizedCallback = useCallback(
  () => {
    doSomething(a, b)
  },
  [a, b]
)
```

### useMemo
```typescript
const memoizedValue = useMemo(() => computeExpensiveValue(a, b), [a, b])
```

### useRef
```typescript
const refContainer = useRef<HTMLDivElement>(null)
```

### useContext
```typescript
const value = useContext(MyContext)
```

## Component Patterns

### Compound Components
```typescript
const Tabs = ({ children }: { children: React.ReactNode }) => {
  const [activeTab, setActiveTab] = useState(0)

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </TabsContext.Provider>
  )
}
```

### Render Props
```typescript
interface RenderPropProps {
  render: (data: DataType) => React.ReactNode
}

const DataProvider: React.FC<RenderPropProps> = ({ render }) => {
  const [data, setData] = useState<DataType>(null)

  return <>{render(data)}</>
}
```

### Higher-Order Components
```typescript
function withLoading<P extends object>(
  Component: React.ComponentType<P>
): React.FC<P & { isLoading: boolean }> {
  return ({ isLoading, ...props }) => {
    if (isLoading) return <Spinner />
    return <Component {...(props as P)} />
  }
}
```

## Performance Optimization

- Use `React.memo` for expensive components
- Implement `useMemo` for expensive calculations
- Use `useCallback` for event handlers passed to children
- Lazy load components with `React.lazy` and `Suspense`
- Use virtualization for long lists (react-window, react-virtualized)

## TypeScript Best Practices

- Define explicit prop interfaces
- Use `React.FC<Props>` or explicit return types
- Leverage generic components when needed
- Use union types for variant props
- Implement proper event typing
