import SwiftUI

@main
struct YunPatApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var mainWindow: NSWindow?
    var sidecarManager: SidecarManager?
    var ipcBridge: IPCBridge?
    var autoUpdater: AutoUpdater?
    var socketServer: SocketServer?
    let windowState = WindowState.shared
    private var sidecarRestartCount = 0
    private let maxSidecarRestarts = 3

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Setup auto-updater
        let updater = AutoUpdater()
        self.autoUpdater = updater

        // Setup menu bar
        let appMenu = AppMenu(autoUpdater: updater)
        NSApp.mainMenu = appMenu.build()

        // Request notification authorization
        NotificationManager.shared.requestAuthorization()

        // Start socket server
        let socket = SocketServer()
        self.socketServer = socket
        socket.start()

        let window = createMainWindow()
        self.mainWindow = window
        self.ipcBridge = IPCBridge()

        let manager = SidecarManager()
        self.sidecarManager = manager
        manager.onProcessDied = { [weak self] error in
            self?.handleSidecarDeath(error: error)
        }

        manager.start { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let serverInfo):
                    self?.windowState.state.lastServerURL = serverInfo.url
                    self?.loadWebView(in: window, serverURL: serverInfo.url)
                case .failure(let error):
                    self?.showErrorAndQuit(error.localizedDescription)
                }
            }
        }

        if !window.setFrameUsingName("YunPatMainWindow") {
            window.center()
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationWillTerminate(_ notification: Notification) {
        mainWindow?.saveFrame(usingName: "YunPatMainWindow")
        windowState.save()
        socketServer?.stop()
        sidecarManager?.stop()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            mainWindow?.makeKeyAndOrderFront(nil)
        }
        return true
    }

    private func createMainWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "云熙智能体"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 800, height: 600)
        window.setFrameAutosaveName("YunPatMainWindow")
        return window
    }

    private func loadWebView(in window: NSWindow, serverURL: String) {
        let webView = ipcBridge!.createWebView(serverURL: serverURL)
        window.contentView = webView
    }

    private func showErrorAndQuit(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "启动失败"
        alert.informativeText = message
        alert.alertStyle = .critical
        alert.addButton(withTitle: "退出")
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func handleSidecarDeath(error: Error) {
        guard sidecarRestartCount < maxSidecarRestarts else {
            DispatchQueue.main.async {
                self.showErrorAndQuit("核心引擎多次崩溃，无法自动恢复。\n\(error.localizedDescription)")
            }
            return
        }

        sidecarRestartCount += 1
        let delaySeconds = min(pow(2.0, Double(sidecarRestartCount)), 30.0)
        print("AppDelegate: sidecar died (restart \(sidecarRestartCount)/\(maxSidecarRestarts)), retrying in \(delaySeconds)s")

        DispatchQueue.main.asyncAfter(deadline: .now() + delaySeconds) { [weak self] in
            guard let self, let manager = self.sidecarManager else { return }
            manager.start { [weak self] result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let serverInfo):
                        self?.sidecarRestartCount = 0
                        self?.windowState.state.lastServerURL = serverInfo.url
                        if let window = self?.mainWindow {
                            self?.loadWebView(in: window, serverURL: serverInfo.url)
                        }
                    case .failure:
                        // Will trigger another onProcessDied or show error on next attempt
                        break
                    }
                }
            }
        }
    }
}
