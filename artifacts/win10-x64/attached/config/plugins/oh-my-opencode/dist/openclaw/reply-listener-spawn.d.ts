export interface ReplyListenerSpawnProcess {
    pid: number | undefined;
    unref(): void;
}
export declare function spawnReplyListenerDaemon(daemonScript: string, startupToken: string): ReplyListenerSpawnProcess;
