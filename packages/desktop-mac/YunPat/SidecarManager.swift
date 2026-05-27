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

    /// Project root directory (contains packages/opencode)
    private let projectRoot: URL

    init(projectRoot: URL? = nil) {
        self.projectRoot = projectRoot ?? SidecarManager.findProjectRoot()
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

        guard findServeEntry() != nil || findCoreEntry() != nil else {
            print("SidecarManager: serve entry missing under projectRoot \(projectRoot.path)")
            completion(.failure(SidecarError.coreNotFound))
            return
        }

        // Ensure plugin re-export files exist for engine discovery
        ensurePluginsAvailable()

        print("SidecarManager: starting core engine")
        print("  bun: \(bunPath.path)")
        let entry = findServeEntry() ?? findCoreEntry()!
        print("  entry: \(entry.path)")
        print("  port: \(port)")

        let proc = Process()
        proc.executableURL = bunPath
        proc.arguments = ["run", "--conditions=browser", entry.path, "serve", "--port", "\(port)"]
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
        guard let process = process, process.isRunning else { return }

        process.terminate()

        let deadline = Date().addingTimeInterval(stopTimeout)
        while process.isRunning && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }

        if process.isRunning {
            process.interrupt()
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
        let pluginDir = projectRoot.appendingPathComponent(".opencode/plugin")
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
        // Development mode: relative to build output
        let buildDir = Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()

        // Check if this looks like the monorepo root
        let check = buildDir.appendingPathComponent("packages/opencode/package.json")
        if FileManager.default.fileExists(atPath: check.path) {
            return buildDir
        }

        // Production: look for embedded project root
        if let resourcePath = Bundle.main.resourcePath {
            let embedded = URL(fileURLWithPath: resourcePath).appendingPathComponent("project-root")
            if FileManager.default.fileExists(atPath: embedded.appendingPathComponent("packages/opencode/package.json").path) {
                return embedded
            }
        }

        // Fallback: use current working directory
        return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
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

    private func findServeEntry() -> URL? {
        let servePath = projectRoot
            .appendingPathComponent("packages")
            .appendingPathComponent("opencode")
            .appendingPathComponent("src")
            .appendingPathComponent("desktop-serve.ts")

        if FileManager.default.fileExists(atPath: servePath.path) {
            return servePath
        }
        return nil
    }

    private func findCoreEntry() -> URL? {
        let corePath = projectRoot
            .appendingPathComponent("packages")
            .appendingPathComponent("opencode")
            .appendingPathComponent("src")
            .appendingPathComponent("index.ts")

        if FileManager.default.fileExists(atPath: corePath.path) {
            return corePath
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
        env["OPENCODE_EXPERIMENTAL_FILEWATCHER"] = "true"
        env.removeValue(forKey: "DEBUG")
        return env
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
