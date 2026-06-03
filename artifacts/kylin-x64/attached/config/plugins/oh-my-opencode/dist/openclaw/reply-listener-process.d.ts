export declare const REPLY_LISTENER_DAEMON_IDENTITY_MARKER = "--openclaw-reply-listener-daemon";
export declare function createReplyListenerDaemonEnv(extraEnv: Record<string, string>): Record<string, string>;
export declare function isReplyListenerProcessRunning(pid: number): boolean;
export declare function isReplyListenerDaemonProcess(pid: number): Promise<boolean>;
