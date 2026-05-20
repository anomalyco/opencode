import type { BackgroundTask } from "../../features/background-agent";
import type { BackgroundOutputClient } from "./clients";
export declare function formatTaskResult(task: BackgroundTask, client: BackgroundOutputClient): Promise<string>;
