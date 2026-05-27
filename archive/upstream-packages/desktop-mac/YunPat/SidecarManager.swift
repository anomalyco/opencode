import Foundation
import Darwin

struct ServerInfo {
    let url: String
    let port: Int
}

enum SidecarError: Error, LocalizedError {
    case portUnavailable
    case bunNotFound
    case coreNotFound
    case startupTimeout
    case processExited(code: Int32, detail: String?)

    var errorDescription: String? {
        switch self {
        case .portUnavailable: return "无法分配可用端口"
        case .bunNotFound: return "未找到 Bun 运行时。请重新安装应用，或联系支持。"
        case .coreNotFound: return "未找到核心引擎文件"
        case .startupTimeout: return "核心引擎启动超时（60秒）"
        case .processExited(let code, let detail):
            if let detail, !detail.isEmpty {
                return "核心引擎进程退出（代码: \(code)）\n\(detail)"
            }
            return "核心引擎进程退出（代码: \(code)）"
        }
    }
}

class SidecarManager {
    private var process: Process?
    private var stderrPipe: Pipe?
    private var port: Int = 0
    private var serverURL: String = ""
    private let startupTimeout: TimeInterval = 60
    private let stopTimeout: TimeInterval = 6

    // Health monitoring
    private var healthTimer: Timer?
    private let healthInterval: TimeInterval = 30
    private var consecutiveFailures = 0
    private let maxConsecutiveFailures = 3

    // Auto-restart
    private var restartCount = 0
    private let maxRestartCount = 3
    private let autoRestartEnabled: Bool

    var onProcessDied: ((Error) -> Void)?

    /// Project root directory (contains packages/opencode)
    private let projectRoot: URL

    init(projectRoot: URL? = nil) {
        self.projectRoot = projectRoot ?? SidecarManager.findProjectRoot()
        self.autoRestartEnabled = ProcessInfo.processInfo.environment["YUNPAT_AUTO_RESTART"] != "false"
    }

    func start(completion: @escaping (Result<ServerInfo, Error>) -> Void) {
        guard let port = findAvailablePort() else {
            completion(.failure(SidecarError.portUnavailable))
            return
        }
        self.port = port
        self.serverURL = "http://127.0.0.1:\(port)"

        guard let bunPath = findBunExecutable() else {
            completion(.failure(SidecarError.bunNotFound))
            return
        }

        guard let (entry, isBundled) = findServeEntry() ?? findCoreEntry() else {
            print("SidecarManager: serve entry missing under projectRoot \(projectRoot.path)")
            completion(.failure(SidecarError.coreNotFound))
            return
        }

        // Ensure plugin re-export files exist for engine discovery (source mode only)
        if !isBundled { ensurePluginsAvailable() }

        print("SidecarManager: starting core engine")
        print("  bun: \(bunPath.path)")
        print("  entry: \(entry.path) (bundled: \(isBundled))")
        print("  port: \(port)")

        let proc = Process()
        proc.executableURL = bunPath
        // Bundled js doesn't need --conditions=browser
        let args = isBundled
            ? ["run", entry.path, "serve", "--port", "\(port)"]
            : ["run", "--conditions=browser", entry.path, "serve", "--port", "\(port)"]
        proc.arguments = args
        proc.environment = createSidecarEnv()
        proc.currentDirectoryURL = projectRoot

        let errPipe = Pipe()
        proc.standardError = errPipe
        proc.standardOutput = FileHandle.nullDevice

        self.process = proc
        self.stderrPipe = errPipe

        do {
            try proc.run()
        } catch {
            completion(.failure(error))
            return
        }

        waitForHealthCheck(completion: completion)
    }

    func stop() {
        stopHealthMonitor()

        guard let process = process, process.isRunning else {
            self.process = nil
            self.stderrPipe = nil
            return
        }

        // 1. Graceful termination (SIGTERM via terminate())
        process.terminate()

        let deadline = Date().addingTimeInterval(stopTimeout)
        while process.isRunning && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }

        // 2. Force kill if still running
        if process.isRunning {
            kill(process.processIdentifier, SIGKILL)
            let killDeadline = Date().addingTimeInterval(2)
            while process.isRunning && Date() < killDeadline {
                RunLoop.current.run(until: Date().addingTimeInterval(0.1))
            }
        }

        // 3. Close stderr pipe
        if let pipe = stderrPipe {
            try? pipe.fileHandleForReading.close()
        }

        self.process = nil
        self.stderrPipe = nil
    }

    private func readStderrTail(maxBytes: Int = 16_384) -> String? {
        guard let pipe = stderrPipe else { return nil }
        let handle = pipe.fileHandleForReading
        let data = handle.readDataToEndOfFile()
        guard !data.isEmpty else { return nil }
        let text = String(data: data, encoding: .utf8) ?? ""
        if text.count <= maxBytes { return text.trimmingCharacters(in: .whitespacesAndNewlines) }
        return String(text.suffix(maxBytes)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Plugin Auto-Registration

    private struct PluginDef {
        let filename: String
        let packagePath: String
    }

    private static let builtInPlugins: [PluginDef] = [
        PluginDef(filename: "patent-plugin.ts", packagePath: "opencode-patent-plugin"),
        PluginDef(filename: "router-plugin.ts", packagePath: "professional-router-plugin"),
    ]

    private func ensurePluginsAvailable() {
        let pluginDir = projectRoot.appendingPathComponent(".yunpat-agent/plugin")
        let fm = FileManager.default

        do {
            try fm.createDirectory(at: pluginDir, withIntermediateDirectories: true)
        } catch {
            print("SidecarManager: warning — could not create plugin dir: \(error)")
            return
        }

        for def in Self.builtInPlugins {
            let file = pluginDir.appendingPathComponent(def.filename)
            if fm.fileExists(atPath: file.path) { continue }

            let content = "export { default } from \"../../packages/\(def.packagePath)/src/index.ts\"\n"
            do {
                try content.write(to: file, atomically: true, encoding: .utf8)
                print("SidecarManager: created plugin re-export \(def.filename)")
            } catch {
                print("SidecarManager: warning — could not write \(def.filename): \(error)")
            }
        }
    }

    // MARK: - Discovery

    private static func findProjectRoot() -> URL {
        if let embedded = embeddedProjectRoot() {
            return embedded
        }

        var dir = Bundle.main.bundleURL
        for _ in 0..<8 {
            if isMonorepoRoot(dir) {
                return dir
            }
            dir = dir.deletingLastPathComponent()
        }

        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        if isMonorepoRoot(cwd) {
            return cwd
        }

        return cwd
    }

    private static func isMonorepoRoot(_ dir: URL) -> Bool {
        let marker = dir.appendingPathComponent("packages/opencode/package.json")
        return FileManager.default.fileExists(atPath: marker.path)
    }

    private static func embeddedProjectRoot() -> URL? {
        guard let resourcePath = Bundle.main.resourcePath else { return nil }
        let embedded = URL(fileURLWithPath: resourcePath).appendingPathComponent("project-root")
        if isMonorepoRoot(embedded) {
            return embedded
        }
        return nil
    }

    private func findBunExecutable() -> URL? {
        // Check embedded bun first (production)
        if let resourcePath = Bundle.main.resourcePath {
            let embeddedBun = URL(fileURLWithPath: resourcePath).appendingPathComponent("bun/bin/bun")
            if FileManager.default.isExecutableFile(atPath: embeddedBun.path) {
                return embeddedBun
            }
        }

        // System bun
        let candidates = [
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun",
            "\(NSHomeDirectory())/.bun/bin/bun",
        ]
        for path in candidates {
            if FileManager.default.isExecutableFile(atPath: path) {
                return URL(fileURLWithPath: path)
            }
        }
        return nil
    }

    /// Returns (entryURL, isBundled). Bundled sidecar.js is preferred for production.
    private func findServeEntry() -> (URL, Bool)? {
        // Pre-built bundle (production)
        let bundledPath = projectRoot.appendingPathComponent("sidecar.js")
        if FileManager.default.fileExists(atPath: bundledPath.path) {
            return (bundledPath, true)
        }

        // Source entry (development)
        let servePath = projectRoot
            .appendingPathComponent("packages")
            .appendingPathComponent("opencode")
            .appendingPathComponent("src")
            .appendingPathComponent("desktop-serve.ts")

        if FileManager.default.fileExists(atPath: servePath.path) {
            return (servePath, false)
        }
        return nil
    }

    private func findCoreEntry() -> (URL, Bool)? {
        let corePath = projectRoot
            .appendingPathComponent("packages")
            .appendingPathComponent("opencode")
            .appendingPathComponent("src")
            .appendingPathComponent("index.ts")

        if FileManager.default.fileExists(atPath: corePath.path) {
            return (corePath, false)
        }

        return nil
    }

    private func createSidecarEnv() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["NODE_PATH"] = projectRoot.appendingPathComponent("node_modules").path
        env["YUNPAT_CLIENT"] = "desktop"
        env["YUNPAT_EXPERIMENTAL_ICON_DISCOVERY"] = "true"
        env["YUNPAT_EXPERIMENTAL_FILEWATCHER"] = "true"
        env["OPENCODE_CLIENT"] = "desktop"
        env["OPENCODE_EXPERIMENTAL_ICON_DISCOVERY"] = "true"
        env["OPENCODE_EXPERIMENTAL_HTTPAPI"] = "false"
        env["OPENCODE_EXPERIMENTAL_FILEWATCHER"] = "true"
        env.removeValue(forKey: "DEBUG")
        return env
    }

    // MARK: - Health Monitoring

    private func startHealthMonitor() {
        stopHealthMonitor()
        consecutiveFailures = 0
        restartCount = 0

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.healthTimer = Timer.scheduledTimer(withTimeInterval: self.healthInterval, repeats: true) { [weak self] _ in
                self?.performHealthCheck()
            }
        }
    }

    private func stopHealthMonitor() {
        DispatchQueue.main.async { [weak self] in
            self?.healthTimer?.invalidate()
            self?.healthTimer = nil
        }
    }

    private func performHealthCheck() {
        guard let process, process.isRunning else {
            handleProcessDeath()
            return
        }

        guard let url = URL(string: "\(serverURL)/global/health") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 5

        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            guard let self else { return }
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                self.consecutiveFailures = 0
            } else {
                self.consecutiveFailures += 1
                if self.consecutiveFailures >= self.maxConsecutiveFailures {
                    self.handleProcessDeath()
                }
            }
        }.resume()
    }

    private func handleProcessDeath() {
        stopHealthMonitor()
        let detail = readStderrTail()
        let error = SidecarError.processExited(
            code: process?.terminationStatus ?? -1,
            detail: detail
        )
        self.process = nil
        self.stderrPipe = nil
        onProcessDied?(error)
    }

    // MARK: - Health Check

    private func waitForHealthCheck(completion: @escaping (Result<ServerInfo, Error>) -> Void) {
        let startTime = Date()
        let healthURL = URL(string: "\(serverURL)/global/health")!

        func check() {
            guard let process = process, process.isRunning else {
                completion(.failure(SidecarError.processExited(
                    code: process?.terminationStatus ?? -1,
                    detail: readStderrTail()
                )))
                return
            }

            if Date().timeIntervalSince(startTime) > startupTimeout {
                completion(.failure(SidecarError.startupTimeout))
                return
            }

            var request = URLRequest(url: healthURL)
            request.httpMethod = "GET"
            request.timeoutInterval = 3

            URLSession.shared.dataTask(with: request) { _, response, _ in
                if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                    print("SidecarManager: core engine ready at \(self.serverURL)")
                    self.startHealthMonitor()
                    completion(.success(ServerInfo(url: self.serverURL, port: self.port)))
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { check() }
                }
            }.resume()
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { check() }
    }

    // MARK: - Port Discovery

    private func findAvailablePort() -> Int? {
        let sock = socket(AF_INET, SOCK_STREAM, 0)
        guard sock != -1 else { return nil }
        defer { close(sock) }

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr = in_addr(s_addr: INADDR_ANY)

        let bindResult = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(sock, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else { return nil }

        var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
        let addrResult = withUnsafeMutablePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(sock, $0, &addrLen)
            }
        }
        guard addrResult == 0 else { return nil }

        return Int(CFSwapInt16BigToHost(addr.sin_port))
    }
}
