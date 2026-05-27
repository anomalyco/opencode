import AppKit
import Foundation
import UniformTypeIdentifiers
import WebKit
import UserNotifications

class IPCBridge: NSObject, WKScriptMessageHandler {
    private var webView: WKWebView?
    private var userContentController: WKUserContentController?
    private var serverURL: String = ""

    deinit {
        userContentController?.removeAllScriptMessageHandlers()
    }

    func dispatchToWebView(_ js: String) {
        webView?.evaluateJavaScript(js)
    }

    func createWebView(serverURL: String) -> WKWebView {
        self.serverURL = serverURL

        let config = WKWebViewConfiguration()
        let controller = config.userContentController
        self.userContentController = controller

        controller.add(self, name: "yunpat")

        let escapedServerURL = serverURL
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\"", with: "\\\"")

        let script = WKUserScript(
            source: """
            window.__YUNPAT_NATIVE__ = {
              postMessage: function(payload) {
                var body = typeof payload === 'string' ? JSON.parse(payload) : payload;
                window.webkit.messageHandlers.yunpat.postMessage(body);
              }
            };
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
        if let devURL = ProcessInfo.processInfo.environment["ELECTRON_RENDERER_URL"],
           let url = URL(string: devURL) {
            webView.load(URLRequest(url: url))
            return
        }

        guard let resourcePath = Bundle.main.resourcePath else { return }
        let rendererDir = "\(resourcePath)/renderer"
        let rendererURL = URL(fileURLWithPath: rendererDir, isDirectory: true)

        let candidates = ["desktop-mac.html", "index.html"]
        for name in candidates {
            let htmlPath = "\(rendererDir)/\(name)"
            if FileManager.default.fileExists(atPath: htmlPath) {
                let url = URL(fileURLWithPath: htmlPath)
                webView.loadFileURL(url, allowingReadAccessTo: rendererURL)
                return
            }
        }

        let devPath = (Bundle.main.bundleURL.deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("packages/app/dist-desktop-mac/desktop-mac.html")).path
        if FileManager.default.fileExists(atPath: devPath) {
            let url = URL(fileURLWithPath: devPath)
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        guard message.name == "yunpat" else { return }
        guard let body = parseMessageBody(message.body),
              let method = body["method"] as? String else { return }

        let args = body["args"] as? [Any] ?? []

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
        if method == "showNotification" {
            let title = args[safe: 0] as? String ?? "YunPat"
            let bodyText = args[safe: 1] as? String
            let levelStr = args[safe: 2] as? String
            let level = levelStr.flatMap(NotificationLevel.init) ?? .info
            let action = args[safe: 3] as? String
            NotificationManager.shared.send(level: level, title: title, body: bodyText, action: action)
            return
        }
        if method == "showProgressNotification" {
            let title = args[safe: 0] as? String ?? "YunPat"
            let step = args[safe: 1] as? Int ?? 0
            let total = args[safe: 2] as? Int ?? 0
            let currentStep = args[safe: 3] as? String ?? ""
            NotificationManager.shared.sendProgress(title: title, step: step, totalSteps: total, currentStep: currentStep)
            return
        }

        guard let callId = body["callId"] as? Int else { return }

        handleMethod(method: method, args: args) { [weak self] result in
            self?.sendResult(callId: callId, result: result)
        }
    }

    private func parseMessageBody(_ body: Any) -> [String: Any]? {
        if let dict = body as? [String: Any] { return dict }
        if let str = body as? String,
           let data = str.data(using: .utf8),
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return dict
        }
        return nil
    }

    private func handleMethod(method: String, args: [Any], completion: @escaping (Result<Any?, Error>) -> Void) {
        switch method {
        case "awaitInitialization":
            completion(.success([
                "url": serverURL,
                "username": NSNull(),
                "password": NSNull(),
            ]))
        case "openFilePicker":
            let opts = pickerOptions(args)
            completion(.success(showFilePicker(multiple: opts.multiple, title: opts.title, extensions: opts.extensions)))
        case "openDirectoryPicker":
            let opts = pickerOptions(args)
            completion(.success(showDirectoryPicker(multiple: opts.multiple, title: opts.title)))
        case "saveFilePicker":
            let opts = savePickerOptions(args)
            completion(.success(showSavePicker(title: opts.title, defaultPath: opts.defaultPath)))
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
            completion(.success(UserDefaults.standard.string(forKey: "yunpat:lastServerURL")))
        case "setDefaultServerUrl":
            if let url = args.first as? String {
                UserDefaults.standard.set(url, forKey: "yunpat:lastServerURL")
            } else {
                UserDefaults.standard.removeObject(forKey: "yunpat:lastServerURL")
            }
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

    // MARK: - Picker options

    private struct PickerOpts {
        var multiple: Bool = false
        var title: String?
        var extensions: [String]?
    }

    private struct SaveOpts {
        var title: String?
        var defaultPath: String?
    }

    private func pickerOptions(_ args: [Any]) -> PickerOpts {
        if let dict = args.first as? [String: Any] {
            return PickerOpts(
                multiple: dict["multiple"] as? Bool ?? false,
                title: dict["title"] as? String,
                extensions: dict["extensions"] as? [String]
            )
        }
        return PickerOpts(multiple: args.first as? Bool ?? false)
    }

    private func savePickerOptions(_ args: [Any]) -> SaveOpts {
        if let dict = args.first as? [String: Any] {
            return SaveOpts(
                title: dict["title"] as? String,
                defaultPath: dict["defaultPath"] as? String
            )
        }
        return SaveOpts(defaultPath: args.first as? String)
    }

    // MARK: - Native Capabilities

    private func showFilePicker(multiple: Bool, title: String?, extensions: [String]?) -> String? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = multiple
        if let title { panel.title = title }
        if let extensions, !extensions.isEmpty {
            panel.allowedContentTypes = extensions.compactMap { ext in
                let normalized = ext.hasPrefix(".") ? String(ext.dropFirst()) : ext
                return UTType(filenameExtension: normalized)
            }
        }
        guard panel.runModal() == .OK, !panel.urls.isEmpty else { return nil }
        return multiple ? panel.urls.map { $0.path }.joined(separator: ":") : panel.urls.first?.path
    }

    private func showDirectoryPicker(multiple: Bool, title: String?) -> String? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = multiple
        if let title { panel.title = title }
        guard panel.runModal() == .OK, !panel.urls.isEmpty else { return nil }
        return multiple ? panel.urls.map { $0.path }.joined(separator: ":") : panel.urls.first?.path
    }

    private func showSavePicker(title: String?, defaultPath: String?) -> String? {
        let panel = NSSavePanel()
        if let title { panel.title = title }
        if let path = defaultPath {
            let url = URL(fileURLWithPath: path)
            panel.directoryURL = url.deletingLastPathComponent()
            panel.nameFieldStringValue = url.lastPathComponent
        }
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

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
