import Foundation

struct PanelWidths: Codable {
    var sidebar: Double
    var fileTree: Double
    var session: Double
}

struct AppState: Codable {
    var lastServerURL: String?
    var activeSessionId: String?
    var panelWidths: PanelWidths?

    static let storageKey = "com.yunpat.appstate"
}

final class WindowState {
    static let shared = WindowState()

    private let defaults = UserDefaults.standard
    private let queue = DispatchQueue(label: "com.yunpat.windowstate", qos: .utility)
    private var _state: AppState

    var state: AppState {
        get { queue.sync { _state } }
        set {
            queue.sync {
                _state = newValue
                save()
            }
        }
    }

    init() {
        if let data = defaults.data(forKey: AppState.storageKey),
           let decoded = try? JSONDecoder().decode(AppState.self, from: data) {
            _state = decoded
        } else {
            _state = AppState()
        }
    }

    func save() {
        if let data = try? JSONEncoder().encode(_state) {
            defaults.set(data, forKey: AppState.storageKey)
        }
    }
}
