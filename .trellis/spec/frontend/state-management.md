# State Management

> Auth context, layout context, and navigation patterns.

---

## Authentication Context

Use React Context for global auth state with session restoration on app startup.

```tsx
// src/renderer/src/features/auth/AuthContext.tsx
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { AuthUser, LoginInput, RegisterInput, SessionData } from '../shared/types/auth';

// ============================================
// Types
// ============================================

interface AuthContextValue {
  // State
  user: AuthUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;

  // Actions
  login: (data: LoginInput) => Promise<{ success: boolean; error?: string }>;
  register: (data: RegisterInput) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

// ============================================
// Context
// ============================================

const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================
// Provider
// ============================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const session: SessionData = await window.api.session.restore();
        if (session.isLoggedIn && session.user) {
          setUser(session.user);
          setIsLoggedIn(true);
        }
      } catch (error) {
        console.error('Failed to restore session:', error);
      } finally {
        setIsLoading(false);
      }
    };
    restoreSession();
  }, []);

  // Login
  const login = useCallback(async (data: LoginInput) => {
    const result = await window.api.auth.login(data);
    if (result.success && result.user) {
      setUser(result.user);
      setIsLoggedIn(true);
      return { success: true };
    }
    return { success: false, error: result.error };
  }, []);

  // Register (auto-login on success)
  const register = useCallback(async (data: RegisterInput) => {
    const result = await window.api.auth.register(data);
    if (result.success && result.user) {
      setUser(result.user);
      setIsLoggedIn(true);
      return { success: true };
    }
    return { success: false, error: result.error };
  }, []);

  // Logout
  const logout = useCallback(async () => {
    await window.api.auth.logout();
    setUser(null);
    setIsLoggedIn(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoggedIn, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ============================================
// Hook
// ============================================

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

### Usage in App

```tsx
// src/renderer/src/App.tsx
import { AuthProvider, useAuth } from './features/auth';

function AppContent() {
  const { user, isLoggedIn, isLoading, logout } = useAuth();

  // Show loading while restoring session
  if (isLoading) {
    return <LoadingScreen />;
  }

  // Not logged in - show auth form
  if (!isLoggedIn) {
    return <AuthForm />;
  }

  // Logged in - show main app
  return (
    <div>
      <p>Welcome, {user?.email}</p>
      <button onClick={logout}>Sign Out</button>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
```

---

## Layout Context (UI shell state)

Use a dedicated layout context for **UI shell state** that is not domain data:

- Left sidebar visibility (collapsed/expanded)
- Right sidebar visibility (collapsed/expanded)
- Sidebar widths (resizable via drag handle)

**Rules**:

- Keep this context UI-only. Do NOT store domain entities here.
- Expose a minimal API for each sidebar:
  - Left: `sidebarVisible`, `setSidebarVisible`, `toggleSidebar`, `leftSidebarWidth`, `setLeftSidebarWidth`
  - Right: `rightSidebarVisible`, `setRightSidebarVisible`, `toggleRightSidebar`, `rightSidebarWidth`, `setRightSidebarWidth`
- Prefer boolean + toggles over multiple derived flags.
- Persist sidebar state and widths to `localStorage` for session continuity.

**Sidebar Width Constants**:

| Constant                      | Value | Description                 |
| ----------------------------- | ----- | --------------------------- |
| `DEFAULT_LEFT_SIDEBAR_WIDTH`  | 240px | Default left sidebar width  |
| `DEFAULT_RIGHT_SIDEBAR_WIDTH` | 280px | Default right sidebar width |
| `MIN_SIDEBAR_WIDTH`           | 180px | Minimum width constraint    |
| `MAX_SIDEBAR_WIDTH`           | 480px | Maximum width constraint    |

**CSS Variables** (for performance-optimized resizing):

- `--left-sidebar-width` - Left sidebar width
- `--right-sidebar-width` - Right sidebar width

**ResizeHandle Component**:

The `ResizeHandle` component enables drag-to-resize for sidebars:

- Uses CSS variables during drag for 60fps performance (no React re-renders)
- Only syncs to React state on `mouseup`
- Adds `resize-dragging` class to body to disable transitions during drag

**Keyboard Shortcuts**:

- `Cmd+\` (Cmd+\) - Toggle left sidebar
- `Shift+Cmd+\` (Shift+Cmd+\) - Toggle right sidebar

---

## App Preferences Context (User settings)

Use `AppPreferencesContext` for **user preferences** that persist across sessions:

- Display variants
- Theme settings
- Font size preferences

**Rules**:

- Use `localStorage` for persistence (no backend required)
- Keep preferences UI-focused (not domain data)
- Provide typed setter functions for each preference
- Load defaults gracefully if localStorage is empty/corrupt

**Storage Key**: `app-preferences`

**Example Preferences**:

| Key              | Type                            | Default     | Description      |
| ---------------- | ------------------------------- | ----------- | ---------------- |
| `displayVariant` | `"minimal" \| "classic"`        | `"minimal"` | Display style    |
| `theme`          | `"light" \| "dark" \| "system"` | `"system"`  | Theme preference |

**Usage**:

```tsx
import { useAppPreferences } from '../modules/settings';

function MyComponent() {
  const { preferences, setDisplayVariant } = useAppPreferences();

  // Read preference
  const isMinimal = preferences.displayVariant === 'minimal';

  // Update preference (auto-persists to localStorage)
  setDisplayVariant('classic');
}
```

**Provider Location**:

- Wrap at `App.tsx` level (outermost, before other providers)
- Does NOT require auth (preferences work before login)

---

## Tabs + Navigation Pattern

When implementing a tab-based interface (like VS Code, Obsidian), use **tabs as the single source of truth** for navigation.

### Core Principle

**Rule**: Tabs are the single source of truth for "what content the user is viewing".

- `activeTab` determines `currentView`
- `activeTab.entityId` (for content tabs) determines `activeEntityId`
- `navigate(view, opts)` is a **facade** that only opens/focuses tabs

**Why**:

- Avoid circular updates (tab change -> navigate -> openTab -> tab change)
- Make the TabBar the primary router
- Keep pages simple: they render based on navigation state derived from tabs

### Implementation Pattern

1. **Keep the mapping centralized** (no scattered `if/else`):

```typescript
// src/renderer/src/modules/navigation/lib/tab-mapping.ts
export const TAB_TO_VIEW: Record<TabType, ViewId> = {
  home: 'home',
  settings: 'settings',
  doc: 'doc',
  // ...
};

export const VIEW_TO_TAB: Record<ViewId, TabType> = {
  home: 'home',
  settings: 'settings',
  doc: 'doc',
  // ...
};
```

2. **Derive navigation state from tabs**:

```typescript
// In NavigationContext, compute currentView/activeEntityId from useTabs().activeTab
// Do NOT store a second copy of view/entity state in Navigation
```

3. **Keep AppShell free of sync effects**:

- Do NOT add a `useEffect` that tries to sync tabs <-> navigation (it becomes bidirectional quickly)

### Adding a New Tab Type (Checklist)

When adding a new view:

1. Add the `TabType` in `TabsContext.tsx`
2. Add the `ViewId` + `VIEW_CONFIGS` entry in navigation types
3. Update both directions in `tab-mapping.ts`
4. Update `TabBar` icon/title mapping
5. Ensure `ViewContent` renders the new view for the derived `currentView`

### Example: Tab Context

```tsx
// src/renderer/src/modules/tabs/TabsContext.tsx
import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

// Tab types
export type TabType = 'home' | 'settings' | 'doc' | 'folder';

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  entityId?: string; // For content tabs (doc, folder)
}

interface TabsContextValue {
  tabs: Tab[];
  activeTabId: string | null;
  activeTab: Tab | null;
  openTab: (tab: Omit<Tab, 'id'>) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'home', type: 'home', title: 'Home' }]);
  const [activeTabId, setActiveTabId] = useState<string>('home');

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const openTab = useCallback(
    (tabData: Omit<Tab, 'id'>) => {
      // Check if tab with same entityId already exists
      const existing = tabs.find((t) => t.type === tabData.type && t.entityId === tabData.entityId);

      if (existing) {
        setActiveTabId(existing.id);
        return;
      }

      const newTab: Tab = {
        ...tabData,
        id: `${tabData.type}-${Date.now()}`,
      };

      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    },
    [tabs]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const newTabs = prev.filter((t) => t.id !== tabId);

        // If closing active tab, switch to previous tab
        if (tabId === activeTabId && newTabs.length > 0) {
          const closedIndex = prev.findIndex((t) => t.id === tabId);
          const newActiveIndex = Math.max(0, closedIndex - 1);
          setActiveTabId(newTabs[newActiveIndex].id);
        }

        return newTabs;
      });
    },
    [activeTabId]
  );

  const setActiveTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  return (
    <TabsContext.Provider
      value={{
        tabs,
        activeTabId,
        activeTab,
        openTab,
        closeTab,
        setActiveTab,
      }}
    >
      {children}
    </TabsContext.Provider>
  );
}

export function useTabs(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('useTabs must be used within a TabsProvider');
  }
  return context;
}
```

---

## State Organization Summary

| State Type           | Where to Store           | Persistence                              |
| -------------------- | ------------------------ | ---------------------------------------- |
| Auth state           | `AuthContext`            | Session (via main process)               |
| UI layout (sidebars) | `LayoutContext`          | `localStorage`                           |
| User preferences     | `AppPreferencesContext`  | `localStorage`                           |
| Navigation/Tabs      | `TabsContext`            | None (or `localStorage` for tab history) |
| Page-level UI        | Component state (lifted) | None                                     |
| Form inputs          | Component state          | None                                     |

---

**Language**: All documentation must be written in **English**.
