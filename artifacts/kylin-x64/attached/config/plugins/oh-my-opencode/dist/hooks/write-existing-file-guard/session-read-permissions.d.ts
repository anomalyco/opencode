export declare function touchSession(sessionLastAccess: Map<string, number>, sessionID: string): void;
export declare function evictLeastRecentlyUsedSession(readPermissionsBySession: Map<string, Set<string>>, sessionLastAccess: Map<string, number>): void;
export declare function trimSessionReadSet(readSet: Set<string>, maxTrackedPathsPerSession: number): void;
