# React useState: Function Values Executed as Updaters

> **Severity**: P2 - Unexpected behavior, state resets

## Problem

When storing a function in React state, the function gets immediately executed instead of being stored:

```typescript
const [callback, setCallback] = useState<(() => void) | null>(null);

// This EXECUTES myFunction instead of storing it!
setCallback(myFunction);
```

## Symptoms

- State appears to "reset" immediately after being set
- Functions execute when they shouldn't
- Page flickers or navigates unexpectedly
- Debugging shows function being called from setState

Example console output:

```
[Component] Setting handler
[Component] Handler executed!  <-- Immediately called!
```

## Root Cause

React's `useState` setter has two modes:

```typescript
// Mode 1: Direct value
setState(newValue);

// Mode 2: Updater function
setState((prevState) => newState);
```

**When the argument is a function, React assumes Mode 2** and executes it!

```typescript
// What you wrote:
setCallback(myFunction);

// What React does:
setCallback((prevState) => myFunction(prevState));
// myFunction(null) gets called immediately!
```

## Demonstration

```typescript
function BadExample() {
  const [handler, setHandler] = useState<(() => void) | null>(null);

  const handleClick = () => {
    console.log('Click handler executed');
    setCount((c) => c + 1);
  };

  useEffect(() => {
    // BUG: handleClick() is called immediately!
    setHandler(handleClick);
  }, []);

  // Result: 'Click handler executed' logs on mount
  // handler is set to undefined (return value of handleClick)
}
```

## Solution

**Wrap the function in an arrow function**:

```typescript
// WRONG - function is executed
setCallback(myFunction);

// CORRECT - function is stored
setCallback(() => myFunction);
```

### Complete Example

```typescript
function CorrectExample() {
  const [handler, setHandler] = useState<(() => void) | null>(null);

  const handleClick = () => {
    console.log('Click handler executed');
  };

  useEffect(() => {
    // CORRECT: Wrap in arrow function
    setHandler(() => handleClick);
  }, []);

  return (
    <button onClick={() => handler?.()}>
      Click me
    </button>
  );
}
```

## Why TypeScript Doesn't Catch This

Both usages have the same type signature:

```typescript
// setState<T>(value: T | ((prev: T) => T)): void

// When T = (() => void) | null:
setCallback(myFunction); // T = () => void (valid)
setCallback((prev) => myFunction); // (prev: T) => T (valid)

// TypeScript can't distinguish intent
```

## Common Scenarios

### 1. Navigation/Back Handlers

```typescript
// Context providing back navigation
function NavigationProvider({ children }) {
  const [backHandler, setBackHandler] = useState<(() => void) | null>(null);

  const value = {
    setBackHandler: (handler: (() => void) | null) => {
      // WRONG: setBackHandler(handler)
      // CORRECT:
      setBackHandler(() => handler);
    },
  };

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
```

### 2. Callback Storage

```typescript
// Storing a callback for later use
const [onComplete, setOnComplete] = useState<((result: Result) => void) | null>(null);

// WRONG
setOnComplete(handleComplete);

// CORRECT
setOnComplete(() => handleComplete);
```

### 3. Event Handlers

```typescript
// Dynamic event handler
const [clickHandler, setClickHandler] = useState<((e: MouseEvent) => void) | null>(null);

// WRONG
setClickHandler(handleSpecialClick);

// CORRECT
setClickHandler(() => handleSpecialClick);
```

## Key Insight

This is a subtle React gotcha because:

1. **TypeScript doesn't warn** - both usages are type-valid
2. **Symptom is indirect** - you see "state reset", not "function called"
3. **Easy to miss in review** - the code looks correct

**Rule of thumb**: When calling `setState` with a function value, always ask "Am I storing this function or computing a new state?"

## Prevention Checklist

When storing functions in state:

- [ ] Is `setState(fn)` wrapped in `setState(() => fn)`?
- [ ] If the function takes parameters, does wrapping preserve them?
- [ ] Are context providers that store callbacks handling this correctly?

## Related Patterns

### useRef Alternative

If you don't need re-renders when the callback changes:

```typescript
const callbackRef = useRef<(() => void) | null>(null);

// No wrapping needed with refs
callbackRef.current = myFunction;
```

### useCallback with Identity

```typescript
const stableCallback = useCallback(myFunction, [dependencies]);
// Then use stableCallback where needed
```
