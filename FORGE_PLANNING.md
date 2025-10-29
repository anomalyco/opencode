# OpenCode FORGE - Plano de Implementação

## 🎯 Visão Geral

**FORGE** é uma área de gerenciamento de tarefas de desenvolvimento que integra o OpenCode com Git, transformando issues e pull requests em um fluxo de trabalho automatizado visualizado em um quadro Kanban com atualizações em tempo real.

### Conceito

```
GitHub Issues/PRs → FORGE → OpenCode Agent → Execução Automática → Git Commits → Status Updates
                      ↓                                                                ↑
                  Kanban Board ←─────────────── WebSocket Real-time ─────────────────┘
```

## 🏗️ Arquitetura

### Componentes Principais

```
┌─────────────────────────────────────────────────────────────┐
│                     FORGE UI (Frontend)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Kanban     │  │ Task Detail  │  │  Activity    │     │
│  │   Board      │  │    Panel     │  │    Feed      │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────────┬────────────────────────────────────┘
                         │ WebSocket + REST
┌────────────────────────▼────────────────────────────────────┐
│                  FORGE Backend (Server)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Task       │  │   GitHub     │  │   Agent      │     │
│  │   Manager    │  │  Integration │  │   Executor   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│              OpenCode Core + Git Operations                  │
└─────────────────────────────────────────────────────────────┘
```

## 📊 Estrutura de Dados

### Task (Tarefa)

```typescript
interface ForgeTask {
  id: string                    // Unique ID
  type: "issue" | "pr"          // GitHub issue ou pull request
  title: string                 // Título da tarefa
  description: string           // Descrição completa
  status: TaskStatus            // Status atual
  priority: "low" | "medium" | "high" | "urgent"

  // Git Integration
  githubId?: number             // ID do GitHub
  repoOwner: string             // Owner do repositório
  repoName: string              // Nome do repositório
  branch?: string               // Branch de trabalho
  baseBranch: string            // Branch base (main/master)

  // OpenCode Integration
  sessionId?: string            // Sessão OpenCode
  agentId?: string              // Agente executando

  // Metadata
  assignee?: string             // Quem está trabalhando
  labels: string[]              // Labels/tags
  createdAt: number             // Timestamp criação
  updatedAt: number             // Timestamp última atualização
  completedAt?: number          // Timestamp conclusão

  // Execution
  steps: TaskStep[]             // Passos da execução
  currentStep?: number          // Passo atual
  progress: number              // 0-100%

  // Files
  filesChanged: string[]        // Arquivos modificados
  commits: GitCommit[]          // Commits relacionados

  // Activity
  activities: TaskActivity[]    // Histórico de atividades
}

type TaskStatus =
  | "backlog"      // Não iniciada
  | "todo"         // Pronta para começar
  | "in_progress"  // Em execução
  | "review"       // Em revisão
  | "testing"      // Em teste
  | "blocked"      // Bloqueada
  | "done"         // Concluída
  | "cancelled"    // Cancelada

interface TaskStep {
  id: string
  description: string
  status: "pending" | "running" | "completed" | "failed"
  tool?: string                 // Tool usado (bash, edit, etc)
  startedAt?: number
  completedAt?: number
  output?: string
  error?: string
}

interface TaskActivity {
  id: string
  type: "created" | "started" | "status_changed" | "step_completed" |
        "commit" | "comment" | "assigned" | "completed"
  timestamp: number
  actor: "user" | "agent" | "system"
  message: string
  metadata?: any
}

interface GitCommit {
  sha: string
  message: string
  author: string
  timestamp: number
  filesChanged: string[]
}
```

## 🎨 Interface do Usuário

### 1. Kanban Board

```
┌─────────────────────────────────────────────────────────────────────┐
│ FORGE                                      [Import] [New Task] [•••] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  BACKLOG (3)   TODO (2)     IN PROGRESS (1)    REVIEW (1)   DONE (5)│
│  ┌────────┐   ┌────────┐   ┌─────────────┐   ┌────────┐  ┌────────┐│
│  │#123    │   │#125    │   │#126 🔄      │   │#127    │  │#128 ✓ ││
│  │Add auth│   │Fix bug │   │Create API   │   │Update  │  │Setup   ││
│  │        │   │Priority│   │ ┌─────────┐ │   │docs    │  │CI/CD   ││
│  │[Label] │   │High    │   │ │■■■■■□□□ │ │   │        │  │        ││
│  └────────┘   │[Label] │   │ │65%      │ │   │[Label] │  │[Label] ││
│               └────────┘   │ └─────────┘ │   └────────┘  └────────┘│
│  ┌────────┐                │ 3/5 steps   │               ┌────────┐│
│  │#124    │                │ Agent: GPT4 │               │#129 ✓ ││
│  │Deploy  │                └─────────────┘               │Add     ││
│  │        │                                              │tests   ││
│  │[Label] │                                              └────────┘│
│  └────────┘                                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### 2. Task Detail Panel

```
┌────────────────────────────────────────────────┐
│ Task #126: Create REST API                [×] │
├────────────────────────────────────────────────┤
│ Status: IN PROGRESS (65%)                      │
│ Priority: HIGH                                 │
│ Assignee: OpenCode Agent (claude-sonnet)       │
│ Branch: feature/rest-api-126                   │
│                                                │
│ Description:                                   │
│ Create a RESTful API with CRUD operations...  │
│                                                │
│ ┌──────────────────────────────────────────┐  │
│ │ Steps (3/5 completed):                   │  │
│ │ ✓ 1. Analyze requirements                │  │
│ │ ✓ 2. Create API structure                │  │
│ │ ✓ 3. Implement routes                    │  │
│ │ 🔄 4. Add validation [Running...]        │  │
│ │   └─ Tool: edit (controllers/api.ts)    │  │
│ │ ⏳ 5. Write tests                        │  │
│ └──────────────────────────────────────────┘  │
│                                                │
│ Files Changed (4):                             │
│ • src/routes/api.ts [+120, -5]                │
│ • src/controllers/api.ts [+85, -0]            │
│ • src/middleware/validator.ts [+45, -0]       │
│ • package.json [+2, -0]                       │
│                                                │
│ Commits (2):                                   │
│ • abc123 "feat: add API routes"               │
│ • def456 "feat: implement controllers"        │
│                                                │
│ ┌──────────────────────────────────────────┐  │
│ │ Activity Feed:                           │  │
│ │ [15:30] Agent started step 4             │  │
│ │ [15:28] Agent completed step 3           │  │
│ │ [15:25] Commit: feat: implement routes   │  │
│ │ [15:20] Agent started task               │  │
│ └──────────────────────────────────────────┘  │
│                                                │
│ [Pause] [Cancel] [Open in Editor] [View PR]  │
└────────────────────────────────────────────────┘
```

### 3. Activity Feed (Live Updates)

```
┌──────────────────────────────────────────┐
│ Live Activity Feed              [Filter]│
├──────────────────────────────────────────┤
│                                          │
│ 🟢 #126 - Agent executing step 4/5      │
│    └─ Running: edit controller          │
│    └─ Time: 00:15                       │
│                                          │
│ ✅ #127 - Review completed              │
│    └─ Merged to main                    │
│    └─ 2 minutes ago                     │
│                                          │
│ 🔵 #125 - Moved to TODO                 │
│    └─ Ready to start                    │
│    └─ 5 minutes ago                     │
│                                          │
│ 🟡 #124 - Waiting for dependencies      │
│    └─ Blocked by #123                   │
│    └─ 10 minutes ago                    │
│                                          │
└──────────────────────────────────────────┘
```

## 🔄 Fluxo de Trabalho

### Cenário 1: Import de GitHub Issue

```
1. User clica "Import" no FORGE
2. User cola URL do issue ou seleciona do repositório
3. Sistema busca issue do GitHub via API
4. Cria ForgeTask com status "backlog"
5. Exibe no quadro Kanban
```

### Cenário 2: Execução Automática

```
1. User arrasta task de "TODO" para "IN PROGRESS"
2. Sistema cria nova sessão OpenCode
3. Sistema envia task description ao agente
4. Agente analisa e cria plano de execução (steps)
5. WebSocket envia updates em tempo real:
   - Step iniciado
   - Tool executado
   - Arquivo modificado
   - Commit criado
6. UI atualiza progress bar e atividades
7. Quando completo, move para "REVIEW"
```

### Cenário 3: Criação de PR

```
1. Task completa no status "REVIEW"
2. Sistema cria branch no Git
3. Sistema faz commits dos arquivos modificados
4. Sistema cria Pull Request no GitHub
5. Adiciona link do PR na task
6. Notifica user
```

## 🔌 API Endpoints

### Tasks

```
GET    /forge/tasks                    # Listar todas tasks
POST   /forge/tasks                    # Criar task
GET    /forge/tasks/:id                # Detalhe da task
PATCH  /forge/tasks/:id                # Atualizar task
DELETE /forge/tasks/:id                # Deletar task
POST   /forge/tasks/:id/start          # Iniciar execução
POST   /forge/tasks/:id/pause          # Pausar execução
POST   /forge/tasks/:id/cancel         # Cancelar execução
```

### GitHub Integration

```
POST   /forge/import/github            # Importar issue/PR
GET    /forge/github/repos             # Listar repositórios
GET    /forge/github/issues            # Listar issues
POST   /forge/github/pr                # Criar Pull Request
```

### WebSocket Events

```typescript
// Server → Client
{
  type: "forge.task.created"
  data: { task: ForgeTask }
}

{
  type: "forge.task.status_changed"
  data: { taskId: string, oldStatus: string, newStatus: string }
}

{
  type: "forge.task.step_started"
  data: { taskId: string, step: TaskStep }
}

{
  type: "forge.task.step_completed"
  data: { taskId: string, step: TaskStep }
}

{
  type: "forge.task.progress"
  data: { taskId: string, progress: number }
}

{
  type: "forge.task.commit"
  data: { taskId: string, commit: GitCommit }
}

{
  type: "forge.task.activity"
  data: { taskId: string, activity: TaskActivity }
}

// Client → Server
{
  type: "forge.task.move"
  data: { taskId: string, newStatus: TaskStatus }
}

{
  type: "forge.task.subscribe"
  data: { taskId: string }
}
```

## 🗂️ Estrutura de Arquivos

```
packages/webapp/src/
├── components/forge/
│   ├── KanbanBoard.tsx           # Quadro principal
│   ├── KanbanColumn.tsx          # Coluna do Kanban
│   ├── TaskCard.tsx              # Card da task
│   ├── TaskDetail.tsx            # Painel de detalhes
│   ├── TaskActivityFeed.tsx      # Feed de atividades
│   ├── TaskStepList.tsx          # Lista de passos
│   ├── GitHubImport.tsx          # Modal de import
│   └── CreateTaskModal.tsx       # Modal criar task
├── stores/
│   └── forge.ts                  # Store do FORGE
└── types/
    └── forge.ts                  # Types do FORGE

packages/opencode/src/
├── forge/
│   ├── task-manager.ts           # Gerenciador de tasks
│   ├── github-integration.ts     # Integração GitHub
│   ├── agent-executor.ts         # Executor de tasks
│   └── task-storage.ts           # Storage de tasks
└── server/
    └── forge-routes.ts           # Routes da API
```

## 🎯 Fases de Implementação

### Fase 1: Fundação (Semana 1)
**Objetivo**: Estrutura básica do FORGE

- [ ] Definir tipos e interfaces TypeScript
- [ ] Criar store do FORGE (stores/forge.ts)
- [ ] Implementar API básica no backend
- [ ] Criar storage de tasks (JSON ou SQLite)
- [ ] Implementar WebSocket events

**Entregável**: Backend funcionando com CRUD de tasks

### Fase 2: UI Básica (Semana 2)
**Objetivo**: Kanban board funcional

- [ ] Componente KanbanBoard
- [ ] Componente KanbanColumn
- [ ] Componente TaskCard
- [ ] Drag and drop entre colunas
- [ ] Modal criar task manual
- [ ] Integração com store

**Entregável**: Kanban board visual com tasks movíveis

### Fase 3: Integração GitHub (Semana 3)
**Objetivo**: Import de issues e PRs

- [ ] GitHub API integration
- [ ] OAuth authentication
- [ ] Import de issues
- [ ] Import de PRs
- [ ] Modal de import
- [ ] Sincronização bidirecional

**Entregável**: Import funcional de GitHub issues

### Fase 4: Execução Automática (Semana 4)
**Objetivo**: OpenCode executando tasks

- [ ] Agent executor
- [ ] Task planning (criar steps)
- [ ] Tool execution tracking
- [ ] Progress updates via WebSocket
- [ ] File change tracking
- [ ] Commit creation

**Entregável**: Agent executando tasks automaticamente

### Fase 5: Git Integration (Semana 5)
**Objetivo**: Operações Git automáticas

- [ ] Branch creation
- [ ] Commit creation
- [ ] PR creation automática
- [ ] Git status tracking
- [ ] Conflict detection

**Entregável**: Tasks criando PRs automaticamente

### Fase 6: Task Detail & Activity (Semana 6)
**Objetivo**: Visualização detalhada

- [ ] TaskDetail panel
- [ ] TaskActivityFeed
- [ ] TaskStepList com status
- [ ] File changes visualization
- [ ] Commit history
- [ ] Real-time updates

**Entregável**: UI completa com visualização em tempo real

### Fase 7: Refinamentos (Semana 7-8)
**Objetivo**: Polimento e features extras

- [ ] Task filtering e search
- [ ] Labels e tags
- [ ] Priority sorting
- [ ] Assignee management
- [ ] Task templates
- [ ] Bulk operations
- [ ] Analytics dashboard
- [ ] Notifications

**Entregável**: FORGE production-ready

## 🎨 Design System

### Cores por Status

```css
.status-backlog   { background: #374151; border-left: 4px solid #6B7280; }
.status-todo      { background: #1E3A8A; border-left: 4px solid #3B82F6; }
.status-progress  { background: #065F46; border-left: 4px solid #10B981; }
.status-review    { background: #92400E; border-left: 4px solid #F59E0B; }
.status-testing   { background: #6D28D9; border-left: 4px solid #A78BFA; }
.status-blocked   { background: #991B1B; border-left: 4px solid #EF4444; }
.status-done      { background: #14532D; border-left: 4px solid #22C55E; }
```

### Iconografia

- 🔄 = Em progresso (animado)
- ✓ = Completo
- ⏳ = Aguardando
- 🚫 = Bloqueado
- ⚠️ = Warning
- 🔧 = Tool em uso
- 💬 = Comentário
- 📝 = Commit
- 🔀 = Pull Request

## 🔐 Segurança

### GitHub OAuth
- Armazenar tokens de forma segura
- Refresh tokens automaticamente
- Permissões mínimas necessárias
- Revogação de acesso

### Execução de Tasks
- Validação de comandos perigosos
- Sandbox para execução
- Rate limiting
- Logs de auditoria

## 📊 Analytics & Metrics

### Métricas por Task
- Tempo de execução
- Número de steps
- Files modificados
- Commits gerados
- Taxa de sucesso

### Métricas Globais
- Tasks por status
- Tempo médio de conclusão
- Throughput (tasks/dia)
- Success rate
- Blocker analysis

## 🚀 Exemplo de Uso Completo

### 1. User importa issue do GitHub

```
Issue #456: "Add user authentication"
Description: Implement JWT-based authentication system...
Labels: [enhancement, high-priority]
```

### 2. FORGE cria task

```
Task criada no status "BACKLOG"
- ID: forge-001
- GitHub: #456
- Repo: myorg/myapp
- Branch base: main
```

### 3. User move para "IN PROGRESS"

```
Sistema:
- Cria branch: feature/auth-456
- Cria sessão OpenCode
- Envia task ao agente
```

### 4. Agente analisa e planeja

```
Steps criados:
1. Analyze current authentication
2. Install JWT dependencies
3. Create auth middleware
4. Update user model
5. Add auth routes
6. Write tests
```

### 5. Agente executa (tempo real no UI)

```
[15:00] Step 1 started...
[15:02] Step 1 completed ✓
[15:02] Step 2 started...
[15:03] Tool: bash (npm install jsonwebtoken)
[15:04] Step 2 completed ✓
[15:04] Step 3 started...
[15:05] Tool: write (src/middleware/auth.ts)
[15:06] Tool: edit (src/server.ts)
[15:07] Commit: feat: add auth middleware (abc123)
[15:07] Step 3 completed ✓
...
```

### 6. Task completa

```
Sistema:
- Move para "REVIEW"
- Push branch para GitHub
- Cria Pull Request automaticamente
- Notifica user
- Adiciona link do PR na task
```

### 7. User revisa e aprova

```
User:
- Revisa código no GitHub
- Aprova PR
- Merge para main

Sistema:
- Detecta merge via webhook
- Move task para "DONE"
- Atualiza métricas
```

## 🎯 Benefícios

### Para Desenvolvedores
- ✅ Visualização clara do trabalho
- ✅ Automação de tarefas repetitivas
- ✅ Integração Git simplificada
- ✅ Feedback em tempo real
- ✅ Menos context switching

### Para Times
- ✅ Transparência total do progresso
- ✅ Métricas de produtividade
- ✅ Identificação de blockers
- ✅ Histórico completo
- ✅ Colaboração eficiente

### Para Projetos
- ✅ Delivery mais rápido
- ✅ Qualidade consistente
- ✅ Documentação automática
- ✅ Rastreabilidade completa
- ✅ Previsibilidade melhorada

## 📝 Próximos Passos

1. **Revisão do Plano**
   - Validar arquitetura
   - Ajustar estimativas
   - Priorizar features

2. **Protótipo**
   - Criar mockups de alta fidelidade
   - Validar UX com usuários
   - Testar fluxos principais

3. **Implementação**
   - Seguir fases definidas
   - Testes contínuos
   - Deploy incremental

4. **Feedback Loop**
   - Coletar feedback de usuários
   - Iterar rapidamente
   - Melhorias contínuas

---

**Criado**: 2025-10-29
**Versão**: 1.0
**Status**: 📋 Planejamento Completo

**Pronto para implementação!** 🚀
