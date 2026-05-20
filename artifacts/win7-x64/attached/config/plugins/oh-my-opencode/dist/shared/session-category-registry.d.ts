export declare const SessionCategoryRegistry: {
    register: (sessionID: string, category: string) => void;
    get: (sessionID: string) => string | undefined;
    remove: (sessionID: string) => void;
    has: (sessionID: string) => boolean;
    size: () => number;
    clear: () => void;
};
