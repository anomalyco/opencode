# Token Management System — Architecture & Roadmap

> **Hito**: Sistema de asignación y consumo de tokens por usuario con balanceo de modelos gratuitos (OpenCode Zen) y modelos pagos.
> **Contexto**: OpenCode Desktop con autenticación Microsoft OAuth, sidecar local, múltiples providers.

## 1. Visión General

Sistema que permite al administrador de una instalación OpenCode Desktop:

1. **Identificar usuarios** por su cuenta Microsoft (email, nombre, OID)
2. **Asignar créditos** en tokens a cada usuario
3. **Balancear carga**: primero consume modelos gratuitos (OpenCode Zen), luego modelos pagos
4. **Controlar gasto**: cada request deducta tokens del balance del usuario

```
Usuario → Microsoft Login → User Identity (email, name, oid)
                                       ↓
                          Token Balance (X tokens asignados)
                                       ↓
                  Model Router → Free Zen? → Sí → Usa Zen (sin costo)
                                       ↓ No
                  ¿Balance suficiente? → No → Bloquear / Upsell
                                       ↓ Sí
                  Usa modelo pago → Deducta tokens → Registro de uso
```

## 2. Componentes

### 2.1 User Identity Enhancement

**Estado actual**: `auth.json` solo guarda `accountId` (Microsoft OID). El JWT contiene `preferred_username`, `name`, `oid`, `tid` pero se descarta.

**Cambio necesario**:

- Extender `Auth.Oauth` para incluir `email`, `displayName`, `tenantId`
- Decodificar el JWT (`id_token` o `access_token`) durante el login de Microsoft
- Persistir via `PUT /auth/microsoft` en el schema widened

```typescript
interface OauthExtended {
  type: "oauth"
  access: string
  refresh: string
  expires: number
  accountId: string        // Microsoft OID (existing)
  email?: string           // preferred_username del JWT
  displayName?: string     // name del JWT
  tenantId?: string        // tid del JWT
}
```

### 2.2 User Table (SQLite)

Nueva tabla en la base de datos local del sidecar:

```sql
CREATE TABLE user_identity (
  id            TEXT PRIMARY KEY,          -- Microsoft OID
  email         TEXT NOT NULL,
  display_name  TEXT,
  tenant_id     TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at INTEGER NOT NULL DEFAULT (unixepoch()),
  is_admin      INTEGER NOT NULL DEFAULT 0  -- primer usuario en asignarse admin
);

CREATE TABLE token_balance (
  user_id       TEXT PRIMARY KEY REFERENCES user_identity(id),
  balance       INTEGER NOT NULL DEFAULT 0,     -- tokens disponibles
  lifetime_used INTEGER NOT NULL DEFAULT 0,     -- tokens totales consumidos
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE token_transaction (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES user_identity(id),
  amount        INTEGER NOT NULL,            -- positivo = crédito, negativo = consumo
  description   TEXT,                        -- "Admin credit", "Model: claude-sonnet-4-5"
  session_id    TEXT,                        -- referencia a SessionV2
  model         TEXT,                        -- modelo usado
  tokens_used   INTEGER,                     -- tokens reales del request
  cost_usd      REAL,                        -- costo estimado en USD
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_tx_user ON token_transaction(user_id, created_at);
```

### 2.3 Token Pricing Registry

Mapeo de modelos a costo en tokens:

```typescript
interface TokenPricing {
  modelId: string
  tokensPerRequest: number      // tokens fijos que cobra por request
  tokensPerInputToken: number   // tokens por token de input
  tokensPerOutputToken: number  // tokens por token de output
  tier: "free" | "paid"         // free = OpenCode Zen, no consume balance
}
```

**Free tier** (OpenCode Zen): `tier: "free"` → no deducta del balance.
**Paid models** (Claude, GPT, Gemini, etc.): `tier: "paid"` → deducta según pricing.

### 2.4 Token Budget Service

Nuevo servicio en `packages/opencode/src/provider/budget.ts` (o similar):

```typescript
interface BudgetService {
  // Verifica si el usuario puede usar un modelo
  check(userId: string, modelId: string, estimatedTokens: number): Effect<boolean, BudgetExceededError>
  
  // Deducta tokens después del request
  deduct(userId: string, modelId: string, actualTokens: number, sessionId: string): Effect<void>
  
  // Obtiene el mejor modelo disponible para el usuario
  resolveModel(userId: string, preferredModel: string): Effect<string, Error>
  
  // Asigna créditos (solo admin)
  credit(userId: string, amount: number, description: string): Effect<void>
}
```

### 2.5 Model Router (Free First)

Lógica de resolución de modelo en `LLM.run` (`session/llm.ts`):

```
1. User request: "Usa claude-sonnet-4-5"
2. BudgetService.resolveModel("user-oid", "claude-sonnet-4-5")
   a. ¿OpenCode Zen disponible? → devuelve modelo Zen gratuito
   b. ¿Balance suficiente para claude-sonnet-4-5? → devuelve claude-sonnet-4-5
   c. ¿Balance suficiente para small model (gpt-5-nano)? → devuelve small model
   d. No hay balance → BudgetExceededError
3. Ejecuta request con modelo resuelto
4. Post-request: BudgetService.deduct() con tokens reales consumidos
```

### 2.6 Admin Dashboard

Interfaz en el desktop (ruta `/admin` o modal en settings):

- Lista de usuarios (email, display name, último login)
- Balance actual de cada usuario
- Historial de transacciones
- Botón para asignar créditos (modal con monto + descripción)
- Gráfico de uso diario/semanal

Acceso: solo usuarios con `is_admin = true`. El primer usuario en loguearse después del deploy se auto-asigna admin.

### 2.7 Sidecar API Endpoints

Nuevos endpoints en el sidecar HTTP API:

```
GET  /admin/users                    → lista de usuarios con balances
POST /admin/users/:id/credit         → asigna créditos (body: { amount, description })
GET  /admin/users/:id/transactions   → historial de transacciones
GET  /me                            → user identity + balance (para el renderer)
GET  /me/transactions                → mis transacciones
```

## 3. Flujo Completo

### 3.1 Login y Registro de Usuario

```
1. User abre app → login-gate muestra dialog Microsoft OAuth
2. User autoriza → recibimos authorization code → exchange por tokens
3. Decodificamos JWT → extraemos oid, preferred_username, name, tid
4. POST /auth/microsoft con OauthExtended (incluye email, displayName)
5. Sidecar guarda en auth.json + upsert en user_identity table
6. Si es el primer usuario → is_admin = true
7. Renderer obtiene GET /me → muestra "Signed in as user@email.com"
```

### 3.2 Selección y Consumo de Modelo

```
1. User selecciona modelo en la UI (ej: claude-sonnet-4-5)
2. LLM.run() → BudgetService.resolveModel(userId, "claude-sonnet-4-5")
3. Si free tier disponible → usa OpenCode Zen (sin cargo)
4. Si no → verifica balance para claude-sonnet-4-5
5. Si balance OK → ejecuta request normalmente
6. Post-request → calcula tokens reales → BudgetService.deduct()
7. INSERT token_transaction (amount negativo, modelo, tokens usados)
8. UPDATE token_balance SET balance = balance - cost
```

### 3.3 Asignación de Créditos (Admin)

```
1. Admin abre /admin → ve lista de usuarios
2. Selecciona usuario → modal "Asignar créditos"
3. Ingresa monto (en tokens) + descripción opcional
4. POST /admin/users/:id/credit → INSERT token_transaction (positivo)
5. UPDATE token_balance SET balance = balance + amount
6. UI actualiza balance del usuario
```

## 4. Token Pricing Estrategia

### Modelo de Cobro Sugerido

| Provider | Modelo | Tokens por request base | Tokens por input token | Tokens por output token |
|----------|--------|------------------------|----------------------|-----------------------|
| OpenCode Zen | Cualquiera | 0 (FREE) | 0 (FREE) | 0 (FREE) |
| Anthropic | claude-sonnet-4-5 | 1000 | 3 | 15 |
| Anthropic | claude-haiku-4-5 | 500 | 1 | 5 |
| OpenAI | gpt-4o | 800 | 2.5 | 10 |
| OpenAI | gpt-4.1-mini | 400 | 0.4 | 1.6 |
| OpenAI | gpt-5-nano | 200 | 0.15 | 0.6 |
| Google | gemini-2.5-flash | 300 | 0.1 | 0.4 |

**Nota**: Los valores son tokens virtuales del sistema, no equivalentes a tokens reales de la API. Sirven como unidad de cuenta interna.

### Asignación Sugerida

- Usuario nuevo: 100,000 tokens de bienvenida (∼$5 USD equivalent)
- Recarga mensual típica: 200,000 tokens (∼$10 USD)
- Admin puede asignar cualquier monto

## 5. Implementación por Fases

### Fase 1: Fundación (MVP)
- [ ] Extender `Auth.Oauth` con `email`, `displayName`, `tenantId`
- [ ] Decodificar JWT en login-gate y plugin Microsoft
- [ ] Crear `user_identity`, `token_balance`, `token_transaction` tables
- [ ] `GET /me` endpoint + IPC
- [ ] Mostrar "Signed in as {email}" en el desktop
- [ ] Primer usuario = admin

### Fase 2: Token Engine
- [ ] `BudgetService` con `check`, `deduct`, `resolveModel`
- [ ] Inyección en `LLM.run` para verificación pre-request
- [ ] Deducción post-request con tokens reales
- [ ] Routing free → paid
- [ ] `GET /admin/users` endpoint

### Fase 3: Admin Dashboard
- [ ] UI de admin (/admin route)
- [ ] Lista de usuarios + balances
- [ ] Asignar créditos modal
- [ ] Historial de transacciones
- [ ] Gráficos de uso

### Fase 4: Pulido
- [ ] Notificaciones de balance bajo
- [ ] Auto-recarga vía stripe/paypal (opcional)
- [ ] Reportes exportables
- [ ] Rate limiting por usuario

## 6. Riesgos y Consideraciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Token estimation inaccuracy | Over/under charging | Usar tokens reales post-response para deduct, no estimados |
| Race condition en deduct | Doble cobro | Transacciones SQLite serializadas |
| Usuario sin balance usa OpenCode Zen | Sin ingresos | Zen es gratis, es el comportamiento deseado |
| Admin se queda sin admin | Bloqueo | Segundo usuario designado admin manualmente desde DB |
| JWT expira y no se puede decodificar | No se obtiene email | Usar refresh token; si expiró, re-login |
| Multiples instancias desktop | Balances inconsistentes | Cada instancia tiene su propia DB local; sync es futuro |

## 7. Arquitectura de Datos

```
auth.json (file)
  └── microsoft: { access, refresh, expires, accountId, email, displayName, tenantId }

user_identity (SQLite)
  └── id (oid), email, display_name, tenant_id, created_at, last_login_at, is_admin

token_balance (SQLite)
  └── user_id → balance, lifetime_used, updated_at

token_transaction (SQLite)
  └── id, user_id, amount, description, session_id, model, tokens_used, cost_usd, created_at

session (SQLite)
  └── (existing) → no user_id yet, future: add user_id FK
```

## 8. Referencias

- `packages/opencode/src/auth/index.ts` — Auth.Oauth schema
- `packages/opencode/src/plugin/microsoft.ts` — Microsoft plugin PKCE
- `packages/desktop/src/main/login-gate.ts` — Desktop login gate
- `packages/opencode/src/session/llm.ts` — LLM.run orchestration
- `packages/opencode/src/session/session.ts` — Cost calculation (line 393-406)
- `packages/opencode/src/provider/provider.ts` — Provider.defaultModel, getSmallModel
- `packages/core/src/plugin/provider/opencode.ts` — OpenCode Zen (free tier)
- `packages/opencode/src/session/retry.ts` — Error classification for tier limits
