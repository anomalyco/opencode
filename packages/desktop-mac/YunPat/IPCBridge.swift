import Foundation
import WebKit
import UserNotifications

class IPCBridge: NSObject, WKScriptMessageHandler {
    private var webView: WKWebView?
    private var userContentController: WKUserContentController?

    deinit {
        userContentController?.removeAllScriptMessageHandlers()
    }

    func dispatchToWebView(_ js: String) {
        webView?.evaluateJavaScript(js)
    }

    func createWebView(serverURL: String) -> WKWebView {
        let config = WKWebViewConfiguration()
        let controller = config.userContentController
        self.userContentController = controller

        // Use single unified handler for all messages
        controller.add(self, name: "yunpat")

        // Inject server URL and native bridge marker
        let escapedServerURL = serverURL
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let script = WKUserScript(
            source: """
            window.__YUNPAT_NATIVE__ = true;
            window.__YUNPAT_SERVER_URL__ = "\(escapedServerURL)";
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        controller.addUserScript(script)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.customUserAgent = "YunPat/1.0"

        self.webView = webView
        loadContent(into: webView)
        return webView
    }

    private func loadContent(into webView: WKWebView) {
        // Development mode: load from vite dev server
        if let devURL = ProcessInfo.processInfo.environment["ELECTRON_RENDERER_URL"],
           let url = URL(string: devURL) {
            webView.load(URLRequest(url: url))
            return
        }

        // Production mode: load from app bundle
        if let resourcePath = Bundle.main.resourcePath {
            let htmlPath = "\(resourcePath)/renderer/index.html"
            if FileManager.default.fileExists(atPath: htmlPath) {
                let url = URL(fileURLWithPath: htmlPath)
                webView.loadFileURL(url, allowingReadAccessTo: URL(fileURLWithPath: resourcePath))
                return
            }
        }

        // Fallback: load from development build
        let devPath = (Bundle.main.bundleURL.deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("packages/app/dist/index.html")).path
        if FileManager.default.fileExists(atPath: devPath) {
            webView.loadFileURL(URL(fileURLWithPath: devPath),
                                allowingReadAccessTo: URL(fileURLWithPath: devPath).deletingLastPathComponent())
        }
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        guard message.name == "yunpat" else { return }

        // Unified message handler: { callId, method, args }
        guard let body = message.body as? [String: Any],
              let method = body["method"] as? String,
              let callId = body["callId"] as? Int else { return }

        let args = body["args"] as? [Any] ?? []

        // Fire-and-forget methods
        if method == "openLink" {
            if let url = args.first as? String, let nsurl = URL(string: url) {
                NSWorkspace.shared.open(nsurl)
            }
            return
        }
        if method == "relaunch" {
            let task = Process()
            task.executableURL = Bundle.main.executableURL
            task.arguments = []
            try? task.run()
            NSApp.terminate(nil)
            return
        }

        handleMethod(method: method, args: args) { [weak self] result in
            self?.sendResult(callId: callId, result: result)
        }
    }

    private func handleMethod(method: String, args: [Any], completion: @escaping (Result<Any?, Error>) -> Void) {
        switch method {
        case "openFilePicker":
            let result = showFilePicker(multiple: args.first as? Bool ?? false)
            completion(.success(result))
        case "openDirectoryPicker":
            let result = showDirectoryPicker(multiple: args.first as? Bool ?? false)
            completion(.success(result))
        case "saveFilePicker":
            let result = showSavePicker(defaultPath: args.first as? String)
            completion(.success(result))
        case "readClipboardImage":
            completion(.success(readClipboardImage()))
        case "storeGet":
            let name = args[0] as? String ?? ""
            let key = args[1] as? String ?? ""
            completion(.success(storeGet(name: name, key: key)))
        case "storeSet":
            let name = args[0] as? String ?? ""
            let key = args[1] as? String ?? ""
            let value = args[2] as? String ?? ""
            storeSet(name: name, key: key, value: value)
            completion(.success(nil))
        case "storeDelete":
            let name = args[0] as? String ?? ""
            let key = args[1] as? String ?? ""
            storeDelete(name: name, key: key)
            completion(.success(nil))
        case "storeClear":
            let name = args[0] as? String ?? ""
            storeClear(name: name)
            completion(.success(nil))
        case "storeKeys":
            let name = args[0] as? String ?? ""
            completion(.success(storeKeys(name: name)))
        case "storeLength":
            let name = args[0] as? String ?? ""
            completion(.success(storeLength(name: name)))
        case "killSidecar":
            completion(.success(nil))
        case "getDefaultServerUrl":
            completion(.success(nil))
        case "setDefaultServerUrl":
            completion(.success(nil))
        case "getWindowFocused":
            completion(.success(NSApp.keyWindow?.isKeyWindow ?? false))
        case "setWindowFocus":
            NSApp.keyWindow?.makeKey()
            completion(.success(nil))
        case "showWindow":
            NSApp.keyWindow?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            completion(.success(nil))
        case "getZoomFactor":
            completion(.success(1.0))
        case "setZoomFactor":
            completion(.success(nil))
        case "showNotification":
            let title = args[0] as? String ?? "YunPat"
            let body = args[1] as? String
            let levelStr = args[2] as? String
            let level = levelStr.flatMap(NotificationLevel.init) ?? .info
            let action = args[3] as? String
            NotificationManager.shared.send(level: level, title: title, body: body, action: action)
            completion(.success(nil))
        case "showProgressNotification":
            let title = args[0] as? String ?? "YunPat"
            let step = args[1] as? Int ?? 0
            let total = args[2] as? Int ?? 0
            let currentStep = args[3] as? String ?? ""
            NotificationManager.shared.sendProgress(title: title, step: step, totalSteps: total, currentStep: currentStep)
            completion(.success(nil))
        case "getAppState":
            let state = WindowState.shared.state
            if let data = try? JSONEncoder().encode(state) {
                completion(.success(String(data: data, encoding: .utf8)))
            } else {
                completion(.success(nil))
            }
        case "saveAppState":
            if let json = args.first as? String,
               let data = json.data(using: .utf8),
               let partial = try? JSONDecoder().decode(AppState.self, from: data) {
                let current = WindowState.shared.state
                let updated = AppState(
                    lastServerURL: partial.lastServerURL ?? current.lastServerURL,
                    activeSessionId: partial.activeSessionId ?? current.activeSessionId,
                    panelWidths: partial.panelWidths ?? current.panelWidths
                )
                WindowState.shared.state = updated
            }
            completion(.success(nil))
        default:
            completion(.success(nil))
        }
    }

    // MARK: - JS Communication

    private func sendResult(callId: Int, result: Result<Any?, Error>) {
        guard let webView = webView else { return }
        switch result {
        case .success(let value):
            // Use JSONSerialization for safe JS encoding
            let payload: [String: Any] = ["callId": callId, "result": value ?? NSNull()]
            if let jsonData = try? JSONSerialization.data(withJSONObject: payload, options: []),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                let escaped = jsonString
                    .replacingOccurrences(of: "\\", with: "\\\\")
                    .replacingOccurrences(of: "'", with: "\\'")
                    .replacingOccurrences(of: "\n", with: "\\n")
                    .replacingOccurrences(of: "\r", with: "\\r")
                let js = "document.dispatchEvent(new CustomEvent('yunpat-event',{detail:{type:'resolve',data:\(escaped)}}))"
                webView.evaluateJavaScript(js)
            }
        case .failure(let error):
            let escaped = error.localizedDescription
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
            let js = "document.dispatchEvent(new CustomEvent('yunpat-event',{detail:{type:'reject',data:{callId:\(callId),error:'\(escaped)'}}})"
            webView.evaluateJavaScript(js)
        }
    }

    // MARK: - Native Capabilities

    private func showFilePicker(multiple: Bool) -> String? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = multiple
        guard panel.runModal() == .OK, !panel.urls.isEmpty else { return nil }
        return multiple ? panel.urls.map { $0.path }.joined(separator: ":") : panel.urls.first?.path
    }

    private func showDirectoryPicker(multiple: Bool) -> String? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = multiple
        guard panel.runModal() == .OK, !panel.urls.isEmpty else { return nil }
        return multiple ? panel.urls.map { $0.path }.joined(separator: ":") : panel.urls.first?.path
    }

    private func showSavePicker(defaultPath: String?) -> String? {
        let panel = NSSavePanel()
        if let path = defaultPath { panel.directoryURL = URL(fileURLWithPath: path) }
        guard panel.runModal() == .OK else { return nil }
        return panel.url?.path
    }

    private func readClipboardImage() -> [String: Any]? {
        guard let image = NSPasteboard.general.data(forType: .png) else { return nil }
        return ["data": image.base64EncodedString(), "type": "png"]
    }

    // MARK: - UserDefaults Store

    private func storeKey(name: String, key: String) -> String {
        return "yunpat:\(name):\(key)"
    }

    private func storeGet(name: String, key: String) -> String? {
        return UserDefaults.standard.string(forKey: storeKey(name: name, key: key))
    }

    private func storeSet(name: String, key: String, value: String) {
        UserDefaults.standard.set(value, forKey: storeKey(name: name, key: key))
    }

    private func storeDelete(name: String, key: String) {
        UserDefaults.standard.removeObject(forKey: storeKey(name: name, key: key))
    }

    private func storeClear(name: String) {
        let prefix = "yunpat:\(name):"
        for key in UserDefaults.standard.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }

    private func storeKeys(name: String) -> [String] {
        let prefix = "yunpat:\(name):"
        return UserDefaults.standard.dictionaryRepresentation().keys
            .filter { $0.hasPrefix(prefix) }
            .map { String($0.dropFirst(prefix.count)) }
    }

    private func storeLength(name: String) -> Int {
        return storeKeys(name: name).count
    }
}
