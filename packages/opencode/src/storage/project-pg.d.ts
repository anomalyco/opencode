export declare function createProjectSimple(input: {
    name: string;
    tenantUserId: string;
}): Promise<{
    project: {
        id: any;
        name: string | undefined;
        icon: {
            url: string | undefined;
            color: string | undefined;
        } | undefined;
        time: {
            created: number;
            updated: number;
            initialized: number | undefined;
        };
        commands: {} | undefined;
    };
}>;
export declare function listProjectsSimple(tenantUserId?: string): Promise<{
    id: any;
    name: string | undefined;
    icon: {
        url: string | undefined;
        color: string | undefined;
    } | undefined;
    time: {
        created: number;
        updated: number;
        initialized: number | undefined;
    };
    commands: {} | undefined;
}[]>;
