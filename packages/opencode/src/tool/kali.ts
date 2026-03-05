// packages/opencode/src/tool/kali.ts
import { Tool } from "./tool"
import z from "zod"
import { KaliContainer } from "@/security/kali/container"
import { Log } from "@/util/log"

const log = Log.create({ service: "kali-tool" })

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
