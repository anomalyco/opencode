# Configuración Centralizada — gentle-opencode

Esta guía describe cómo configurar opencode para uso organizacional con control de modelos, seguridad y presupuesto.

## Índice

1. [Arquitectura de control](#arquitectura-de-control)
2. [Configuración organizacional](#configuración-organizacional)
3. [Modelos disponibles](#modelos-disponibles)
4. [Control de presupuesto (token-management)](#control-de-presupuesto-token-management)
5. [Seguridad y compliance](#seguridad-y-compliance)
6. [Despliegue](#despliegue)
7. [Infraestructura de ahorro de tokens](#infraestructura-de-ahorro-de-tokens)

---

## Arquitectura de control

```
┌─────────────────────────────────────────────────────┐
│                  opencode.json                       │
│  ┌──────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │ enabled_     │  │ share:     │  │ model:       │ │
│  │ providers:   │  │ disabled   │  │ opencode/    │ │
│  │ ["opencode"] │  │            │  │ deepseek-v4  │ │
│  └──────────────┘  └────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│           Budget Service (token-management)          │
│  ┌──────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │ resolveModel │  │ deduct     │  │ credit      │ │
│  │ (pre-request)│  │ (post)     │  │ (admin topup)│ │
│  └──────────────┘  └────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│                  Estrategia de 3 capas               │
│                                                     │
│  1. Zen (gratis) → agotar primero                   │
│  2. Go ($10/mes) → trabajo diario                   │
│  3. Enterprise/BYOK → datos sensibles               │
└─────────────────────────────────────────────────────┘
```

---

## Configuración organizacional

### `opencode.json` — para toda la organización

```json
{
  "$schema": "https://opencode.ai/config.json",
  "share": "disabled",
  "model": "opencode/deepseek-v4-pro",
  "small_model": "opencode/deepseek-v4-flash",
  "enabled_providers": ["opencode"],
  "disabled_providers": [
    "openai",
    "anthropic",
    "google",
    "amazon-bedrock",
    "azure",
    "groq",
    "mistral",
    "cohere",
    "perplexity",
    "deepseek",
    "openrouter",
    "github-copilot",
    "gitlab",
    "xai",
    "moonshotai",
    "alibaba",
    "venice",
    "nebius",
    "fireworks",
    "together",
    "replicate"
  ],
  "autoupdate": true,
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 10000
  },
  "subagent_depth": 3,
  "attachment": {
    "image": {
      "auto_resize": true,
      "max_width": 2000,
      "max_height": 2000,
      "max_base64_bytes": 5242880
    }
  },
  "watcher": {
    "ignore": [
      "node_modules/**",
      "dist/**",
      ".git/**",
      "*.log",
      "coverage/**"
    ]
  }
}
```

### Dónde ubicarlo

| Nivel | Ruta | Prioridad | Uso |
|-------|------|-----------|-----|
| **Organizacional** | `.well-known/opencode` (remoto) | Base | Defaults para toda la org |
| **Global** | `~/.config/opencode/opencode.json` | Media | Preferencias de usuario |
| **Proyecto** | `<repo>/opencode.json` | Alta | Config específica del repo |
| **Managed (admin)** | `/etc/opencode/opencode.json` (Linux) | Máxima | Forzado por admin, no modificable |

Para la demo y despliegue inicial, ubicar en:
- **Remoto**: `.well-known/opencode` en el dominio de la organización (se carga automáticamente al autenticar)
- **Managed**: `/etc/opencode/opencode.json` para forzar settings que el usuario no pueda cambiar

---

## Modelos disponibles

### Zen (gratuito — zero deduct)

| Modelo | Provider ID | Mejor para |
|--------|-------------|------------|
| DeepSeek V4 Pro | `opencode/deepseek-v4-pro` | Coding pesado, arquitectura |
| DeepSeek V4 Flash | `opencode/deepseek-v4-flash` | Coding rápido, tareas simples |
| Qwen3.7 Max | `opencode/qwen3.7-max` | General + coding |
| Qwen3.7 Plus | `opencode/qwen3.7-plus` | Balanceado |
| Kimi K2.7 Code | `opencode/kimi-k2.7-code` | Especializado código |
| GLM-5.2 | `opencode/glm-5.2` | General |
| MiMo-V2.5 | `opencode/mimo-v2.5` | Rápido, tareas simples |
| MiniMax M3 | `opencode/minimax-m3` | General |

### Go ($10/mes — descontado del balance)

Los mismos modelos que Zen, con límites: $12/5h, $30/semanal, $60/mensual.

### Enterprise/BYOK (casos sensibles)

Si se necesita un modelo externo para datos clasificados:
1. Agregar el provider a `enabled_providers`
2. Configurar API key via variable de entorno o archivo
3. Activar `OPENCODE_TOKEN_MGMT=1` para que el Budget Service controle el consumo

---

## Control de presupuesto (token-management)

El módulo `token-management` (Fase 1 + 2) implementa:

### Funcionalidades activas

| Feature | Flag | Descripción |
|---------|------|-------------|
| Identidad | `OPENCODE_TOKEN_MGMT=1` | Login Microsoft → user_identity, "Signed in as {email}" |
| Admin API | `OPENCODE_TOKEN_MGMT=1` | `GET /admin/users`, `POST /admin/users/:id/credit` |
| Budget check | `OPENCODE_TOKEN_MGMT=1` | Pre-request: verifica saldo |
| Auto-swap Zen | `OPENCODE_TOKEN_MGMT=1` | Sin saldo → cambia a modelo Zen gratuito |
| Deduct | `OPENCODE_TOKEN_MGMT=1` | Post-request: descuenta del balance |
| Free-first | Siempre | Modelos `opencode*` nunca descuentan |

### Cómo activar

```bash
# Activar control de presupuesto
export OPENCODE_TOKEN_MGMT=1

# Sin el flag, todo funciona como antes (backward compatible)
unset OPENCODE_TOKEN_MGMT
```

### Flujo de decisión

```
Usuario pide modelo
        │
        ▼
  ¿Es opencode*? ──SÍ──▶ Request normal (gratis, zero deduct)
        │
       NO (modelo pago)
        │
        ▼
  ¿Tiene saldo? ──SÍ──▶ Request normal ──▶ Post-deduct
        │
       NO
        │
        ▼
  ¿Hay Zen disponible? ──SÍ──▶ Auto-swap a DeepSeek V4 Pro
        │
       NO
        │
        ▼
  BudgetExhaustedError → "Suscribite a Go"
```

### Admin endpoints

```bash
# Ver usuario actual
curl -u "opencode:<password>" http://localhost:<port>/identity/me

# Listar todos los usuarios (admin)
curl -u "opencode:<password>" http://localhost:<port>/admin/users

# Dar crédito a un usuario (admin)
curl -u "opencode:<password>" -X POST \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000, "description": "Crédito mensual"}' \
  http://localhost:<port>/admin/users/<user-id>/credit
```

---

## Seguridad y compliance

| Control | Configuración | Estado |
|---------|--------------|--------|
| Share deshabilitado | `"share": "disabled"` | ✅ |
| Solo modelos Zen/Go | `"enabled_providers": ["opencode"]` | ✅ |
| Sin almacenamiento de datos | Por diseño de opencode | ✅ |
| Sin telemetría a terceros | Solo modelos opencode | ✅ |
| SSO (futuro) | Enterprise central config | ⏳ |
| MDM (macOS) | `.mobileconfig` via Jamf | ⏳ |

---

## Despliegue

### Paso 1: Configuración base

Copiar `opencode.json` a:
- Repositorio del proyecto para uso en equipo
- `~/.config/opencode/` para uso personal
- Servidor `.well-known/opencode` para carga automática

### Paso 2: Instalar dependencias

```bash
# Windows (PowerShell)
irm https://raw.githubusercontent.com/ivanfernadezm99/opencode/dev/install.ps1 | iex

# Linux/macOS
curl -fsSL https://raw.githubusercontent.com/ivanfernadezm99/opencode/dev/install.sh | bash
```

### Paso 3: Activar control de presupuesto

```bash
export OPENCODE_TOKEN_MGMT=1
opencode
```

### Paso 4: Login

1. Abrir opencode
2. `/connect microsoft` → autenticar
3. Verificar "Signed in as {email}" en el titlebar

### Paso 5: Admin

El primer usuario que hace login es automáticamente admin. Puede:
- Ver todos los usuarios: `GET /admin/users`
- Asignar créditos: `POST /admin/users/:id/credit`

---

## Infraestructura de ahorro de tokens

El fork gentle-opencode incluye componentes que reducen el consumo de tokens 60-75%:

| Componente | Función | Ahorro estimado |
|------------|---------|----------------|
| **CodeGraph** | Index de código, queries semánticas en 1 llamada | 40-50% |
| **Engram** | Memoria persistente cross-session | 15-20% |
| **Context7** | Documentación sin web scraping | 10-15% |
| **gentle-ai SDD** | Delegación a sub-agentes, contexto fresco | 20-30% |
| **Skill system** | Instrucciones especializadas | 5-10% |

---

## Dashboard de administración

Un dashboard HTML autónomo está disponible en `docs/admin-dashboard.html`. Se conecta directamente a la API del sidecar.

### Cómo usar

1. Asegurate de que opencode esté corriendo con `OPENCODE_TOKEN_MGMT=1`
2. Abrí `docs/admin-dashboard.html` en el navegador
3. Ingresá la URL del sidecar (default: `http://localhost:4096`) y el password
4. El dashboard muestra:
   - Stats globales (usuarios, balance total, tokens usados)
   - Perfil del usuario actual
   - Tabla de usuarios con balances (solo admin)
   - Formulario para dar crédito a usuarios (solo admin)

También se puede servir estáticamente desde cualquier servidor web.

### Endpoints disponibles

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/identity/me` | Basic | Perfil del usuario actual |
| `GET` | `/admin/users` | Basic + admin | Lista todos los usuarios |
| `POST` | `/admin/users/:id/credit` | Basic + admin | Dar crédito a un usuario |

---

## `.well-known/opencode` — Carga automática

OpenCode puede cargar configuración organizacional automáticamente desde `https://<dominio>/.well-known/opencode`. Esto permite que todos los clientes obtengan la misma configuración sin archivos locales.

### Cómo funciona

1. El usuario hace login con Microsoft (provider configurado para la organización)
2. OpenCode detecta el dominio del tenant y busca `.well-known/opencode`
3. La configuración remota se carga como capa base (menor prioridad que proyecto/global)

### Server incluido

```bash
# Iniciar servidor de configuración
cd docs/well-known && ./well-known-server.sh 8080

# Probar
curl http://localhost:8080/.well-known/opencode | jq
curl http://localhost:8080/health
```

### Despliegue en producción

**Opción A — Nginx (recomendado):**
```nginx
server {
    listen 443 ssl;
    server_name opencode-config.tu-dominio.com;

    location /.well-known/opencode {
        alias /ruta/a/docs/well-known/opencode.json;
        default_type application/json;
        add_header Cache-Control "public, max-age=3600";
        add_header Access-Control-Allow-Origin "*";
    }

    location /health {
        return 200 '{"status":"ok"}';
        default_type application/json;
    }
}
```

**Opción B — Cloudflare Workers:**
```js
export default {
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/.well-known/opencode') {
      return Response.json(OPECODE_CONFIG, {
        headers: { 'Cache-Control': 'public, max-age=3600' }
      })
    }
    return new Response('ok')
  }
}
```

**Opción C — Vercel/Netlify:**
Ubicar `docs/well-known/` como raíz del deploy. El symlink `.well-known/opencode -> opencode.json` resuelve automáticamente.

### Estructura de archivos

```
docs/well-known/
├── index.html              ← Página de estado del servidor
├── opencode.json           ← Configuración organizacional
├── well-known-server.sh    ← Script para desarrollo local
└── .well-known/
    └── opencode -> ../opencode.json  ← Symlink para servir la ruta
```

---

## Pendiente

- [ ] Dato de RRHH: devs vs admins para estimar costo real
- [x] Dashboard web de administración → `docs/admin-dashboard.html`
- [x] `.well-known/opencode` endpoint → `docs/well-known/`
- [ ] Fase 3: auto-recharge, notificaciones de saldo bajo
- [ ] `.mobileconfig` para macOS MDM
