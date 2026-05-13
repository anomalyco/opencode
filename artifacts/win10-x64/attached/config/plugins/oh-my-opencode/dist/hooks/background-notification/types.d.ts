import type { BackgroundTask } from "../../features/background-agent";
export interface BackgroundNotificationHookConfig {
    formatNotification?: (tasks: BackgroundTask[]) => string;
}
