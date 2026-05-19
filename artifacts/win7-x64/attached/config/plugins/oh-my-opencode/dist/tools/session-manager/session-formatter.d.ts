import type { SessionInfo, SessionMessage, SearchResult } from "./types";
export declare function formatSessionList(sessionIDs: string[]): Promise<string>;
export declare function formatSessionMessages(messages: SessionMessage[], includeTodos?: boolean, todos?: Array<{
    id?: string;
    content: string;
    status: string;
}>): string;
export declare function formatSessionInfo(info: SessionInfo): string;
export declare function formatSearchResults(results: SearchResult[]): string;
export declare function filterSessionsByDate(sessionIDs: string[], fromDate?: string, toDate?: string): Promise<string[]>;
export declare function searchInSession(sessionID: string, query: string, caseSensitive?: boolean, maxResults?: number): Promise<SearchResult[]>;
