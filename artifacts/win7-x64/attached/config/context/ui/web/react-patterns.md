<!-- Context: ui/react-patterns | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# React Patterns & Best Practices

**Category**: development  
**Purpose**: Modern React patterns, hooks usage, and component design principles  
**Used by**: frontend-specialist

---

## Overview

This guide covers modern React patterns using functional components, hooks, and best practices for building scalable React applications.

## Component Patterns

### 1. Functional Components with Hooks

**Always use functional components**:
```jsx
// Good
function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  
  useEffect(() => {
    fetchUser(userId).then(setUser);
  }, [userId]);
  
  return <div>{user?.name}</div>;
}
```

### 2. Custom Hooks for Reusable Logic

**Extract common logic into custom hooks**:
```jsx
// Custom hook
function useUser(userId) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    setLoading(true);
    fetchUser(userId)
      .then(setUser)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [userId]);
  
  return { user, loading, error };
}

// Usage
function UserProfile({ userId }) {
  const { user, loading, error } = useUser(userId);
  
  if (loading) return <Spinner />;
  if (error) return <Error message={error.message} />;
  return <div>{user.name}</div>;
}
```

### 3. Composition Over Props Drilling

**Use composition to avoid prop drilling**:
```jsx
// Bad - Props drilling
function App() {
  const [theme, setTheme] = useState('light');
  return <Layout theme={theme} setTheme={setTheme} />;
}

// Good - Composition with Context
const ThemeContext = createContext();

function App() {
  const [theme, setTheme] = useState('light');
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <Layout />
    </ThemeContext.Provider>
  );
}

function Layout() {
  const { theme } = useContext(ThemeContext);
  return <div className={theme}>...</div>;
}
```

### 4. Compound Components

**For complex, related components**:
```jsx
function Tabs({ children }) {
  const [activeTab, setActiveTab] = useState(0);
  
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </TabsContext.Provider>
  );
}

Tabs.List = function TabsList({ children }) {
  return <div className="tabs-list">{children}</div>;
};

Tabs.Tab = function Tab({ index, children }) {
  const { activeTab, setActiveTab } = useContext(TabsContext);
  return (
    <button 
      className={activeTab === index ? 'active' : ''}
      onClick={() => setActiveTab(index)}
    >
      {children}
    </button>
  );
};

Tabs.Panel = function TabPanel({ index, children }) {
  const { activeTab } = useContext(TabsContext);
  return activeTab === index ? <div>{children}</div> : null;
};

// Usage
<Tabs>
  <Tabs.List>
    <Tabs.Tab index={0}>Tab 1</Tabs.Tab>
    <Tabs.Tab index={1}>Tab 2</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel index={0}>Content 1</Tabs.Panel>
  <Tabs.Panel index={1}>Content 2</Tabs.Panel>
</Tabs>
```

## Hooks Best Practices

### 1. useEffect Dependencies

**Always specify dependencies correctly**:
```jsx
// Bad - Missing dependencies
useEffect(() => {
  fetchData(userId);
}, []);

// Good - Correct dependencies
useEffect(() => {
  fetchData(userId);
}, [userId]);

// Good - Stable function reference
const fetchData = useCallback((id) => {
  api.getUser(id).then(setUser);
}, []);

useEffect(() => {
  fetchData(userId);
}, [userId, fetchData]);
```

### 2. useMemo for Expensive Calculations

**Memoize expensive computations**:
```jsx
function DataTable({ data, filters }) {
  const filteredData = useMemo(() => {
    return data.filter(item => 
      filters.every(filter => filter(item))
    );
  }, [data, filters]);
  
  return <Table data={filteredData} />;
}
```

### 3. useCallback for Stable References

**Prevent unnecessary re-renders**:
```jsx
function Parent() {
  const [count, setCount] = useState(0);
  
  // Bad - New function on every render
  const handleClick = () => setCount(c => c + 1);
  
  // Good - Stable function reference
  const handleClick = useCallback(() => {
    setCount(c => c + 1);
  }, []);
  
  return <Child onClick={handleClick} />;
}

const Child = memo(function Child({ onClick }) {
  return <button onClick={onClick}>Click</button>;
});
```

## State Management Patterns

### 1. Local State First

**Start with local state, lift when needed**:
```jsx
// Local state
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}

// Lifted state when shared
function App() {
  const [count, setCount] = useState(0);
  return (
    <>
      <Counter count={count} setCount={setCount} />
      <Display count={count} />
    </>
  );
}
```

### 2. useReducer for Complex State

**Use reducer for related state updates**:
```jsx
const initialState = { count: 0, step: 1 };

function reducer(state, action) {
  switch (action.type) {
    case 'increment':
      return { ...state, count: state.count + state.step };
    case 'decrement':
      return { ...state, count: state.count - state.step };
    case 'setStep':
      return { ...state, step: action.payload };
    default:
      return state;
  }
}

function Counter() {
  const [state, dispatch] = useReducer(reducer, initialState);
  
  return (
    <>
      <button onClick={() => dispatch({ type: 'decrement' })}>-</button>
      <span>{state.count}</span>
      <button onClick={() => dispatch({ type: 'increment' })}>+</button>
    </>
  );
}
```

## Performance Optimization

### 1. Code Splitting

**Lazy load routes and heavy components**:
```jsx
import { lazy, Suspense } from 'react';

const Dashboard = lazy(() => import('./Dashboard'));
const Settings = lazy(() => import('./Settings'));

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
}
```

### 2. Virtualization for Long Lists

**Use virtualization for large datasets**:
```jsx
import { FixedSizeList } from 'react-window';

function VirtualList({ items }) {
  const Row = ({ index, style }) => (
    <div style={style}>{items[index].name}</div>
  );
  
  return (
    <FixedSizeList
      height={600}
      itemCount={items.length}
      itemSize={50}
      width="100%"
    >
      {Row}
    </FixedSizeList>
  );
}
```

## Best Practices

1. **Keep components small and focused** - Single responsibility principle
2. **Use TypeScript** - Type safety prevents bugs and improves DX
3. **Colocate related code** - Keep components, styles, and tests together
4. **Use meaningful prop names** - Clear, descriptive names improve readability
5. **Avoid inline functions in JSX** - Extract to named functions or useCallback
6. **Use fragments** - Avoid unnecessary wrapper divs
7. **Handle loading and error states** - Always show feedback to users
8. **Test components** - Use React Testing Library for user-centric tests

## Anti-Patterns

- ❌ **Prop drilling** - Use context or composition instead
- ❌ **Massive components** - Break down into smaller, focused components
- ❌ **Mutating state directly** - Always use setState or dispatch
- ❌ **Using index as key** - Use stable, unique identifiers
- ❌ **Unnecessary useEffect** - Derive state when possible
- ❌ **Ignoring ESLint warnings** - React hooks rules prevent bugs
- ❌ **Not memoizing context values** - Causes unnecessary re-renders

## References

- React Documentation (react.dev)
- React Patterns by Kent C. Dodds
- Epic React by Kent C. Dodds
