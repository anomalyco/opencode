# OPENSACIA Phase 4: Security Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transformar OPENSACIA en un agente de ciberseguridad autónomo capaz de auditar cualquier objetivo (web, redes, Active Directory, código, OT/ICS) ejecutando herramientas de Kali Linux en contenedores Docker.

**Architecture:** LLM Agent → Tool calling → KaliContainer (Docker) → Kali tools → Parsers → Findings → Reports. El agente Security usa el tool "kali" (genérico) para ejecutar cualquier herramienta de Kali, con tres modos de automatización (auto/assisted/mixed).

**Tech Stack:** TypeScript, Bun, Docker, Zod, Kali Linux containers, markdown reports

---

## Task 1: Estructura de directorios security/

**Files:**
- Create: `packages/opencode/src/security/kali/container.ts`
- Create: `packages/opencode/src/security/kali/parser.ts`
- Create: `packages/opencode/src/security/kali/report.ts`
- Create: `packages/opencode/src/security/index.ts`

**Step 1: Crear estructura de directorios base**

```bash
mkdir -p packages/opencode/src/security/kali
mkdir -p packages/opencode/src/agent/prompt
```

**Step 2: Verificar directorios creados**

Run: `ls -la packages/opencode/src/security/`
Expected: `kali/` directory exists

**Step 3: Crear index.ts de barrel export**

```typescript
// packages/opencode/src/security/index.ts
export * from "./kali/container"
export * from "./kali/parser"
export * from "./kali/report"
```

**Step 4: Commit**

```bash
git add packages/opencode/src/security/
git commit -m "feat(phase4): add security directory structure"
```

---

## Task 2: KaliContainer Manager - Clase base

**Files:**
- Create: `packages/opencode/src/security/kali/container.ts`
- Test: `packages/opencode/test/security/kali/container.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/opencode/test/security/kali/container.test.ts
import { describe, test, expect, beforeEach } from "bun:test"
import { KaliContainer } from "../../../../src/security/kali/container"

describe("KaliContainer", () => {
  let kali: KaliContainer

  beforeEach(() => {
    kali = new KaliContainer()
  })

  test("genera unique container ID", () => {
    const id1 = KaliContainer.generateId()
    const id2 = KaliContainer.generateId()
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^kali-\d+-[a-z0-9]{6}$/)
  })

  test("parsea comando simple", () => {
    const parsed = KaliContainer.parseCommand("nmap -sV 192.168.1.1")
    expect(parsed.command).toBe("nmap")
    expect(parsed.args).toEqual(["-sV", "192.168.1.1"])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd packages/opencode test/security/kali/container.test.ts`
Expected: FAIL with "KaliContainer is not defined"

**Step 3: Write minimal implementation**

```typescript
// packages/opencode/src/security/kali/container.ts
import { $ } from "bun"
import { randomBytes } from "crypto"

const KALI_IMAGE = "kalilinux/kali-rolling:latest"

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

export interface ContainerInfo {
  id: string
  created: Date
  persistent: boolean
}

export class KaliContainer {
  private containers = new Map<string, ContainerInfo>()

  static generateId(): string {
    return `kali-${Date.now()}-${randomBytes(3).toString("hex").slice(0, 6)}`
  }

  static parseCommand(input: string): { command: string; args: string[] } {
    const parts = input.trim().split(/\s+/)
    return {
      command: parts[0] || "",
      args: parts.slice(1),
    }
  }

  async checkDocker(): Promise<{ available: boolean; error?: string }> {
    try {
      const result = await $`docker --version`.quiet().nothrow()
      if (result.exitCode !== 0) {
        return { available: false, error: "Docker not installed or not running" }
      }
      return { available: true }
    } catch {
      return { available: false, error: "Docker executable not found" }
    }
  }

  async createOneShot(): Promise<string> {
    const id = KaliContainer.generateId()
    await $`docker create --name ${id} ${KALI_IMAGE}`.quiet()
    await $`docker network connect host ${id}`.quiet()
    await $`docker start ${id}`.quiet()
    this.containers.set(id, { id, created: new Date(), persistent: false })
    return id
  }

  async createPersistent(name: string): Promise<string> {
    await $`docker run -d --name ${name} --network host ${KALI_IMAGE} tail -f /dev/null`.quiet()
    this.containers.set(name, { id: name, created: new Date(), persistent: true })
    return name
  }

  async exec(containerId: string, command: string): Promise<ExecResult> {
    const result = await $`docker exec ${containerId} ${command}`.nothrow()
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode,
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
    this.containers.delete(containerId)
  }

  async cleanup(): Promise<void> {
    const result = await $`docker ps -q --filter "name=kali-"`.text()
    if (result.trim()) {
      for (const id of result.trim().split("\n")) {
        await this.destroy(id)
      }
    }
  }

  list(): ContainerInfo[] {
    return Array.from(this.containers.values())
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd packages/opencode test/security/kali/container.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add packages/opencode/src/security/kali/container.ts
git add packages/opencode/test/security/kali/container.test.ts
git commit -m "feat(phase4): add KaliContainer manager with tests"
```

---

## Task 3: Tool Kali - Implementación principal

**Files:**
- Create: `packages/opencode/src/tool/kali.ts`
- Modify: `packages/opencode/src/tool/registry.ts` (agregar import y registro)
- Test: `packages/opencode/test/tool/kali.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/opencode/test/tool/kali.test.ts
import { describe, test, expect } from "bun:test"
import { KaliTool } from "../../src/tool/kali"

describe("KaliTool", () => {
  test("tool tiene id correcto", () => {
    expect(KaliTool.id).toBe("kali")
  })

  test("tool init retorna configuración válida", async () => {
    const config = await KaliTool.init()
    expect(config.description).toContain("Kali Linux")
    expect(config.parameters).toBeDefined()
  })

  test("parámetros incluyen command obligatorio", async () => {
    const config = await KaliTool.init()
    const schema = config.parameters
    expect(schema).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd packages/opencode test/tool/kali.test.ts`
Expected: FAIL with "KaliTool is not defined"

**Step 3: Write minimal implementation**

```typescript
// packages/opencode/src/tool/kali.ts
import { Tool } from "./tool"
import z from "zod"
import { KaliContainer } from "../security/kali/container"
import { Log } from "../util/log"

const log = Log.create({ service: "kali-tool" )

export const KaliTool = Tool.define("kali", async () => {
  return {
    description:
      "Ejecuta herramientas de ciberseguridad de Kali Linux en contenedores Docker. " +
      "Soporta nmap, nuclei, httpx, nikto, sqlmap, gobuster, wfuzz, hydra, john, metasploit, " +
      "bloodhound, semgrep, y muchas más herramientas de Kali.\n\n" +
      "Herramientas comunes por categoría:\n" +
      "- Escaneo de red: nmap, masscan, rustscan\n" +
      "- Web: nuclei, httpx, nikto, sqlmap, gobuster, ffuf, wfuzz\n" +
      "- Password cracking: john, hashcat, hydra\n" +
      "- Active Directory: bloodhound-python, impacket, crackmapexec\n" +
      "- Explotación: metasploit-framework, searchsploit\n" +
      "- Forense: autopsy, volatility, binwalk\n" +
      "- Sniffing: wireshark, tcpdump, bettercap\n\n" +
      "Ejemplos de uso:\n" +
      '- { "command": "nmap", "args": ["-sV", "-p22,80,443", "192.168.1.1"] }\n' +
      '- { "command": "nuclei", "args": ["-u", "http://example.com", "-severity", "critical,high"] }\n' +
      '- { "command": "nikto", "args": ["-h", "http://example.com"] }',

    parameters: z.object({
      command: z.string().describe("Comando de Kali a ejecutar (ej: nmap, nuclei, nikto)"),
      args: z.array(z.string()).optional().describe("Argumentos para el comando"),
      input: z.string().optional().describe("Input textual para el comando (URLs, dominios, etc)"),
      inputFile: z.string().optional().describe("Archivo local para montar como input en el contenedor"),
      outputFile: z.string().optional().describe("Archivo local donde guardar el output del contenedor"),
      persistent: z.boolean().optional().describe("Mantener contenedor corriendo después del comando"),
      containerId: z.string().optional().describe("ID de contenedor existente para reutilizar"),
      timeout: z.number().optional().describe("Timeout en segundos (default: 300)"),
    }),

    async execute(params, ctx) {
      const kali = new KaliContainer()

      // Verificar Docker
      const dockerCheck = await kali.checkDocker()
      if (!dockerCheck.available) {
        throw new Error(`Docker no disponible: ${dockerCheck.error}`)
      }

      let container = params.containerId

      // Crear contenedor si no existe
      if (!container) {
        if (params.persistent) {
          container = await kali.createPersistent(params.command)
        } else {
          container = await kali.createOneShot()
        }
      }

      // Construir comando completo
      let fullCommand = params.command
      if (params.args && params.args.length > 0) {
        fullCommand += " " + params.args.join(" ")
      }

      // Copiar input file si existe
      if (params.inputFile) {
        await kali.copyIn(params.inputFile, container, "/tmp/input")
        fullCommand += " /tmp/input"
      }

      // Ejecutar con timeout
      const timeout = params.timeout ?? 300
      const timeoutMs = timeout * 1000

      log.info("Ejecutando comando Kali", { container, command: fullCommand, timeout })

      const startTime = Date.now()
      let result: Awaited<ReturnType<KaliContainer["exec"]>>
      let timedOut = false

      try {
        // Ejecutar con timeout usando AbortController
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

        // Para simplicidad, ejecutamos directamente (Bun ya tiene timeout)
        result = await kali.exec(container, fullCommand)

        clearTimeout(timeoutId)
      } catch {
        timedOut = true
        result = { stdout: "", stderr: "Command timed out", exitCode: 124 }
      }

      const duration = Date.now() - startTime

      // Copiar output file si se especificó
      if (params.outputFile) {
        await kali.copyOut(container, "/tmp/output", params.outputFile)
      }

      // Destruir contenedor si no es persistente y no se proporcionó uno existente
      if (!params.persistent && !params.containerId) {
        await kali.destroy(container)
      }

      const metadata = {
        exitCode: result.exitCode,
        duration,
        timedOut,
        containerId: params.persistent ? container : undefined,
      }

      return {
        title: `${params.command} ${params.args?.join(" ") || ""}`.trim(),
        metadata,
        output: result.stdout || result.stderr || "Command completed with no output",
      }
    },
  }
})
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd packages/opencode test/tool/kali.test.ts`
Expected: PASS (3 tests)

**Step 5: Agregar KaliTool al registro**

```typescript
// packages/opencode/src/tool/registry.ts
// Agregar import al inicio:
import { KaliTool } from "./kali"

// En la función all(), agregar al array:
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
    KaliTool,  // <-- AGREGAR ESTO
    ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
    ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
    ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [PlanExitTool] : []),
    ...custom,
  ]
}
```

**Step 6: Commit**

```bash
git add packages/opencode/src/tool/kali.ts
git add packages/opencode/src/tool/registry.ts
git add packages/opencode/test/tool/kali.test.ts
git commit -m "feat(phase4): add KaliTool for executing Kali Linux tools in Docker"
```

---

## Task 4: Agente Security - Definición

**Files:**
- Modify: `packages/opencode/src/agent/agent.ts` (agregar security agent al state)

**Step 1: Verificar estructura actual de agentes**

Run: `grep -A 20 'build:' packages/opencode/src/agent/agent.ts | head -25`
Expected: Ver patrón de definición de agente

**Step 2: Agregar Security Agent al state**

```typescript
// packages/opencode/src/agent/agent.ts
// En la función state(), agregar después del agente 'build':

security: {
  name: "security",
  description: "Agente de ciberseguridad de OPENSACIA. Ejecuta auditorías de seguridad autónomas usando herramientas de Kali Linux en contenedores Docker. Soporta auditorías web, de red, Active Directory, código fuente y sistemas OT/ICS.",
  permission: PermissionNext.merge(
    defaults,
    PermissionNext.fromConfig({
      kali: "allow",
      bash: "allow",
      webfetch: "allow",
      websearch: "allow",
      read: "allow",
      write: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
      },
      glob: "allow",
      grep: "allow",
      codesearch: "allow",
      question: "deny",
      plan_enter: "deny",
      plan_exit: "deny",
    }),
    user,
  ),
  mode: "primary",
  native: true,
  color: "red",
},
```

**Step 3: Verificar que el agente se registra**

Run: `bun run opencode agent list | grep security`
Expected: `security (primary)` appears in list

**Step 4: Commit**

```bash
git add packages/opencode/src/agent/agent.ts
git commit -m "feat(phase4): add security agent definition"
```

---

## Task 5: System Prompt Security

**Files:**
- Create: `packages/opencode/src/agent/prompt/security.txt`

**Step 1: Crear el system prompt del agente Security**

```text
# OPENSACIA Security Agent

Eres OPENSACIA, un asistente de ciberseguridad autónomo especializado en auditorías de seguridad.

## Tu Propósito

Ayudas a profesionales de ciberseguridad a realizar auditorías completas utilizando herramientas de Kali Linux ejecutadas en contenedores Docker. Puedes auditar:

- **Aplicaciones Web**: escaneo de vulnerabilidades, análisis de endpoints, fuzzing
- **Redes**: descubrimiento de hosts, escaneo de puertos, identificación de servicios
- **Active Directory**: análisis de dominios, identificación de configuraciones inseguras
- **Código Fuente**: análisis estático (SAST), búsqueda de secrets, vulnerabilities
- **Sistemas OT/ICS**: escaneo no intrusivo de infraestructura industrial

## Herramientas Disponibles

Tienes acceso a la herramienta `kali` que ejecuta comandos en contenedores Docker con Kali Linux.

### Herramientas Comunes

**Escaneo de Red:**
- `nmap` - Escaneo de puertos y detección de servicios
- `masscan` - Escaneo rápido de puertos a gran escala
- `rustscan` - Escaneo de puertos de alto rendimiento

**Web Application Security:**
- `nuclei` - Escaneo de vulnerabilidades con templates
- `httpx` - Probing y análisis de HTTP servers
- `nikto` - Escaneo de vulnerabilidades web
- `sqlmap` - Detección y explotación de SQL injection
- `gobuster` - Fuzzing de directorios y subdominios
- `ffuf` - Fuzzing web avanzado
- `wfuzz` - Web application fuzzer

**Password Cracking:**
- `john` - John the Ripper cracker
- `hashcat` - Password recovery avanzada
- `hydra` - Brute force online

**Active Directory:**
- `bloodhound-python` - Análisis de relaciones AD
- `impacket` - Suite de protocolos Windows
- `crackmapexec` - Enumeración de redes Windows

**Explotación:**
- `metasploit-framework` - Framework de explotación
- `searchsploit` - Búsqueda de exploits

## Flujo de Trabajo

1. **Entiende el objetivo**: Pregunta clarificadoras sobre el objetivo si no está claro
2. **Planifica**: Explica qué herramientas vas a usar y por qué
3. **Ejecuta**: Usa la herramienta `kali` para ejecutar comandos
4. **Analiza**: Interpreta los resultados y extrae hallazgos relevantes
5. **Reporta**: Genera un resumen ejecutivo de vulnerabilidades encontradas

## Modos de Operación

El usuario puede especificar tres modos:

- **Auto**: Ejecutas todo sin confirmación, asumiendo autorización
- **Assisted**: Preguntas antes de cada comando
- **Mixed**: Preguntas solo para comandos potencialmente destructivos

Si el modo no está especificado, pregunta al principio qué prefiere.

## Mejores Prácticas

- Siempre verifica que el objetivo está autorizado para auditoría
- Documenta cada paso con timestamps
- Usa timeouts apropiados (300s default)
- En modo persistent, reutiliza contenedores para eficiencia
- En modo one-shot, limpia contenedores automáticamente
- Guarda outputs importantes en archivos

## Formato de Reportes

Al finalizar una auditoría, genera un resumen con:

```
## Resumen de Auditoría
- Objetivo: [IP/URL/rango]
- Duración: [tiempo total]
- Herramientas utilizadas: [lista]

## Hallazgos
- Críticas: [número]
- Altas: [número]
- Medias: [número]
- Bajas: [número]

## Recomendaciones
1. [Recomendación prioritaria]
2. [Recomendación secundaria]
...
```

## Importante

- Nunca asumas autorización sin confirmación explícita
- Usa contenedores efímeros por defecto (persistent=false)
- Respeta los timeouts especificados
- Documenta hallazgos con contexto técnico claro
- Prioriza vulnerabilidades por severidad (CVSS)
```

**Step 2: Commit**

```bash
git add packages/opencode/src/agent/prompt/security.txt
git commit -m "feat(phase4): add security agent system prompt"
```

---

## Task 6: Comando Opensacia CLI

**Files:**
- Create: `packages/opencode/src/cli/cmd/opensacia.ts`
- Modify: `packages/opencode/src/cli/index.ts` (registrar comando)

**Step 1: Crear el comando opensacia**

```typescript
// packages/opencode/src/cli/cmd/opensacia.ts
import { cmd } from "./cmd"
import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { Agent } from "../../agent/agent"

type AutomationMode = "auto" | "assisted" | "mixed"

const MODE_DESCRIPTIONS = {
  auto: "Completamente autónomo - ejecuta todo sin preguntar",
  assisted: "Asistido - confirma cada acción antes de ejecutar",
  mixed: "Mixto - pregunta solo acciones potencialmente destructivas",
}

async function selectMode(cliMode: AutomationMode | undefined): Promise<AutomationMode> {
  if (cliMode) return cliMode

  UI.empty()
  prompts.intro("OPENSACIA Security Agent")

  const mode = await prompts.select({
    message: "¿Qué grado de automatización prefieres?",
    options: [
      {
        label: "Completamente autónomo",
        value: "auto" as const,
        hint: "Ejecuta todos los comandos sin confirmación",
      },
      {
        label: "Asistido",
        value: "assisted" as const,
        hint: "Confirma cada acción antes de ejecutar",
      },
      {
        label: "Mixto",
        value: "mixed" as const,
        hint: "Pregunta solo acciones potencialmente destructivas",
      },
    ],
    initialValue: "mixed" as const,
  })

  if (prompts.isCancel(mode)) {
    throw new UI.CancelledError()
  }

  prompts.outro(`Modo ${MODE_DESCRIPTIONS[mode].split(" - ")[0]} seleccionado`)

  return mode
}

export const OpensaciaCommand = cmd({
  command: "opensacia [prompt..]",
  describe: "OPENSACIA Security Agent - asistente de ciberseguridad autónomo",
  builder: (yargs: Argv) =>
    yargs
      .positional("prompt", {
        describe: "Prompt para el agente de seguridad",
        type: "string",
        array: true,
      })
      .option("agent", {
        type: "string",
        describe: "Agente a usar (security por defecto)",
        choices: ["security", "general"],
        default: "security",
      })
      .option("mode", {
        type: "string",
        describe: "Modo de automatización",
        choices: ["auto", "assisted", "mixed"] as const,
      })
      .option("target", {
        type: "string",
        alias: "t",
        describe: "Objetivo de la auditoría (IP, URL, rango)",
      })
      .option("report", {
        type: "string",
        alias: "r",
        describe: "Archivo para guardar el reporte",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const prompt = args.prompt ? args.prompt.join(" ") : undefined
      const agent = args.agent || "security"

      // Seleccionar modo si no se especificó
      const mode = await selectMode(args.mode as AutomationMode | undefined)

      // Construir prompt completo
      let fullPrompt = prompt || ""

      if (!fullPrompt) {
        // Si no hay prompt, preguntar
        prompts.intro("OPENSACIA")
        const query = await prompts.text({
          message: "¿Qué deseas auditar hoy?",
          placeholder: "Ej: Audita 192.168.1.0/24, Escanea example.com, etc.",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })

        if (prompts.isCancel(query)) throw new UI.CancelledError()

        fullPrompt = query
        prompts.outro()
      }

      // Agregar contexto de modo al prompt
      fullPrompt += `\n\n[OPENSACIA_MODE: ${mode.toUpperCase()}]`

      if (args.target) {
        fullPrompt += `\n[TARGET: ${args.target}]`
      }

      if (args.report) {
        fullPrompt += `\n[REPORT_OUTPUT: ${args.report}]`
      }

      // Ejecutar usando el comando run existente
      const { RunCommand } = await import("./run")
      await RunCommand.handler({
        message: [fullPrompt],
        agent,
        continue: undefined,
        session: undefined,
        fork: undefined,
        share: false,
        model: undefined,
        format: "default",
        file: undefined,
        title: `OPENSACIA Audit ${new Date().toISOString().split("T")[0]}`,
        attach: undefined,
        dir: undefined,
        port: undefined,
        variant: undefined,
        thinking: false,
        command: undefined,
        ["--"]: [],
      })
    })
  },
})
```

**Step 2: Registrar el comando en el CLI**

```bash
# Buscar el archivo principal del CLI
ls packages/opencode/src/cli/*.ts
```

**Step 3: Agregar el comando Opensacia al CLI principal**

Dependiendo de cómo esté estructurado el CLI, necesitarás importar y registrar el comando. Busca donde se registran comandos como `agent`, `github`, `gitlab`, etc.

```typescript
// Agregar import
import { OpensaciaCommand } from "./cmd/opensacia"

// Registrar en el builder de yargs
yargs.command(OpensaciaCommand)
```

**Step 4: Verificar comando registrado**

Run: `bun run opencode --help | grep opensacia`
Expected: `opensacia [prompt..]` appears in help

**Step 5: Commit**

```bash
git add packages/opencode/src/cli/cmd/opensacia.ts
git add packages/opencode/src/cli/index.ts
git commit -m "feat(phase4): add opensacia CLI command"
```

---

## Task 7: Parsers - Nmap

**Files:**
- Create: `packages/opencode/src/security/kali/parser.ts`
- Test: `packages/opencode/test/security/kali/parser.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/opencode/test/security/kali/parser.test.ts
import { describe, test, expect } from "bun:test"
import { NmapParser } from "../../../../src/security/kali/parser"

describe("NmapParser", () => {
  test("parsea output básico de nmap", () => {
    const output = `
Starting Nmap 7.94 ( https://nmap.org )
Nmap scan report for 192.168.1.1
Host is up (0.0023s latency).
PORT   STATE SERVICE
22/tcp open  ssh
80/tcp open  http
`
    const result = NmapParser.parse(output)
    expect(result.hosts).toHaveLength(1)
    expect(result.hosts[0].ip).toBe("192.168.1.1")
    expect(result.hosts[0].ports).toHaveLength(2)
  })

  test("extrae servicios detectados", () => {
    const output = `
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 8.9
443/tcp  open  https   nginx 1.18.0
`
    const result = NmapParser.parse(output)
    expect(result.hosts[0].ports[0].service).toBe("ssh")
    expect(result.hosts[0].ports[0].version).toBe("OpenSSH 8.9")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd packages/opencode test/security/kali/parser.test.ts`
Expected: FAIL with "NmapParser is not defined"

**Step 3: Write minimal implementation**

```typescript
// packages/opencode/src/security/kali/parser.ts

export interface Port {
  port: number
  protocol: string
  state: string
  service?: string
  version?: string
}

export interface Host {
  ip: string
  hostname?: string
  state: string
  ports: Port[]
  os?: string[]
}

export interface NmapResult {
  hosts: Host[]
  command?: string
}

export namespace NmapParser {
  export function parse(output: string): NmapResult {
    const hosts: Host[] = []
    const lines = output.split("\n")

    let currentHost: Host | null = null

    for (const line of lines) {
      // Detectar nuevo host
      const hostMatch = line.match(/Nmap scan report for ([^\s]+)/)
      if (hostMatch) {
        if (currentHost) {
          hosts.push(currentHost)
        }
        currentHost = {
          ip: hostMatch[1],
          state: "up",
          ports: [],
        }
        continue
      }

      // Detectar estado del host
      if (line.includes("Host is up")) {
        if (currentHost) currentHost.state = "up"
      }

      // Detectar puerto
      const portMatch = line.match(/(\d+)\/(\w+)\s+(\w+)\s+(\w+)(?:\s+(.+))?/)
      if (portMatch && currentHost) {
        const port: Port = {
          port: parseInt(portMatch[1]),
          protocol: portMatch[2],
          state: portMatch[3],
          service: portMatch[4],
        }
        if (portMatch[5]) {
          port.version = portMatch[5].trim()
        }
        currentHost.ports.push(port)
      }

      // Detectar OS
      if (line.includes("OS details:") && currentHost) {
        currentHost.os = currentHost.os || []
        const os = line.replace(/.*OS details:\s*/, "").trim()
        currentHost.os.push(os)
      }
    }

    if (currentHost) {
      hosts.push(currentHost)
    }

    return { hosts }
  }

  export function toMarkdown(result: NmapResult): string {
    let md = "## Resultados Nmap\n\n"

    for (const host of result.hosts) {
      md += `### Host: ${host.ip}\n\n`
      md += `- Estado: ${host.state}\n`

      if (host.hostname) {
        md += `- Hostname: ${host.hostname}\n`
      }

      if (host.os && host.os.length > 0) {
        md += `- OS: ${host.os.join(", ")}\n`
      }

      md += "\n#### Puertos Abiertos\n\n"
      md += "| Puerto | Protocolo | Estado | Servicio | Versión |\n"
      md += "|--------|-----------|--------|----------|--------|\n"

      for (const port of host.ports) {
        md += `| ${port.port} | ${port.protocol} | ${port.state} | ${port.service || "-"} | ${port.version || "-"} |\n`
      }

      md += "\n"
    }

    return md
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd packages/opencode test/security/kali/parser.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add packages/opencode/src/security/kali/parser.ts
git add packages/opencode/test/security/kali/parser.test.ts
git commit -m "feat(phase4): add NmapParser for parsing nmap output"
```

---

## Task 8: Parsers - Nuclei

**Files:**
- Modify: `packages/opencode/src/security/kali/parser.ts` (agregar NucleiParser)
- Modify: `packages/opencode/test/security/kali/parser.test.ts` (agregar tests)

**Step 1: Write the failing test**

```typescript
// Agregar al archivo de test
describe("NucleiParser", () => {
  test("parsea output JSON de nuclei", () => {
    const jsonOutput = JSON.stringify([
      {
        template: "cves/2021/CVE-2021-22204.yaml",
        templateID: "CVE-2021-22204",
        info: {
          name: "ExifTool CVE-2021-22204",
          severity: "critical",
        },
        host: "http://example.com",
        matched: "http://example.com",
      },
    ])

    const result = NucleiParser.parse(jsonOutput)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].severity).toBe("critical")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd packages/opencode test/security/kali/parser.test.ts`
Expected: FAIL with "NucleiParser is not defined"

**Step 3: Add implementation to parser.ts**

```typescript
// Agregar a packages/opencode/src/security/kali/parser.ts

export interface Finding {
  template: string
  templateID: string
  name: string
  severity: string
  host: string
  matched: string
  tags?: string[]
}

export interface NucleiResult {
  findings: Finding[]
}

export namespace NucleiParser {
  export function parse(output: string): NucleiResult {
    const findings: Finding[] = []

    try {
      // Nuclei puede output JSON o texto
      if (output.trim().startsWith("[")) {
        const parsed = JSON.parse(output) as Finding[]
        findings.push(...parsed)
      } else {
        // Parsear formato de texto
        const lines = output.split("\n")
        for (const line of lines) {
          if (line.includes("[") && line.includes("]")) {
            // Formato: [severity] [id] name
            const parts = line.split(/\s+/)
            // Implementación básica
          }
        }
      }
    } catch {
      // Si falla el parseo JSON, retornar vacío
    }

    return { findings }
  }

  export function toMarkdown(result: NucleiResult): string {
    let md = "## Resultados Nuclei\n\n"

    const grouped = result.findings.reduce((acc, f) => {
      if (!acc[f.severity]) acc[f.severity] = []
      acc[f.severity].push(f)
      return acc
    }, {} as Record<string, Finding[]>)

    const severityOrder = ["critical", "high", "medium", "low", "info"]

    for (const severity of severityOrder) {
      if (!grouped[severity]) continue

      md += `### ${severity.toUpperCase()} (${grouped[severity].length})\n\n`

      for (const finding of grouped[severity]) {
        md += `- **${finding.name}** (${finding.templateID})\n`
        md += `  - Host: ${finding.host}\n`
        md += `  - Template: ${finding.template}\n`
        if (finding.tags && finding.tags.length > 0) {
          md += `  - Tags: ${finding.tags.join(", ")}\n`
        }
        md += "\n"
      }
    }

    return md
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd packages/opencode test/security/kali/parser.test.ts`
Expected: PASS (3 tests total)

**Step 5: Commit**

```bash
git add packages/opencode/src/security/kali/parser.ts
git add packages/opencode/test/security/kali/parser.test.ts
git commit -m "feat(phase4): add NucleiParser for parsing nuclei output"
```

---

## Task 9: Generador de Reportes

**Files:**
- Create: `packages/opencode/src/security/kali/report.ts`
- Test: `packages/opencode/test/security/kali/report.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/opencode/test/security/kali/report.test.ts
import { describe, test, expect } from "bun:test"
import { ReportGenerator } from "../../../../src/security/kali/report"

describe("ReportGenerator", () => {
  test("genera markdown básico", () => {
    const report = ReportGenerator.generate({
      target: "192.168.1.1",
      duration: 300000,
      tools: ["nmap", "nuclei"],
      findings: {
        critical: 1,
        high: 2,
        medium: 5,
        low: 3,
      },
    })

    expect(report).toContain("# Auditoría de Seguridad")
    expect(report).toContain("192.168.1.1")
    expect(report).toContain("Críticas: 1")
  })

  test("incluye recomendaciones", () => {
    const report = ReportGenerator.generate({
      target: "example.com",
      duration: 60000,
      tools: ["nuclei"],
      findings: { critical: 0, high: 1, medium: 0, low: 0 },
      recommendations: ["Actualizar servidor nginx a versión más reciente"],
    })

    expect(report).toContain("## Recomendaciones")
    expect(report).toContain("Actualizar servidor nginx")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd packages/opencode test/security/kali/report.test.ts`
Expected: FAIL with "ReportGenerator is not defined"

**Step 3: Write minimal implementation**

```typescript
// packages/opencode/src/security/kali/report.ts

export interface AuditFinding {
  severity: "critical" | "high" | "medium" | "low" | "info"
  title: string
  description: string
  evidence?: string
  cve?: string
  cvss?: number
}

export interface AuditReport {
  target: string
  targetType: "web" | "network" | "ad" | "code" | "ot"
  duration: number
  startTime: Date
  endTime: Date
  tools: string[]
  findings: AuditFinding[]
  recommendations?: string[]
  metadata?: Record<string, unknown>
}

export namespace ReportGenerator {
  export function generate(input: {
    target: string
    duration: number
    tools: string[]
    findings: Record<string, number>
    recommendations?: string[]
    metadata?: Record<string, unknown>
  }): string {
    const { target, duration, tools, findings, recommendations, metadata } = input

    let md = `# Auditoría de Seguridad - OPENSACIA\n\n`

    // Header
    md += `**Objetivo:** ${target}\n\n`
    md += `**Fecha:** ${new Date().toISOString()}\n\n`
    md += `**Duración:** ${Math.round(duration / 1000)}s\n\n`
    md += `**Herramientas:** ${tools.join(", ")}\n\n`

    // Resumen ejecutivo
    md += `## Resumen Ejecutivo\n\n`
    const totalFindings = Object.values(findings).reduce((a, b) => a + b, 0)
    md += `- Total de hallazgos: ${totalFindings}\n`
    md += `- Críticas: ${findings.critical || 0}\n`
    md += `- Altas: ${findings.high || 0}\n`
    md += `- Medias: ${findings.medium || 0}\n`
    md += `- Bajas: ${findings.low || 0}\n`
    md += `- Info: ${findings.info || 0}\n\n`

    // Recomendaciones
    if (recommendations && recommendations.length > 0) {
      md += `## Recomendaciones\n\n`
      for (let i = 0; i < recommendations.length; i++) {
        md += `${i + 1}. ${recommendations[i]}\n`
      }
      md += "\n"
    }

    // Metadata
    if (metadata) {
      md += `## Metadatos\n\n`
      for (const [key, value] of Object.entries(metadata)) {
        md += `- **${key}:** ${value}\n`
      }
      md += "\n"
    }

    md += `---\n\n`
    md += `*Generado por OPENSACIA - Agente de Ciberseguridad Autónomo*\n`

    return md
  }

  export function save(report: string, path: string): void {
    require("fs").writeFileSync(path, report, "utf-8")
  }

  export function getReportPath(target: string): string {
    const sanitized = target.replace(/[^a-zA-Z0-9.-]/g, "_")
    const date = new Date().toISOString().split("T")[0]
    return `/tmp/opensacia-reports/${date}-${sanitized}.md`
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd packages/opencode test/security/kali/report.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add packages/opencode/src/security/kali/report.ts
git add packages/opencode/test/security/kali/report.test.ts
git commit -m "feat(phase4): add ReportGenerator for security audit reports"
```

---

## Task 10: Environment Flags y Configuración

**Files:**
- Modify: `packages/opencode/src/flag/flag.ts` (agregar flags OPENSACIA_*)
- Create: `packages/opencode/src/config/opensacia.ts`

**Step 1: Agregar flags a flag.ts**

```typescript
// Agregar a packages/opencode/src/flag/flag.ts

// Docker / Kali configuration
export const OPENSACIA_KALI_IMAGE =
  process.env.OPENSACIA_KALI_IMAGE ?? "kalilinux/kali-rolling:latest"

export const OPENSACIA_DOCKER_NETWORK = process.env.OPENSACIA_DOCKER_NETWORK ?? "host"

export const OPENSACIA_REPORT_PATH =
  process.env.OPENSACIA_REPORT_PATH ?? "/tmp/opensacia-reports"

export const OPENSACIA_DEFAULT_TIMEOUT =
  parseInt(process.env.OPENSACIA_DEFAULT_TIMEOUT ?? "300", 10)

export const OPENSACIA_DEFAULT_MODE =
  process.env.OPENSACIA_DEFAULT_MODE ?? ("mixed" as "auto" | "assisted" | "mixed")

// Security agent defaults
export const OPENSACIA_AUTO_CLEANUP =
  process.env.OPENSACIA_AUTO_CLEANUP ?? "true" === "true"
```

**Step 2: Actualizar KaliContainer para usar flags**

```typescript
// Modificar packages/opencode/src/security/kali/container.ts
import { Flag } from "@/flag/flag"

// Reemplazar constantes por flags:
const KALI_IMAGE = Flag.OPENSACIA_KALI_IMAGE

export class KaliContainer {
  // ...
  async createOneShot(): Promise<string> {
    const id = KaliContainer.generateId()
    await $`docker create --name ${id} ${KALI_IMAGE}`.quiet()
    await $`docker network connect ${Flag.OPENSACIA_DOCKER_NETWORK} ${id}`.quiet()
    // ...
  }
}
```

**Step 3: Commit**

```bash
git add packages/opencode/src/flag/flag.ts
git add packages/opencode/src/security/kali/container.ts
git commit -m "feat(phase4): add OPENSACIA environment flags"
```

---

## Task 11: Directorio de reportes

**Files:**
- Modify: `packages/opencode/src/security/kali/report.ts` (asegurar creación de directorio)

**Step 1: Agregar creación de directorio**

```typescript
// Modificar packages/opencode/src/security/kali/report.ts
import { $ } from "bun"
import { Flag } from "@/flag/flag"

export namespace ReportGenerator {
  export function ensureReportDir(): void {
    const reportPath = Flag.OPENSACIA_REPORT_PATH
    try {
      $`mkdir -p ${reportPath}`.quiet()
    } catch {
      // Directorio puede ya existir
    }
  }

  export function save(report: string, path: string): void {
    ensureReportDir()
    const fs = require("fs")
    fs.mkdirSync(require("path").dirname(path), { recursive: true })
    fs.writeFileSync(path, report, "utf-8")
  }

  export function getReportPath(target: string): string {
    const sanitized = target.replace(/[^a-zA-Z0-9.-]/g, "_")
    const date = new Date().toISOString().split("T")[0]
    const filename = `${date}-${sanitized}.md`
    return require("path").join(Flag.OPENSACIA_REPORT_PATH, filename)
  }
}
```

**Step 2: Test de creación de directorio**

```bash
# Verificar que el directorio se crea
bun -e "import {ReportGenerator} from './packages/opencode/src/security/kali/report.ts'; ReportGenerator.ensureReportDir();"
ls -la /tmp/opensacia-reports/
```

**Step 3: Commit**

```bash
git add packages/opencode/src/security/kali/report.ts
git commit -m "feat(phase4): ensure report directory exists"
```

---

## Task 12: Tests de integración

**Files:**
- Create: `packages/opencode/test/security/integration.test.ts`
- Create: `packages/opencode/test/security/docker-compose.test.yml`

**Step 1: Crear test de integración básico**

```typescript
// packages/opencode/test/security/integration.test.ts
import { describe, test, expect, beforeAll } from "bun:test"
import { KaliContainer } from "../../src/security/kali/container"
import { KaliTool } from "../../src/tool/kali"

describe.skipIf(!process.env.KALI_TESTS)("Security Integration Tests", () => {
  let kali: KaliContainer

  beforeAll(async () => {
    kali = new KaliContainer()
    const dockerCheck = await kali.checkDocker()
    if (!dockerCheck.available) {
      throw new Error("Docker not available for integration tests")
    }
  })

  test("crea y ejecuta comando en contenedor Kali", async () => {
    const containerId = await kali.createOneShot()
    expect(containerId).toBeTruthy()

    const result = await kali.exec(containerId, "nmap --version")
    expect(result.stdout).toContain("Nmap")

    await kali.destroy(containerId)
  })

  test("KaliTool init correctamente", async () => {
    const config = await KaliTool.init()
    expect(config.description).toContain("Kali")
  })

  afterAll(async () => {
    await kali?.cleanup()
  })
})
```

**Step 2: Ejecutar tests de integración si Docker está disponible**

```bash
# Solo funciona si Docker está instalado
KALI_TESTS=true bun test --cwd packages/opencode test/security/integration.test.ts
```

**Step 3: Commit**

```bash
git add packages/opencode/test/security/integration.test.ts
git commit -m "feat(phase4): add integration tests for Kali tools"
```

---

## Task 13: Documentación de uso

**Files:**
- Create: `docs/security/usage.md`

**Step 1: Crear documentación de uso**

```markdown
# OPENSACIA Security Agent - Guía de Uso

## Instalación

OPENSACIA requiere Docker instalado y corriendo:

```bash
# Verificar Docker
docker --version

# Descargar imagen Kali (opcional, se descarga automáticamente)
docker pull kalilinux/kali-rolling:latest
```

## Comandos Básicos

### Modo Interactivo

```bash
# Iniciar OPENSACIA en modo interactivo
opencode opensacia

# Especificar modo de automatización
opencode opensacia --mode auto
opencode opensacia --mode assisted
opencode opensacia --mode mixed
```

### Auditoría Directa

```bash
# Escaneo de red
opencode opensacia "Audita la red 192.168.1.0/24" --target 192.168.1.0/24

# Auditoría web
opencode opensacia "Escanea example.com en busca de vulnerabilidades" --target example.com

# Con reporte específico
opencode opensacia "Audita localhost" --report /tmp/audit-report.md
```

## Modos de Automatización

### Auto
Ejecuta todos los comandos sin confirmación. Útil para auditorías no interactivas.

```bash
opencode opensacia "Escaneo completo de 10.0.0.0/24" --mode auto
```

### Assisted
Confirma cada acción antes de ejecutar. Máximo control.

```bash
opencode opensacia "Pentesting de mi servidor web" --mode assisted
```

### Mixed (Default)
Pregunta solo acciones potencialmente destructivas.

```bash
opencode opensacia "Análisis de vulnerabilidades" --mode mixed
```

## Ejemplos de Auditoría

### Web Application Security

```bash
opencode opensacia "
Realiza una auditoría web completa de example.com incluyendo:
- Descubrimiento de subdominios
- Escaneo de puertos web
- Análisis de vulnerabilidades con nuclei
- Fuzzing de directorios
" --target example.com
```

### Network Scanning

```bash
opencode opensacia "
Descubre hosts activos en 192.168.1.0/24 y escanea puertos abiertos.
Luego identifica vulnerabilidades en servicios web encontrados.
" --target 192.168.1.0/24
```

### Active Directory

```bash
opencode opensacia "
Enumera el dominio usando las credenciales proporcionadas.
Identifica configuraciones inseguras y posibles rutas de escalación de privilegios.
" --mode mixed
```

## Variables de Entorno

```bash
# Imagen de Kali a usar
export OPENSACIA_KALI_IMAGE="kalilinux/kali-rolling:latest"

# Modo de red Docker
export OPENSACIA_DOCKER_NETWORK="host"

# Directorio de reportes
export OPENSACIA_REPORT_PATH="/tmp/opensacia-reports"

# Timeout default (segundos)
export OPENSACIA_DEFAULT_TIMEOUT="300"

# Modo default
export OPENSACIA_DEFAULT_MODE="mixed"
```

## Archivo de Configuración

Crea `~/.config/opensacia/config.json`:

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
      "formats": ["markdown", "json"]
    },
    "modes": {
      "default": "mixed"
    }
  }
}
```

## Salida de Reportes

Los reportes se guardan en `/tmp/opensacia-reports/` por defecto:

```
/tmp/opensacia-reports/
├── 2026-03-05-192.168.1.1.md
├── 2026-03-05-example.com.md
└── 2026-03-05-ad-audit.md
```

## Troubleshooting

### Docker no está corriendo

```bash
# Error: Docker not available
# Solución:
sudo systemctl start docker  # Linux
open -a Docker               # macOS
```

### Contenedores huérfanos

```bash
# Limpiar contenedores kali huérfanos
docker ps -a --filter "name=kali-" -q | xargs docker rm -f
```

### Imagen Kali no disponible

```bash
# Descargar manualmente
docker pull kalilinux/kali-rolling:latest
```
```

**Step 2: Commit**

```bash
git add docs/security/usage.md
git commit -m "docs(phase4): add security agent usage guide"
```

---

## Task 14: Actualizar CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (agregar sección sobre OPENSACIA security)

**Step 1: Agregar sección a CLAUDE.md**

```markdown
## OPENSACIA Security Agent

OPENSACIA incluye un agente especializado en ciberseguridad que ejecuta herramientas de Kali Linux en contenedores Docker.

### Comando principal

```bash
opencode opensacia "tu prompt de auditoría"
```

### Modos de operación

- `--mode auto`: Completamente autónomo
- `--mode assisted`: Confirma cada acción
- `--mode mixed`: Pregunta solo acciones destructivas (default)

### Herramientas disponibles

El agente puede ejecutar cualquier herramienta de Kali:
- Red: nmap, masscan, rustscan
- Web: nuclei, httpx, nikto, sqlmap, gobuster
- Password: john, hashcat, hydra
- AD: bloodhound-python, impacket, crackmapexec

### Requisitos

- Docker instalado y corriendo
- Imagen `kalilinux/kali-rolling:latest` (se descarga automáticamente)

Más información en `docs/security/usage.md`
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(phase4): document security agent in CLAUDE.md"
```

---

## Task 15: Validación end-to-end

**Files:**
- None (validation task)

**Step 1: Verificar compilación**

```bash
cd packages/opencode
bun run build
```

Expected: No errors

**Step 2: Verificar que el comando está disponible**

```bash
opencode --help | grep -A 2 opensacia
```

Expected: Command appears in help

**Step 3: Listar agentes**

```bash
opencode agent list | grep security
```

Expected: `security (primary)` appears

**Step 4: Verificar tools registrados**

```bash
opencode --help
# Buscar kali en la lista de tools disponibles si se muestra
```

**Step 5: Commit (si hubo cambios menores)**

```bash
# Solo si hubo ajustes necesarios
git add .
git commit -m "fix(phase4): minor adjustments from E2E validation"
```

---

## Task 16: Tests completos

**Files:**
- None (run all tests)

**Step 1: Ejecutar todos los tests nuevos**

```bash
# Tests de KaliContainer
bun test --cwd packages/opencode test/security/kali/container.test.ts

# Tests de parser
bun test --cwd packages/opencode test/security/kali/parser.test.ts

# Tests de report generator
bun test --cwd packages/opencode test/security/kali/report.test.ts

# Tests de KaliTool
bun test --cwd packages/opencode test/tool/kali.test.ts
```

Expected: All tests pass

**Step 2: Ejecutar suite completa de tests (opcional)**

```bash
bun test --cwd packages/opencode
```

**Step 3: Commit (si hubo ajustes por tests fallidos)**

```bash
git add .
git commit -m "test(phase4): ensure all security tests pass"
```

---

## Task 17: Release notes y changelog

**Files:**
- Create: `CHANGELOG_PHASE4.md`

**Step 1: Crear notas de release**

```markdown
# OPENSACIA Phase 4 - Security Agent

## Resumen

Phase 4 transforma OPENSACIA en un agente de ciberseguridad autónomo capaz de ejecutar herramientas de Kali Linux en contenedores Docker.

## Componentes Nuevos

### Core
- **KaliContainer Manager**: Gestión de contenedores Docker efímeros y persistentes
- **KaliTool**: Tool genérico para ejecutar cualquier comando de Kali Linux
- **Security Agent**: Agente especializado en ciberseguridad
- **Parsers**: NmapParser, NucleiParser para análisis de output
- **ReportGenerator**: Generación de reportes profesionales en markdown

### CLI
- Comando `opencode opensacia` con selección de modo de automatización
- Opciones: `--mode`, `--target`, `--report`

### Configuración
- Variables de entorno OPENSACIA_*
- Config file en `~/.config/opensacia/config.json`

## Modos de Operación

1. **Auto**: Ejecución completamente autónoma
2. **Assisted**: Confirmación de cada acción
3. **Mixed**: Preguntas solo para acciones destructivas (default)

## Herramientas Soportadas

- Red: nmap, masscan, rustscan
- Web: nuclei, httpx, nikto, sqlmap, gobuster, ffuf, wfuzz
- Password: john, hashcat, hydra
- Active Directory: bloodhound-python, impacket, crackmapexec
- Explotación: metasploit-framework, searchsploit

## Uso Básico

```bash
# Modo interactivo
opencode opensacia

# Auditoría directa
opencode opensacia "Audita 192.168.1.0/24" --target 192.168.1.0/24 --mode auto
```

## Requisitos

- Docker instalado y corriendo
- Imagen `kalilinux/kali-rolling:latest` (descarga automática)

## Archivos Creados

```
packages/opencode/src/
├── security/
│   ├── kali/
│   │   ├── container.ts    # KaliContainer manager
│   │   ├── parser.ts       # NucleiParser, NmapParser
│   │   └── report.ts       # ReportGenerator
│   └── index.ts
├── tool/
│   └── kali.ts             # KaliTool
├── agent/
│   ├── agent.ts            # Security agent definition
│   └── prompt/
│       └── security.txt    # System prompt
├── cli/
│   └── cmd/
│       └── opensacia.ts    # Opensacia CLI command
└── flag/
    └── flag.ts             # OPENSACIA_* flags

test/
├── security/
│   └── kali/
│       ├── container.test.ts
│       ├── parser.test.ts
│       ├── report.test.ts
│       └── integration.test.ts
└── tool/
    └── kali.test.ts

docs/
├── security/
│   └── usage.md
└── plans/
    └── 2026-03-05-opensacia-phase4-security-implementation.md
```

## Testing

```bash
# Unit tests
bun test --cwd packages/opencode test/security/

# Integration tests (requiere Docker)
KALI_TESTS=true bun test --cwd packages/opencode test/security/integration.test.ts
```

## Siguiente Fase

Phase 5: Integración con pipelines de GitLab CI/CD para auditorías automáticas en commits y MRs.
```

**Step 2: Commit**

```bash
git add CHANGELOG_PHASE4.md
git commit -m "docs(phase4): add Phase 4 release notes"
```

---

## Validación Final

Antes de considerar Phase 4 completa:

1. **Build**: `bun run build` en packages/opencode ✓
2. **Tests**: Todos los tests unitarios pasan ✓
3. **CLI**: `opencode opensacia --help` funciona ✓
4. **Agent**: `opencode agent list` muestra 'security' ✓
5. **Docs**: Documentación de uso completa ✓
6. **Docker**: KaliContainer verifica disponibilidad de Docker ✓

---

**Fin del plan de implementación**
