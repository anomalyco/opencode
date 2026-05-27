import AppKit
import Darwin

final class SocketServer {
    private var serverSocket: Int32 = -1
    private var isRunning = false
    private let socketPath: String
    private let maxConnections: Int32 = 5
    private let socketBufferSize = 4096

    struct Command: Decodable {
        let cmd: String
        let session: String?
        let title: String?
        let body: String?
        let level: String?
    }

    init(path: String? = nil) {
        // Use app-specific socket path to avoid permission issues
        if let path {
            self.socketPath = path
        } else {
            let tmpDir = NSTemporaryDirectory()
            self.socketPath = tmpDir.appending("yunpat-\(ProcessInfo.processInfo.processIdentifier).sock")
        }
    }

    func start() {
        unlink(socketPath)

        serverSocket = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverSocket != -1 else {
            print("SocketServer: failed to create socket")
            return
        }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        addr.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)

        // sun_path is a CChar array of 104 bytes on macOS
        let maxLen = 103
        guard socketPath.utf8.count < maxLen else {
            print("SocketServer: socket path too long")
            close(serverSocket)
            serverSocket = -1
            return
        }
        _ = socketPath.withCString { path in
            withUnsafeMutablePointer(to: &addr.sun_path.0) { dst in
                strncpy(dst, path, maxLen)
            }
        }

        let bindResult = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(serverSocket, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bindResult == 0 else {
            print("SocketServer: failed to bind")
            close(serverSocket)
            serverSocket = -1
            return
        }

        guard listen(serverSocket, maxConnections) == 0 else {
            print("SocketServer: failed to listen")
            close(serverSocket)
            serverSocket = -1
            return
        }

        isRunning = true
        DispatchQueue.global(qos: .utility).async { [weak self] in
            self?.acceptLoop()
        }

        print("SocketServer: listening on \(socketPath)")
    }

    func stop() {
        isRunning = false
        if serverSocket != -1 {
            shutdown(serverSocket, SHUT_RDWR)
            close(serverSocket)
            serverSocket = -1
        }
        unlink(socketPath)
    }

    private func acceptLoop() {
        // Set non-blocking on server socket so we can check isRunning periodically
        var flags = fcntl(serverSocket, F_GETFL, 0)
        flags |= O_NONBLOCK
        _ = fcntl(serverSocket, F_SETFL, flags)

        while isRunning {
            let clientSocket = accept(serverSocket, nil, nil)
            if clientSocket == -1 {
                // EAGAIN/EWOULDBLOCK means no pending connection
                Thread.sleep(forTimeInterval: 0.1)
                continue
            }

            DispatchQueue.global(qos: .utility).async { [weak self] in
                self?.handleClient(clientSocket)
            }
        }
    }

    private func handleClient(_ clientSocket: Int32) {
        defer { close(clientSocket) }

        // Set receive timeout to prevent hanging
        var timeout = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(clientSocket, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))

        var buffer = [UInt8](repeating: 0, count: socketBufferSize)
        let bytesRead = recv(clientSocket, &buffer, buffer.count, 0)
        guard bytesRead > 0 else { return }

        let data = Data(buffer[..<bytesRead])
        guard let jsonString = String(data: data, encoding: .utf8) else {
            sendResponse(clientSocket, ok: false, error: "invalid utf-8")
            return
        }

        guard let jsonData = jsonString.data(using: .utf8),
              let command = try? JSONDecoder().decode(Command.self, from: jsonData) else {
            sendResponse(clientSocket, ok: false, error: "invalid json, expected {\"cmd\": \"...\"}")
            return
        }

        let result = handleCommand(command)
        sendResponse(clientSocket, result: result)
    }

    private func handleCommand(_ cmd: Command) -> [String: Any] {
        switch cmd.cmd {
        case "version":
            let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
            return ["ok": true, "data": ["version": version, "name": "YunPat"]]

        case "status":
            let state = WindowState.shared.state
            return [
                "ok": true,
                "data": [
                    "running": true,
                    "activeSessionId": state.activeSessionId as Any,
                    "serverURL": state.lastServerURL as Any,
                ],
            ]

        case "notify":
            guard let levelStr = cmd.level, let level = NotificationLevel(rawValue: levelStr) else {
                return ["ok": false, "error": "invalid level, must be info/success/warning/error"]
            }
            NotificationManager.shared.send(
                level: level,
                title: cmd.title ?? "YunPat",
                body: cmd.body
            )
            return ["ok": true]

        case "open":
            if let session = cmd.session {
                let escaped = escapeJS(session)
                DispatchQueue.main.async {
                    if let appDelegate = NSApp.delegate as? AppDelegate,
                       let bridge = appDelegate.ipcBridge {
                        bridge.dispatchToWebView("window.__yunpat_socket_open && window.__yunpat_socket_open('\(escaped)')")
                    }
                }
                return ["ok": true, "data": ["sessionId": session]]
            }
            return ["ok": false, "error": "missing 'session' field"]

        case "ping":
            return ["ok": true, "data": "pong"]

        default:
            return ["ok": false, "error": "unknown command: \(cmd.cmd)"]
        }
    }

    // MARK: - Private Helpers

    private func escapeJS(_ str: String) -> String {
        str.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }

    private func sendResponse(_ clientSocket: Int32, result: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else { return }
        var msg = json
        msg.append("\n")
        _ = msg.withCString { ptr in
            send(clientSocket, ptr, msg.utf8.count, 0)
        }
    }

    private func sendResponse(_ clientSocket: Int32, ok: Bool, error: String) {
        sendResponse(clientSocket, result: ["ok": ok, "error": error])
    }
}
