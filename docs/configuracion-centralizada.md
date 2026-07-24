# Configuración Centralizada — gentle-opencode

Esta guía describe cómo configurar opencode para uso organizacional con control de modelos, seguridad y presupuesto.

## Índice

1. [Arquitectura de control](#arquitectura-de-control)
2. [Configuración organizacional](#configuración-organizacional)
3. [Modelos disponibles](#modelos-disponibles)
4. [Estimación de costos](#estimación-de-costos)
5. [Control de presupuesto (token-management)](#control-de-presupuesto-token-management)
6. [Seguridad y compliance](#seguridad-y-compliance)
7. [Despliegue](#despliegue)
8. [Infraestructura de ahorro de tokens](#infraestructura-de-ahorro-de-tokens)

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

## Estimación de costos

Basado en un ratio **3 administrativos por cada 1 desarrollador** (dato confirmado por RRHH).

### Perfiles de consumo

| Perfil | Uso principal | Consumo tokens | Modelo | Costo |
|--------|--------------|---------------|--------|-------|
| **Dev** | Coding, arquitectura, debugging | Alto | Go ($10/mes) | $10 × N |
| **Admin** | Lectura de docs, resúmenes, análisis | Bajo | Zen (gratis) | $0 |

### Escenarios mensuales

| Empleados | Devs | Admins | Licencias Go | Costo/mes |
|-----------|------|--------|-------------|-----------|
| **20** | 5 | 15 | 5 + 2 compartidas | **$70** |
| **40** | 10 | 30 | 10 + 4 compartidas | **$140** |
| **60** | 15 | 45 | 15 + 6 compartidas | **$210** |
| **100** | 25 | 75 | 25 + 10 compartidas | **$350** |

### Comparación

| Solución | 20 empleados | 100 empleados |
|----------|-------------|---------------|
| **gentle-opencode** | **$70/mes** | **$350/mes** |
| Copilot Enterprise | $780/mes | $3,900/mes |
| Cursor Business | $800/mes | $4,000/mes |

**11x más barato** que Copilot Enterprise.

### Por qué

1. **Zen gratuito** cubre al 75% de los empleados (administrativos)
2. **Licencias Go compartidas**: 1 licencia para 4 admins
3. **Infraestructura de ahorro**: CodeGraph + Engram + Context7 + gentle-ai → 60-75% menos tokens
4. **Auto-swap a Zen**: sin saldo Go → cae a gratuito, sin overages
5. **Sin costo por token**: modelos `opencode*` zero deduct

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

## Configuración Azure AD

### Roles de administrador

Hay dos tipos de permisos en Azure AD:

| Permiso | Te permite | Cómo obtenerlo |
|---------|-----------|----------------|
| **Dueño del grupo** | Agregar/quitar miembros | El admin te agrega en el grupo → Owners |
| **Dueño de la App Registration** | Editar manifest, crear App Roles, configurar tokens | App Registration → Owners → Add |

Para configurar los App Roles necesitás ser dueño de la **App Registration**, no del grupo.

### Cómo verificar si tenés acceso

```
portal.azure.com → Microsoft Entra ID → App registrations → "OpenCode Cli"
```

Si ves el botón **"Manifest"** en el menú izquierdo → podés hacerlo vos.  
Si no aparece → pedirle al admin que te agregue como Owner.

### Configuración mínima (solo App Roles)

Para tener control de acceso sin modificar nada más:

1. El admin edita el **Manifest** de la App Registration `OpenCode Cli`
2. Agrega los App Roles:

```json
"appRoles": [
  {
    "allowedMemberTypes": ["User"],
    "displayName": "Admin",
    "isEnabled": true,
    "value": "opencode-admins",
    "id": "<guid>"
  },
  {
    "allowedMemberTypes": ["User"],
    "displayName": "Dev",
    "isEnabled": true,
    "value": "opencode-devs",
    "id": "<guid>"
  },
  {
    "allowedMemberTypes": ["User"],
    "displayName": "User",
    "isEnabled": true,
    "value": "opencode-users",
    "id": "<guid>"
  }
]
```

3. Asigna el grupo a un rol: **Enterprise Applications → "OpenCode Cli" → Users and groups → Add** → seleccionar `opencode-devs-group` → rol `opencode-devs`

Con solo eso, el código ya detecta los roles del JWT y aplica:
- `opencode-admins` → acceso total
- `opencode-devs` → modelos pagos permitidos
- `opencode-users` → solo Zen gratuito
- Sin rol asignado → acceso bloqueado

### Configuración avanzada (extension attributes — para después)

Cuando necesiten gestionar allowance, modelos y preferencias por usuario desde Azure Portal:

1. Registrar extension attributes (PowerShell)
2. Setear valores por usuario (MS Graph API)
3. Agregar optional claims en el manifest

El código ya está preparado con fallback a env vars para todo.

---

## Pendiente

- [x] Dato de RRHH: ratio 3:1 admin:dev confirmado
- [x] Dashboard web de administración → `docs/admin-dashboard.html`
- [x] `.well-known/opencode` endpoint → `docs/well-known/`
- [x] Fase 3: auto-recharge, notificaciones de saldo bajo
- [ ] App Roles en Azure AD (pendiente del admin)
- [ ] `.mobileconfig` para macOS MDM
