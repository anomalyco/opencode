# OPENSACIA Phase 4: Security Agent Design

**Date:** 2026-03-05
**Author:** Victor Gonzalez (vicorente)
**Status:** Draft
**Related Issue:** N/A

## Overview

Este documento establece el diseño para Phase 4 de OPENSACIA: transformar el proyecto en un agente de ciberseguridad autónomo capaz de auditar cualquier objetivo (web, redes, Active Directory, código, OT/ICS).

**Repositorio:** https://github.com/vicorente/OPENSACIA
**Base:** OPENSACIA Phase 3 (GitLab migration) completada

## Objetivo

Convertir OPENSACIA en un agente de ciberseguridad generalista que:

1. **Ejecute herramientas de Kali Linux** en contenedores Docker
2. **Opere de forma autónoma** (como OpenCode) usando LLMs locales
3. **Sea extensible** - nuevos tipos de auditoría sin modificar código base
4. **Genere reportes profesionales** de hallazgos y recomendaciones
5. **Soporte múltiples objetivos**: Web, Redes, AD, Código, OT/ICS

## Arquitectura

### Flujo General

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPENSACIA CLI                             │
│                                                               │
│  $ opensacia "Quiero auditar 192.168.1.0/24"              │
│     │                                                        │
│     ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Agente Security (LLM)                       │   │
│  │                                                          │   │
│  │ 1. Interpreta objetivo                                 │   │
│  │ 2. Pregunta modo: auto/assistido/mixto                 │   │
│  │ 3. Planifica qué herramientas usar                     │   │
│  │ 4. Ejecuta tools secuencialmente                        │   │
│  │ 5. Analiza resultados                                 │   │
│  │ 6. Decide próximos pasos                               │   │
│  │ 7. Genera reporte                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│               │ Tool Calling                                   │
│               ▼                                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Tool: kali (ejecuta en Kali Docker)         │   │
│  └──────────────────────────────────────────────────────┘   │
│               │                                                │
│               ▼                                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          Kali Docker Container Manager                 │   │
│  │  - Crea contenedores efímeros                          │   │
│  │  - Ejecuta herramientas (nmap, nuclei, etc.)          │   │
│  │  - Captura outputs                                     │   │
│  └──────────────────────────────────────────────────────┘   │
│               │                                                │
│               ▼                                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Resultados → Parsers → Findings             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Componentes a Crear/Modificar

### 4.1 Tool Kali (Nuevo)

**Crear:** `packages/opencode/src/tool/kali.ts`

```typescript
import { Tool } from "./tool"
import z from "zod"
import { KaliContainer } from "../security/kali/container"

export const KaliTool = Tool.define("kali", async () => {
  return {
    description: "Ejecuta herramientas de ciberseguridad de Kali Linux en contenedores Docker. " +
      "Soporta nmap, nuclei, httpx, bloodhound, semgrep y más.",

    parameters: z.object({
      command: z.string().describe("Comando de Kali a ejecutar"),
      args: z.array(z.string()).optional().describe("Argumentos adicionales"),
      input: z.string().optional().describe("Input para el comando (URLs, dominios, etc.)"),
      inputFile: z.string().optional().describe("Archivo local para montar como input"),
      outputFile: z.string().optional().describe("Archivo local para guardar output"),
      persistent: z.boolean().optional().describe("Mantener contenedor corriendo"),
      containerId: z.string().optional().describe("ID de contenedor existente"),
      timeout: z.number().optional().describe("Timeout en segundos (default: 300)"),
    }),

    async execute(params, ctx) {
      const kali = new KaliContainer()
      let container = params.containerId

      if (!container) {
        if (params.persistent) {
          container = await kali.createPersistent(params.command)
        } else {
          container = await kali.createOneShot()
        }
      }

      let fullCommand = params.command
      if (params.args) fullCommand += " " + params.args.join(" ")

      const result = await kali.exec(container, fullCommand)

      if (params.outputFile) {
        await kali.copyOut(container, "/tmp/output", params.outputFile)
      }

      if (!params.persistent && !params.containerId) {
        await kali.destroy(container)
      }

      return {
        output: result.stdout || result.stderr,
        exitCode: result.exitCode,
        containerId: params.persistent ? container : undefined
      }
    }
  }
})
```

### 4.2 KaliContainer Manager (Nuevo)

**Crear:** `packages/opencode/src/security/kali/container.ts`

```typescript
import { $ } from "bun"

const KALI_IMAGE = "kalilinux/kali-rolling:latest"

export class KaliContainer {
  private containers = new Map<string, ContainerInfo>()

  async createOneShot(): Promise<string> {
    const id = `kali-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await $`docker create --name ${id} ${KALI_IMAGE}`.quiet()
    await $`docker network connect host ${id}`.quiet()
    await $`docker start ${id}`.quiet()
    return id
  }

  async createPersistent(name: string): Promise<string> {
    await $`docker run -d --name ${name} --network host ${KALI_IMAGE} tail -f /dev/null`.quiet()
    return name
  }

  async exec(containerId: string, command: string): Promise<ExecResult> {
    const result = await $`docker exec ${containerId} ${command}`
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode
    }
  }

  async copyIn(localPath: string, containerId: string, containerPath: string): Promise<void> {
    await $`docker cp ${localPath} ${containerId}:${containerPath}`
  }

  async copyOut(containerId: string, containerPath: string, localPath: string): Promise<void> {
    await $`docker cp ${containerId}:${containerPath} ${localPath}`
  }

  async destroy(containerId: string): Promise<void> {
    await $`docker rm -f ${containerId}`.quiet()
  }

  async cleanup(): Promise<void> {
    const result = await $`docker ps -q --filter "name=kali-"`.text()
    if (result.trim()) {
      for (const id of result.trim().split('\n')) {
        await this.destroy(id)
      }
    }
  }
}
```

### 4.3 Agente Security (Nuevo)

**Crear:** `packages/opencode/src/agent/security.ts`

```typescript
export const SecurityAgent: Agent.Info = {
  name: "security",
  description: "Agente de ciberseguridad de OPENSACIA",
  permissions: PermissionNext.fromConfig({
    kali: "allow",
    bash: "allow",
    webfetch: "allow",
    read: "allow",
    write: "allow",
  }),
  mode: "primary",
  native: true,
}
```

### 4.4 System Prompt Security (Nuevo)

**Crear:** `packages/opencode/src/agent/prompt/security.txt`

Contenido completo en Sección 8 de este documento.

### 4.5 Comando Opensacia (Nuevo)

**Crear:** `packages/opencode/src/cli/cmd/opensacia.ts`

```typescript
import { cmd } from "./cmd"
import { runAgent } from "../session"

export const OpensaciaCommand = cmd({
  command: "opensacia [prompt...]",
  describe: "OPENSACIA Security Agent - asistente de ciberseguridad autónomo",
  builder: (yargs) =>
    yargs
      .option("agent", { choices: ["security", "general"], default: "security" })
      .option("mode", { choices: ["auto", "assisted", "mixed"], default: null }),
  async handler(args) {
    const prompt = args.prompt ? args.prompt.join(" ") : undefined
    const agent = args.agent || "security"
    const mode = args.mode

    await runAgent({
      agent,
      prompt,
      options: { mode }
    })
  },
})
```

### 4.6 Modificar ToolRegistry

**Modificar:** `packages/opencode/src/tool/registry.ts`

Agregar import y registro de KaliTool:

```typescript
import { KaliTool } from "./kali"  // AGREGAR

export async function all(): Promise<Tool.Info[]> {
  // ... existing tools ...
  return [
    InvalidTool,
    BashTool,
    ReadTool,
    GlobTool,
    GrepTool,
    EditTool,
    WriteTool,
    TaskTool,
    WebFetchTool,
    TodoWriteTool,
    WebSearchTool,
    CodeSearchTool,
    SkillTool,
    ApplyPatchTool,
    KaliTool,  // AGREGAR
    // ... rest of tools ...
  ]
}
```

## Data Flow - Auditoría Completa

```
Usuario: $ opensacia
Opensacia: Hola, soy OPENSACIA. ¿Qué puedo auditar hoy?
Usuario: "Audita 192.168.1.0/24"

Opensacia: ¿Qué grado de automatización prefieres?
[1] Completamente autónomo
[2] Asistido
[3] Mixto

Usuario: 3

Opensacia: Perfecto. Modo mixto seleccionado.
Comenzaré con:

1. Escaneo de hosts activos (nmap -sn 192.168.1.0/24)
2. Escaneo de puertos y servicios en hosts encontrados
3. Escaneo de vulnerabilidades web (nuclei en puertos 80/443)

¿Procedemos? [y/n]

Usuario: y

Opensacia: ⏳ Ejecutando: nmap -sn 192.168.1.0/24
...
[Análisis de resultados]

Opensacia: Encuentro 5 hosts activos:
- 192.168.1.1 (Linux, puertos: 22, 80, 443)
- 192.168.1.10 (Windows, puertos: 135, 139, 445)
- 192.168.1.20 (Router, puertos: 23, 80)
- 192.168.1.50 (unknown)
- 192.168.1.100 (Linux, puertos: 22, 80, 443)

Continuando con escaneo de puertos...
[Tool calling kali: nmap -sV -p22,80,443 ...]

[Al finalizar]

Opensacia: ✅ Auditoría completada

📊 Resumen:
- 5 hosts escaneados
- 3 vulnerabilidades críticas
- 7 vulnerabilidades altas
- 12 vulnerabilidades medias

📁 Reporte guardado en: /tmp/opensacia-reports/20260305-192168.1.0.24.md
```

## Error Handling & Edge Cases

| Escenario | Comportamiento |
|-----------|--------------|
| Docker no instalado | Error claro con instrucciones de instalación |
| Docker no corriendo | Error con instrucciones `docker start` |
| Kali image no disponible | Pull automático con progreso visible |
| Contenedor se cuelga | Timeout + limpieza forzada |
| Comando retorna error | Parsea output anyway si es posible |
| Red no alcanzable | Timeout con mensaje específico |
| Output demasiado grande | Truncar y procesar en chunks |

## Testing & Validación

### Unit Tests

```typescript
// KaliContainer tests
describe("KaliContainer", () => {
  test("crea y destruye contenedor", async () => { /* ... */ })
  test("ejecuta comando básico", async () => { /* ... */ })
  test("copia archivos desde/hacia contenedor", async () => { /* ... */ })
})

// KaliTool tests
describe("KaliTool", () => {
  test("ejecuta comando simple", async () => { /* ... */ })
  test("maneja timeouts", async () => { /* ... */ })
  test("contenedor persistente", async () => { /* ... */ })
})

// Parser tests
describe("NmapParser", () => {
  test("parsea output básico de nmap", () => { /* ... */ })
  test("extrae puertos abiertos", () => { /* ... */ })
  test("detecta vulnerabilidades", () => { /* ... */ })
})

// ReportGenerator tests
describe("ReportGenerator", () => {
  test("genera markdown", () => { /* ... */ })
  test("genera json", () => { /* ... */ })
  test("filtra por severidad", () => { /* ... */ })
})
```

### Integration Tests

```bash
# Requiere Docker + Kali image
KALI_TESTS=true bun test --cwd packages/opencode test/security/integration.test.ts
```

### Validación Manual

| Comando | Verificación |
|---------|--------------|
| `opensacia` | Inicia modo interactivo |
| `opensacia "audita localhost"` | Detecta si Docker está corriendo |
| `opensacia --mode auto` | Ejecuta sin preguntar |
| `opensacia --mode assisted` | Pregunta confirmación |
| Reporte output | Markdown válido con secciones correctas |

## Configuración

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENSACIA_KALI_IMAGE` | `kalilinux/kali-rolling:latest` | Imagen Docker de Kali |
| `OPENSACIA_DOCKER_NETWORK` | `host` | Modo de red Docker |
| `OPENSACIA_REPORT_PATH` | `/tmp/opensacia-reports` | Directorio de reportes |
| `OPENSACIA_MODE` | `mixed` | Modo de automatización |

### Config File

**`~/.config/opensacia/config.json`:**

```json
{
  "security": {
    "kali": {
      "image": "kalilinux/kali-rolling:latest",
      "network": "host",
      "defaultTimeout": 300
    },
    "reports": {
      "path": "/tmp/opensacia-reports",
      "formats": ["markdown", "json"],
      "includeEvidence": true
    },
    "modes": {
      "default": "mixed",
      "autoMaxParallel": 3
    }
  }
}
```

## Siguiente Steps

Después de Phase 4 completion:

1. **Phase 5:** Integración con pipelines de GitLab CI/CD
2. **Phase 6:** Testing completo y deployment
3. **Phase 7:** Herramientas adicionales (Metasploit, Bloodhound GUI, etc.)

## Referencias

- Design Document Phase 1: `docs/plans/2026-03-04-opensacia-phase1-design.md`
- Design Document Phase 2: `docs/plans/2026-03-05-opensacia-phase2-design.md`
- Design Document Phase 3: `docs/plans/2026-03-05-opensacia-phase3-design.md`
- Kali Documentation: https://www.kali.org/docs/
- OpenCode Tool System: `packages/opencode/src/tool/registry.ts`
