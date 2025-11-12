# Performance Optimization

Patterns for optimizing React component performance, preventing unnecessary re-renders, and avoiding memory leaks.

---

## Memoization Patterns

### useMemo for Expensive Computations

```typescript
import { useMemo } from 'react';

export const DataDisplay: React.FC<{ items: Item[], searchTerm: string }> = ({
    items,
    searchTerm,
}) => {
    // ❌ AVOID - Runs on every render
    const filteredItems = items
        .filter(item => item.name.includes(searchTerm))
        .sort((a, b) => a.name.localeCompare(b.name));

    // ✅ CORRECT - Memoized, only recalculates when dependencies change
    const filteredItems = useMemo(() => {
        return items
            .filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [items, searchTerm]);

    return <List items={filteredItems} />;
};
```

**When to use useMemo:**
- Filtering/sorting large arrays
- Complex calculations
- Transforming data structures
- Expensive computations (loops, recursion)

**When NOT to use useMemo:**
- Simple string concatenation
- Basic arithmetic
- Premature optimization (profile first!)

---

## useCallback for Event Handlers

### The Problem

```typescript
// ❌ AVOID - Creates new function on every render
export const Parent: React.FC = () => {
    const handleClick = (id: string) => {
        console.log('Clicked:', id);
    };

    // Child re-renders every time Parent renders
    // because handleClick is a new function reference each time
    return <Child onClick={handleClick} />;
};
```

### The Solution

```typescript
import { useCallback } from 'react';

export const Parent: React.FC = () => {
    // ✅ CORRECT - Stable function reference
    const handleClick = useCallback((id: string) => {
        console.log('Clicked:', id);
    }, []); // Empty deps = function never changes

    // Child only re-renders when props actually change
    return <Child onClick={handleClick} />;
};
```

**When to use useCallback:**
- Functions passed as props to children
- Functions used as dependencies in useEffect
- Functions passed to memoized components
- Event handlers in lists

**When NOT to use useCallback:**
- Event handlers not passed to children
- Simple inline handlers: `onClick={() => doSomething()}`

---

## React.memo for Component Memoization

### Basic Usage

```typescript
import React from 'react';

interface ExpensiveComponentProps {
    data: ComplexData;
    onAction: () => void;
}

// ✅ Wrap expensive components in React.memo
export const ExpensiveComponent = React.memo<ExpensiveComponentProps>(
    function ExpensiveComponent({ data, onAction }) {
        // Complex rendering logic
        return <ComplexVisualization data={data} />;
    }
);
```

**When to use React.memo:**
- Component renders frequently
- Component has expensive rendering
- Props don't change often
- Component is a list item
- DataGrid cells/renderers

**When NOT to use React.memo:**
- Props change frequently anyway
- Rendering is already fast
- Premature optimization

---

## Debounced Search

### Using use-debounce Hook

```typescript
import { useState } from 'react';
import { useDebounce } from 'use-debounce';
import { useSuspenseQuery } from '@tanstack/react-query';

export const SearchComponent: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');

    // Debounce for 300ms
    const [debouncedSearchTerm] = useDebounce(searchTerm, 300);

    // Query uses debounced value
    const { data } = useSuspenseQuery({
        queryKey: ['search', debouncedSearchTerm],
        queryFn: () => api.search(debouncedSearchTerm),
        enabled: debouncedSearchTerm.length > 0,
    });

    return (
        <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder='Search...'
        />
    );
};
```

**Optimal Debounce Timing:**
- **300-500ms**: Search/filtering
- **1000ms**: Auto-save
- **100-200ms**: Real-time validation

---

## Memory Leak Prevention

### Cleanup Timeouts/Intervals

```typescript
import { useEffect, useState } from 'react';

export const MyComponent: React.FC = () => {
    const [count, setCount] = useState(0);

    useEffect(() => {
        // ✅ CORRECT - Cleanup interval
        const intervalId = setInterval(() => {
            setCount(c => c + 1);
        }, 1000);

        return () => {
            clearInterval(intervalId);  // Cleanup!
        };
    }, []);

    useEffect(() => {
        // ✅ CORRECT - Cleanup timeout
        const timeoutId = setTimeout(() => {
            console.log('Delayed action');
        }, 5000);

        return () => {
            clearTimeout(timeoutId);  // Cleanup!
        };
    }, []);

    return <div>{count}</div>;
};
```

### Cleanup Event Listeners

```typescript
useEffect(() => {
    const handleResize = () => {
        console.log('Resized');
    };

    window.addEventListener('resize', handleResize);

    return () => {
        window.removeEventListener('resize', handleResize);  // Cleanup!
    };
}, []);
```

### Abort Controllers for Fetch

```typescript
useEffect(() => {
    const abortController = new AbortController();

    fetch('/api/data', { signal: abortController.signal })
        .then(response => response.json())
        .then(data => setState(data))
        .catch(error => {
            if (error.name === 'AbortError') {
                console.log('Fetch aborted');
            }
        });

    return () => {
        abortController.abort();  // Cleanup!
    };
}, []);
```

**Note**: With TanStack Query, this is handled automatically.

---

## Form Performance

### Watch Specific Fields (Not All)

```typescript
import { useForm } from 'react-hook-form';

export const MyForm: React.FC = () => {
    const { register, watch, handleSubmit } = useForm();

    // ❌ AVOID - Watches all fields, re-renders on any change
    const formValues = watch();

    // ✅ CORRECT - Watch only what you need
    const username = watch('username');
    const email = watch('email');

    // Or multiple specific fields
    const [username, email] = watch(['username', 'email']);

    return (
        <form onSubmit={handleSubmit(onSubmit)}>
            <input {...register('username')} />
            <input {...register('email')} />
            <input {...register('password')} />

            {/* Only re-renders when username/email change */}
            <p>Username: {username}, Email: {email}</p>
        </form>
    );
};
```

---

## List Rendering Optimization

### Key Prop Usage

```typescript
// ✅ CORRECT - Stable unique keys
{items.map(item => (
    <ListItem key={item.id}>
        {item.name}
    </ListItem>
))}

// ❌ AVOID - Index as key (unstable if list changes)
{items.map((item, index) => (
    <ListItem key={index}>  // WRONG if list reorders
        {item.name}
    </ListItem>
))}
```

### Memoized List Items

```typescript
const ListItem = React.memo<ListItemProps>(({ item, onAction }) => {
    return (
        <Box onClick={() => onAction(item.id)}>
            {item.name}
        </Box>
    );
});

export const List: React.FC<{ items: Item[] }> = ({ items }) => {
    const handleAction = useCallback((id: string) => {
        console.log('Action:', id);
    }, []);

    return (
        <Box>
            {items.map(item => (
                <ListItem
                    key={item.id}
                    item={item}
                    onAction={handleAction}
                />
            ))}
        </Box>
    );
};
```

---

## Preventing Component Re-initialization

### The Problem

```typescript
// ❌ AVOID - Component recreated on every render
export const Parent: React.FC = () => {
    // New component definition each render!
    const ChildComponent = () => <div>Child</div>;

    return <ChildComponent />;  // Unmounts and remounts every render
};
```

### The Solution

```typescript
// ✅ CORRECT - Define outside or use useMemo
const ChildComponent: React.FC = () => <div>Child</div>;

export const Parent: React.FC = () => {
    return <ChildComponent />;  // Stable component
};

// ✅ OR if dynamic, use useMemo
export const Parent: React.FC<{ config: Config }> = ({ config }) => {
    const DynamicComponent = useMemo(() => {
        return () => <div>{config.title}</div>;
    }, [config.title]);

    return <DynamicComponent />;
};
```

---

## Lazy Loading Heavy Dependencies

### Code Splitting

```typescript
// ❌ AVOID - Import heavy libraries at top level
import jsPDF from 'jspdf';  // Large library loaded immediately
import * as XLSX from 'xlsx';  // Large library loaded immediately

// ✅ CORRECT - Dynamic import when needed
const handleExportPDF = async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    // Use it
};

const handleExportExcel = async () => {
    const XLSX = await import('xlsx');
    // Use it
};
```

---

## Summary

**Performance Checklist:**
- ✅ `useMemo` for expensive computations (filter, sort, map)
- ✅ `useCallback` for functions passed to children
- ✅ `React.memo` for expensive components
- ✅ Debounce search/filter (300-500ms)
- ✅ Cleanup timeouts/intervals in useEffect
- ✅ Watch specific form fields (not all)
- ✅ Stable keys in lists
- ✅ Lazy load heavy libraries
- ✅ Code splitting with React.lazy

**See Also:**
- [component-patterns.md](component-patterns.md) - Lazy loading
- [data-fetching.md](data-fetching.md) - TanStack Query optimization
- [complete-examples.md](complete-examples.md) - Performance patterns in context