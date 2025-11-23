# Console Component

The Console component provides web-based management interface for OpenCode enterprise features, including user management, billing, workspace administration, and analytics.

## Architecture Overview

```
┌─────────────────┐
│ Console App     │ ← SolidJS + Kobalte
└─────────────────┘
          │
          ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Routes        │    │   Components    │    │   Context       │
│   (Router)      │    │   (UI)          │    │   (State)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Workspace     │    │   Billing       │    │   User          │
│   Management    │    │   System        │    │   Management    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Core Files

### Main Application (`packages/console/app/src/app.tsx`)

- **Framework**: SolidJS with SolidStart
- **UI Library**: Kobalte for accessible components
- **Routing**: File-based routing with SolidRouter

### Routes (`packages/console/app/src/routes/`)

- **Workspace** (`workspace/[id]/`) - Workspace management
- **Authentication** (`auth/`) - Login/logout flows
- **Enterprise** (`enterprise/`) - Enterprise features
- **API** (`api/`) - API endpoints for console

### Components (`packages/console/app/src/component/`)

- **Header** - Navigation and user menu
- **Modal** - Dialog system
- **Legal** - Terms and privacy

## Workspace Management

### Workspace Overview (`packages/console/app/src/routes/workspace/[id]/index.tsx`)

```typescript
export default function Workspace() {
  const params = useParams()
  const [workspace, setWorkspace] = createSignal<Workspace.Info | null>(null)
  const [loading, setLoading] = createSignal(true)

  createEffect(async () => {
    const data = await fetchWorkspace(params.id)
    setWorkspace(data)
    setLoading(false)
  })

  return (
    <Show when={!loading()}>
      <WorkspaceHeader workspace={workspace()} />
      <WorkspaceTabs workspaceId={params.id} />
      <WorkspaceContent workspace={workspace()} />
    </Show>
  )
}
```

### Workspace Sections

#### Usage Section (`packages/console/app/src/routes/workspace/[id]/usage-section.tsx`)

```typescript
export default function UsageSection() {
  const [usage, setUsage] = createSignal<Usage.Data | null>(null)
  const [period, setPeriod] = createSignal<'month' | 'year'>('month')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage Analytics</CardTitle>
        <Select value={period()} onChange={setPeriod}>
          <SelectItem value="month">Monthly</SelectItem>
          <SelectItem value="year">Yearly</SelectItem>
        </Select>
      </CardHeader>
      <CardContent>
        <UsageChart data={usage()} period={period()} />
        <UsageStats data={usage()} />
      </CardContent>
    </Card>
  )
}
```

#### Model Section (`packages/console/app/src/routes/workspace/[id]/model-section.tsx`)

```typescript
export default function ModelSection() {
  const [models, setModels] = createSignal<Model.Config[]>([])
  const [providers, setProviders] = createSignal<Provider.Info[]>([])

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Model Configuration</CardTitle>
        <Button onClick={() => setShowAddModel(true)}>
          Add Model
        </Button>
      </CardHeader>
      <CardContent>
        <ModelList
          models={models()}
          providers={providers()}
          onEdit={handleEditModel}
          onDelete={handleDeleteModel}
        />
      </CardContent>
    </Card>
  )
}
```

#### Billing Section (`packages/console/app/src/routes/workspace/[id]/billing-section.tsx`)

```typescript
export default function BillingSection() {
  const [billing, setBilling] = createSignal<Billing.Info | null>(null)
  const [subscription, setSubscription] = createSignal<Subscription.Info | null>(null)

  return (
    <div class="billing-section">
      <SubscriptionCard subscription={subscription()} />
      <PaymentMethodSection />
      <UsageCharges usage={billing()?.usage} />
      <InvoicesList invoices={billing()?.invoices} />
    </div>
  )
}
```

## Authentication System

### Authentication Context (`packages/console/app/src/context/auth.ts`)

```typescript
export const AuthContext = createContext<{
  user: AccessControl.User | null
  login: (credentials: LoginCredentials) => Promise<void>
  logout: () => Promise<void>
  loading: boolean
}>()

export function AuthProvider(props: { children: JSX.Element }) {
  const [user, setUser] = createSignal<AccessControl.User | null>(null)
  const [loading, setLoading] = createSignal(false)

  const login = async (credentials: LoginCredentials) => {
    setLoading(true)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
      })
      const userData = await response.json()
      setUser(userData)
      localStorage.setItem('auth_token', userData.token)
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    localStorage.removeItem('auth_token')
  }

  return (
    <AuthContext.Provider value={{ user: user(), login, logout, loading: loading() }}>
      {props.children}
    </AuthContext.Provider>
  )
}
```

### Login Flow (`packages/console/app/src/routes/auth/index.tsx`)

```typescript
export default function Login() {
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal("")
  const { login, loading } = useContext(AuthContext)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    setError("")

    try {
      await login({ email: email(), password: password() })
      navigate('/workspace')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div class="login-container">
      <form onSubmit={handleSubmit}>
        <h2>Sign in to OpenCode</h2>

        <TextField
          label="Email"
          type="email"
          value={email()}
          onChange={setEmail}
          required
        />

        <TextField
          label="Password"
          type="password"
          value={password()}
          onChange={setPassword}
          required
        />

        {error() && (
          <Alert variant="destructive">
            {error()}
          </Alert>
        )}

        <Button
          type="submit"
          disabled={loading()}
          class="w-full"
        >
          {loading() ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </div>
  )
}
```

## User Management

### Members Section (`packages/console/app/src/routes/workspace/[id]/members/`)

```typescript
export default function MembersSection() {
  const [members, setMembers] = createSignal<User.Member[]>([])
  const [invites, setInvites] = createSignal<Invite.Info[]>([])

  return (
    <div class="members-section">
      <SectionHeader
        title="Team Members"
        action={
          <Button onClick={() => setShowInviteDialog(true)}>
            Invite Member
          </Button>
        }
      />

      <MembersList members={members()} />
      <PendingInvites invites={invites()} />

      <InviteDialog
        open={showInviteDialog()}
        onClose={() => setShowInviteDialog(false)}
        onInvite={handleInvite}
      />
    </div>
  )
}
```

### Role Management (`packages/console/app/src/routes/workspace/[id]/members/role-dropdown.tsx`)

```typescript
export function RoleDropdown(props: RoleDropdownProps) {
  const [open, setOpen] = createSignal(false)

  const roles = [
    { value: 'admin', label: 'Admin', description: 'Full access' },
    { value: 'member', label: 'Member', description: 'Standard access' },
    { value: 'viewer', label: 'Viewer', description: 'Read-only access' },
  ]

  return (
    <DropdownMenu open={open()} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          {getCurrentRoleLabel(props.currentRole)}
          <ChevronDown class="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        <For each={roles}>
          {role => (
            <DropdownMenuItem
              onClick={() => props.onChange(role.value)}
              disabled={role.value === props.currentRole}
            >
              <div>
                <div class="font-medium">{role.label}</div>
                <div class="text-sm text-muted-foreground">
                  {role.description}
                </div>
              </div>
            </DropdownMenuItem>
          )}
        </For>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

## API Integration

### API Client (`packages/console/app/src/lib/api.ts`)

```typescript
export class ConsoleAPI {
  constructor(
    private baseURL: string,
    private token: string,
  ) {}

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        ...options.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`)
    }

    return response.json()
  }

  // Workspace methods
  async getWorkspace(id: string): Promise<Workspace.Info> {
    return this.request<Workspace.Info>(`/workspace/${id}`)
  }

  async updateWorkspace(id: string, data: Partial<Workspace.Info>): Promise<Workspace.Info> {
    return this.request<Workspace.Info>(`/workspace/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  }

  // User methods
  async getMembers(workspaceId: string): Promise<User.Member[]> {
    return this.request<User.Member[]>(`/workspace/${workspaceId}/members`)
  }

  async inviteMember(workspaceId: string, invite: Invite.Create): Promise<Invite.Info> {
    return this.request<Invite.Info>(`/workspace/${workspaceId}/invite`, {
      method: "POST",
      body: JSON.stringify(invite),
    })
  }

  // Billing methods
  async getUsage(workspaceId: string, period: string): Promise<Usage.Data> {
    return this.request<Usage.Data>(`/workspace/${workspaceId}/usage?period=${period}`)
  }

  async getInvoices(workspaceId: string): Promise<Billing.Invoice[]> {
    return this.request<Billing.Invoice[]>(`/workspace/${workspaceId}/invoices`)
  }
}
```

### API Routes (`packages/console/app/src/routes/api/`)

```typescript
// packages/console/app/src/routes/api/enterprise.ts
export async function GET({ request }) {
  const user = await authenticate(request)
  if (!user) {
    return new Response("Unauthorized", { status: 401 })
  }

  const workspaces = await getUserWorkspaces(user.id)
  return Response.json(workspaces)
}

export async function POST({ request }) {
  const data = await request.json()
  const workspace = await createWorkspace(data)
  return Response.json(workspace)
}
```

## Enterprise Features

### Enterprise Dashboard (`packages/console/app/src/routes/enterprise/index.tsx`)

```typescript
export default function EnterpriseDashboard() {
  const [stats, setStats] = createSignal<Enterprise.Stats | null>(null)
  const [workspaces, setWorkspaces] = createSignal<Workspace.Info[]>([])

  return (
    <div class="enterprise-dashboard">
      <StatsOverview stats={stats()} />
      <RecentWorkspaces workspaces={workspaces()} />
      <QuickActions />
    </div>
  )
}
```

### Advanced Configuration

```typescript
// Enterprise settings
export default function EnterpriseSettings() {
  const [settings, setSettings] = createSignal<Enterprise.Config>({
    sso: {
      enabled: false,
      provider: 'oauth2',
    },
    security: {
      mfa: 'optional',
      sessionTimeout: 24, // hours
    },
    compliance: {
      dataRetention: 365, // days
      auditLogging: true,
    },
  })

  return (
    <Tabs defaultValue="sso">
      <TabsList>
        <TabsTrigger value="sso">SSO Configuration</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
        <TabsTrigger value="compliance">Compliance</TabsTrigger>
      </TabsList>

      <TabsContent value="sso">
        <SSOConfiguration
          config={settings().sso}
          onChange={(sso) => setSettings(prev => ({ ...prev, sso }))}
        />
      </TabsContent>

      <TabsContent value="security">
        <SecuritySettings
          config={settings().security}
          onChange={(security) => setSettings(prev => ({ ...prev, security }))}
        />
      </TabsContent>

      <TabsContent value="compliance">
        <ComplianceSettings
          config={settings().compliance}
          onChange={(compliance) => setSettings(prev => ({ ...prev, compliance }))}
        />
      </TabsContent>
    </Tabs>
  )
}
```

## UI Components

### Card System

```typescript
// Reusable card component
export function Card(props: CardProps) {
  return (
    <div class="card">
      <Show when={props.header}>
        <div class="card-header">
          {props.header}
        </div>
      </Show>

      <div class="card-content">
        {props.children}
      </div>

      <Show when={props.footer}>
        <div class="card-footer">
          {props.footer}
        </div>
      </Show>
    </div>
  )
}
```

### Data Tables

```typescript
// Enhanced data table with sorting and filtering
export function DataTable<T>(props: DataTableProps<T>) {
  const [sortConfig, setSortConfig] = createSignal<SortConfig | null>(null)
  const [filter, setFilter] = createSignal("")

  const sortedAndFilteredData = createMemo(() => {
    return props.data
      .filter(item =>
        filter() === "" ||
        Object.values(item).some(value =>
          String(value).toLowerCase().includes(filter().toLowerCase())
        )
      )
      .sort((a, b) => {
        if (!sortConfig()) return 0

        const aValue = a[sortConfig()!.key]
        const bValue = b[sortConfig()!.key]

        if (aValue < bValue) return sortConfig()!.direction === 'asc' ? -1 : 1
        if (aValue > bValue) return sortConfig()!.direction === 'asc' ? 1 : -1
        return 0
      })
  })

  return (
    <div class="data-table">
      <div class="table-controls">
        <TextField
          placeholder="Filter..."
          value={filter()}
          onChange={setFilter}
        />
      </div>

      <table class="table">
        <thead>
          <tr>
            <For each={props.columns}>
              {column => (
                <th>
                  <Button
                    variant="ghost"
                    onClick={() => toggleSort(column.key)}
                  >
                    {column.title}
                    <Show when={sortConfig()?.key === column.key}>
                      <ArrowUpDown class="ml-2 h-4 w-4" />
                    </Show>
                  </Button>
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={sortedAndFilteredData()}>
            {item => (
              <tr>
                <For each={props.columns}>
                  {column => (
                    <td>{column.render(item)}</td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}
```

## Styling System

### Theme Configuration

```css
/* packages/console/app/src/style/index.css */
:root {
  --opencode-primary: #2563eb;
  --opencode-primary-foreground: #ffffff;
  --opencode-secondary: #64748b;
  --opencode-secondary-foreground: #ffffff;
  --opencode-background: #ffffff;
  --opencode-foreground: #0f172a;
  --opencode-card: #ffffff;
  --opencode-card-foreground: #0f172a;
  --opencode-border: #e2e8f0;
  --opencode-input: #ffffff;
  --opencode-ring: #2563eb;
}

[data-theme="dark"] {
  --opencode-primary: #3b82f6;
  --opencode-primary-foreground: #ffffff;
  --opencode-secondary: #475569;
  --opencode-secondary-foreground: #ffffff;
  --opencode-background: #0f172a;
  --opencode-foreground: #f8fafc;
  --opencode-card: #1e293b;
  --opencode-card-foreground: #f8fafc;
  --opencode-border: #334155;
  --opencode-input: #1e293b;
  --opencode-ring: #3b82f6;
}
```

### Component Styles

```css
/* Card styles */
.card {
  background-color: var(--opencode-card);
  color: var(--opencode-card-foreground);
  border: 1px solid var(--opencode-border);
  border-radius: 0.5rem;
  padding: 1.5rem;
  box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.card-content {
  flex: 1;
}

/* Data table styles */
.data-table {
  border: 1px solid var(--opencode-border);
  border-radius: 0.5rem;
  overflow: hidden;
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table th,
.table td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--opencode-border);
}

.table th {
  background-color: var(--opencode-secondary);
  color: var(--opencode-secondary-foreground);
  font-weight: 600;
}
```

## Performance Optimizations

### Code Splitting

```typescript
// Lazy loading for better performance
const WorkspaceSection = lazy(() => import("./workspace/[id]/index.tsx"))
const BillingSection = lazy(() => import("./workspace/[id]/billing-section.tsx"))
const MembersSection = lazy(() => import("./workspace/[id]/members/index.tsx"))
```

### Data Caching

```typescript
// API response caching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
    },
  },
})

// Usage in components
const { data: workspace, loading } = useQuery({
  queryKey: ["workspace", id],
  queryFn: () => api.getWorkspace(id),
})
```

### Virtual Scrolling

```typescript
// Efficient large list rendering
export function VirtualList<T>(props: VirtualListProps<T>) {
  const [visibleRange, setVisibleRange] = createSignal({ start: 0, end: 50 })

  return (
    <div
      class="virtual-list"
      style={{ height: props.height }}
      onScroll={handleScroll}
    >
      <div style={{ height: `${props.items.length * props.itemHeight}px` }}>
        <For each={props.items.slice(visibleRange().start, visibleRange().end)}>
          {(item, index) => (
            <div
              style={{
                position: 'absolute',
                top: `${(visibleRange().start + index()) * props.itemHeight}px`,
                width: '100%',
                height: `${props.itemHeight}px`,
              }}
            >
              {props.renderItem(item, visibleRange().start + index())}
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
```

## Security Features

### Access Control

```typescript
// Role-based access control
export function usePermissions() {
  const { user } = useContext(AuthContext)

  const hasPermission = (permission: string): boolean => {
    if (!user()) return false

    const userRole = user().role
    return ROLE_PERMISSIONS[userRole]?.includes(permission) || false
  }

  return { hasPermission }
}

// Usage in components
const { hasPermission } = usePermissions()

<Show when={hasPermission('workspace:edit')}>
  <Button onClick={handleEdit}>Edit Workspace</Button>
</Show>
```

### Audit Logging

```typescript
// Audit trail for sensitive actions
export async function logAuditEvent(event: AuditEvent) {
  await fetch("/api/audit", {
    method: "POST",
    body: JSON.stringify({
      ...event,
      timestamp: new Date().toISOString(),
      userId: getCurrentUser().id,
    }),
  })
}

// Usage
await logAuditEvent({
  action: "workspace:member:invite",
  resource: `workspace:${workspaceId}`,
  details: { email: inviteEmail, role: "member" },
})
```

The Console component provides a comprehensive web-based management interface for OpenCode enterprise features, combining modern UI patterns with robust security and performance optimizations.
