import path from "path"

export interface PythonEnvironment {
  pythonPath: string
  extraPaths: string[]
}

/**
 * Simple Python environment detection for mainstream use cases
 * Supports: activated venv (VIRTUAL_ENV), local .venv, local venv, system Python
 */
export async function detectPythonEnvironment(root: string): Promise<PythonEnvironment | undefined> {
  // 1. Check for activated virtual environment
  const virtualEnv = process.env["VIRTUAL_ENV"]
  if (virtualEnv) {
    const pythonPath = getPythonExecutable(virtualEnv)
    if (await Bun.file(pythonPath).exists()) {
      const sitePackages = await getSitePackagesPath(pythonPath)
      return {
        pythonPath,
        extraPaths: sitePackages ? [sitePackages] : [],
      }
    }
  }

  // 2. Check for local virtual environments (.venv, venv)
  for (const venvDir of [".venv", "venv"]) {
    const venvPath = path.join(root, venvDir)
    const pythonPath = getPythonExecutable(venvPath)
    if (await Bun.file(pythonPath).exists()) {
      const sitePackages = await getSitePackagesPath(pythonPath)
      return {
        pythonPath,
        extraPaths: sitePackages ? [sitePackages] : [],
      }
    }
  }

  // 3. Fall back to system Python
  const systemPython = Bun.which("python3") || Bun.which("python")
  if (systemPython) {
    return {
      pythonPath: systemPython,
      extraPaths: [],
    }
  }

  return undefined
}

/**
 * Get Python executable path for a virtual environment directory
 */
function getPythonExecutable(venvPath: string): string {
  const isWindows = process.platform === "win32"
  return isWindows ? path.join(venvPath, "Scripts", "python.exe") : path.join(venvPath, "bin", "python")
}

/**
 * Get site-packages directory for a Python executable
 */
async function getSitePackagesPath(pythonPath: string): Promise<string | undefined> {
  try {
    const proc = Bun.spawn({
      cmd: [pythonPath, "-c", "import site; print(site.getsitepackages()[0])"],
      stdout: "pipe",
      stderr: "pipe",
    })

    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    return exitCode === 0 ? output.trim() : undefined
  } catch {
    return undefined
  }
}

/**
 * Generate simple initialization options for Pyright
 */
export function generatePythonSettings(env: PythonEnvironment): Record<string, any> {
  // Use the same multi-format approach that was working before
  const pythonConfig = {
    pythonPath: env.pythonPath,
    analysis: {
      extraPaths: env.extraPaths,
    },
  }

  const settings = {
    // Direct Pyright settings
    ...pythonConfig,
    // VS Code Python extension format
    python: pythonConfig,
    // Settings wrapper
    settings: {
      python: pythonConfig,
    },
  }
  return settings
}
