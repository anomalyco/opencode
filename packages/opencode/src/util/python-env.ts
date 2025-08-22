import path from "path"

export namespace PythonEnv {
  export interface Environment {
    pythonPath?: string
    venvPath?: string
    venv?: string
    extraPaths?: string[]
  }

  export interface PyrightConfig {
    venvPath?: string
    venv?: string
    extraPaths?: string[]
    pythonVersion?: string
    pythonPlatform?: string
  }

  /**
   * Get the currently activated virtual environment from environment variables
   */
  export function getActivatedVirtualEnv(): string | undefined {
    // Check for activated virtual environment
    const virtualEnv = process.env["VIRTUAL_ENV"]
    if (virtualEnv) return virtualEnv

    // Check for conda environment
    const condaEnv = process.env["CONDA_DEFAULT_ENV"]
    const condaPrefix = process.env["CONDA_PREFIX"]
    if (condaEnv && condaPrefix) return condaPrefix

    return undefined
  }

  /**
   * Find virtual environment directories near the project root
   */
  export async function findVirtualEnvironment(root: string): Promise<string | undefined> {
    const venvDirs = [".venv", "venv", "env", ".env"]

    for (const venvDir of venvDirs) {
      const venvPath = path.join(root, venvDir)
      const pythonPath = await findPythonExecutable(venvPath)
      if (pythonPath) return venvPath
    }

    // Look in parent directories up to 3 levels
    let current = root
    for (let i = 0; i < 3; i++) {
      const parent = path.dirname(current)
      if (parent === current) break

      for (const venvDir of venvDirs) {
        const venvPath = path.join(parent, venvDir)
        const pythonPath = await findPythonExecutable(venvPath)
        if (pythonPath) return venvPath
      }
      current = parent
    }

    return undefined
  }

  /**
   * Find Python executable in a virtual environment directory
   */
  export async function findPythonExecutable(venvPath: string): Promise<string | undefined> {
    const isWindows = process.platform === "win32"
    const pythonPaths = isWindows
      ? [
          path.join(venvPath, "Scripts", "python.exe"),
          path.join(venvPath, "Scripts", "python3.exe"),
          path.join(venvPath, "python.exe"),
        ]
      : [path.join(venvPath, "bin", "python"), path.join(venvPath, "bin", "python3"), path.join(venvPath, "python")]

    for (const pythonPath of pythonPaths) {
      if (await Bun.file(pythonPath).exists()) return pythonPath
    }

    return undefined
  }

  /**
   * Read Pyright configuration from pyrightconfig.json
   */
  export async function readPyrightConfig(root: string): Promise<PyrightConfig | undefined> {
    const configPath = path.join(root, "pyrightconfig.json")

    try {
      if (await Bun.file(configPath).exists()) {
        const config = await Bun.file(configPath).json()
        return {
          venvPath: config.venvPath,
          venv: config.venv,
          extraPaths: config.extraPaths,
          pythonVersion: config.pythonVersion,
          pythonPlatform: config.pythonPlatform,
        }
      }
    } catch (error) {
      // Ignore JSON parsing errors
    }

    return undefined
  }

  /**
   * Read Pyright configuration from pyproject.toml
   */
  export async function readPyprojectConfig(root: string): Promise<PyrightConfig | undefined> {
    const configPath = path.join(root, "pyproject.toml")

    try {
      if (await Bun.file(configPath).exists()) {
        const content = await Bun.file(configPath).text()

        // Simple TOML parsing for [tool.pyright] section
        const pyrightSection = content.match(/\[tool\.pyright\]([\s\S]*?)(?=\[|$)/)
        if (!pyrightSection) return undefined

        const section = pyrightSection[1]
        const config: PyrightConfig = {}

        // Extract venvPath
        const venvPathMatch = section.match(/venvPath\s*=\s*["']([^"']+)["']/)
        if (venvPathMatch) config.venvPath = venvPathMatch[1]

        // Extract venv
        const venvMatch = section.match(/venv\s*=\s*["']([^"']+)["']/)
        if (venvMatch) config.venv = venvMatch[1]

        // Extract extraPaths array
        const extraPathsMatch = section.match(/extraPaths\s*=\s*\[([\s\S]*?)\]/)
        if (extraPathsMatch) {
          const pathsStr = extraPathsMatch[1]
          const paths = pathsStr.match(/["']([^"']+)["']/g)
          if (paths) {
            config.extraPaths = paths.map((p) => p.slice(1, -1)) // Remove quotes
          }
        }

        // Extract pythonVersion
        const versionMatch = section.match(/pythonVersion\s*=\s*["']([^"']+)["']/)
        if (versionMatch) config.pythonVersion = versionMatch[1]

        // Extract pythonPlatform
        const platformMatch = section.match(/pythonPlatform\s*=\s*["']([^"']+)["']/)
        if (platformMatch) config.pythonPlatform = platformMatch[1]

        return Object.keys(config).length > 0 ? config : undefined
      }
    } catch (error) {
      // Ignore parsing errors
    }

    return undefined
  }

  /**
   * Detect Python environment for a project root
   */
  export async function detectPythonEnvironment(root: string): Promise<Environment | undefined> {
    const env: Environment = {}

    // 1. Check for explicit configuration files
    const pyrightConfig = (await readPyrightConfig(root)) || (await readPyprojectConfig(root))
    if (pyrightConfig) {
      if (pyrightConfig.venvPath && pyrightConfig.venv) {
        const venvFullPath = path.resolve(root, pyrightConfig.venvPath, pyrightConfig.venv)
        const pythonPath = await findPythonExecutable(venvFullPath)
        if (pythonPath) {
          env.pythonPath = pythonPath
          env.venvPath = pyrightConfig.venvPath
          env.venv = pyrightConfig.venv
        }
      }
      if (pyrightConfig.extraPaths) {
        env.extraPaths = pyrightConfig.extraPaths.map((p) => path.resolve(root, p))
      }
    }

    // 2. Check for activated virtual environment
    if (!env.pythonPath) {
      const activatedVenv = getActivatedVirtualEnv()
      if (activatedVenv) {
        const pythonPath = await findPythonExecutable(activatedVenv)
        if (pythonPath) {
          env.pythonPath = pythonPath
          env.venvPath = path.dirname(activatedVenv)
          env.venv = path.basename(activatedVenv)
        }
      }
    }

    // 3. Look for local virtual environment directories
    if (!env.pythonPath) {
      const localVenv = await findVirtualEnvironment(root)
      if (localVenv) {
        const pythonPath = await findPythonExecutable(localVenv)
        if (pythonPath) {
          env.pythonPath = pythonPath
          env.venvPath = path.dirname(localVenv)
          env.venv = path.basename(localVenv)
        }
      }
    }

    // 4. Check for system Python as fallback
    if (!env.pythonPath) {
      const systemPython = Bun.which("python3") || Bun.which("python")
      if (systemPython) {
        env.pythonPath = systemPython
      }
    }

    return Object.keys(env).length > 0 ? env : undefined
  }

  /**
   * Get site-packages path for a Python environment
   */
  export async function getSitePackagesPath(pythonPath: string): Promise<string | undefined> {
    try {
      const proc = Bun.spawn({
        cmd: [pythonPath, "-c", "import site; print(site.getsitepackages()[0])"],
        stdout: "pipe",
        stderr: "pipe",
      })

      const output = await new Response(proc.stdout).text()
      const exitCode = await proc.exited

      if (exitCode === 0) {
        return output.trim()
      }
    } catch (error) {
      // Ignore errors
    }

    return undefined
  }

  /**
   * Generate initialization options for Pyright LSP server
   */
  export async function generateInitializationOptions(env: Environment): Promise<Record<string, any>> {
    // Get site-packages path first
    let sitePackages: string | undefined
    if (env.pythonPath) {
      sitePackages = await getSitePackagesPath(env.pythonPath)
    }

    // Collect all extra paths
    const extraPaths = env.extraPaths ? [...env.extraPaths] : []
    if (sitePackages) {
      extraPaths.push(sitePackages)
    }

    // Format for Pyright language server
    const pythonSettings = {
      ...(env.pythonPath && { pythonPath: env.pythonPath }),
      ...(env.venvPath && { venvPath: env.venvPath }),
      ...(env.venv && { venv: env.venv }),
      ...(extraPaths.length > 0 && {
        analysis: {
          extraPaths: [...new Set(extraPaths)], // Remove duplicates
        },
      }),
    }

    // Try multiple formats that Pyright might accept
    const result = {
      // Direct Pyright settings
      ...pythonSettings,
      // VS Code Python extension format
      python: pythonSettings,
      // Settings wrapper
      settings: {
        python: pythonSettings,
      },
    }

    return result
  }
}
