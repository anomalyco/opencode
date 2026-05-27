import Foundation
import Sparkle

final class AutoUpdater {
    private let updaterController: SPUStandardUpdaterController

    var updater: SPUUpdater { updaterController.updater }

    init() {
        updaterController = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )
    }

    func checkForUpdates() {
        updater.checkForUpdates()
    }
}
