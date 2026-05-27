import Foundation
import UserNotifications

enum NotificationLevel: String, Codable {
    case info
    case success
    case warning
    case error
}

final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationManager()

    private override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
        registerCategories()
    }

    func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func send(level: NotificationLevel, title: String, body: String? = nil, action: String? = nil) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.categoryIdentifier = level.rawValue

        if let body { content.body = body }
        if let action { content.userInfo["action"] = action }

        switch level {
        case .info:
            content.sound = .default
        case .success:
            content.sound = .default
        case .warning:
            content.sound = .defaultCritical
        case .error:
            content.sound = .defaultCritical
        }

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    func sendProgress(title: String, step: Int, totalSteps: Int, currentStep: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = "步骤 \(step)/\(totalSteps): \(currentStep)"
        content.categoryIdentifier = NotificationLevel.info.rawValue
        content.sound = nil

        let request = UNNotificationRequest(
            identifier: "yunpat-progress",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    // Show notification even when app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    private func registerCategories() {
        let viewAction = UNNotificationAction(
            identifier: "VIEW_ACTION",
            title: "查看",
            options: .foreground
        )
        let dismissAction = UNNotificationAction(
            identifier: "DISMISS_ACTION",
            title: "关闭",
            options: []
        )

        var categories = Set<UNNotificationCategory>()
        for level in [NotificationLevel.info, .success, .warning, .error] {
            let category = UNNotificationCategory(
                identifier: level.rawValue,
                actions: [viewAction, dismissAction],
                intentIdentifiers: [],
                options: .customDismissAction
            )
            categories.insert(category)
        }
        UNUserNotificationCenter.current().setNotificationCategories(categories)
    }
}
