import z from "zod";
import { ProjectTable } from "@/storage/schema";
import { ProjectID } from "./schema";
export declare namespace Project {
    export const Info: z.ZodObject<{
        id: any;
        name: z.ZodOptional<z.ZodString>;
        icon: z.ZodOptional<z.ZodObject<{
            url: z.ZodOptional<z.ZodString>;
            override: z.ZodOptional<z.ZodString>;
            color: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        commands: z.ZodOptional<z.ZodObject<{
            start: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        time: z.ZodObject<{
            created: z.ZodNumber;
            updated: z.ZodNumber;
            initialized: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
        vcs: z.ZodOptional<z.ZodLiteral<"git">>;
    }, z.core.$strip>;
    export type Info = z.infer<typeof Info>;
    export const Event: {
        Updated: any;
    };
    type Row = typeof ProjectTable.$inferSelect;
    export function fromRow(row: Row): Info;
    export function setInitialized(id: ProjectID): Promise<void>;
    export function list(): Promise<{
        [x: string]: any;
        name?: string | undefined;
        icon?: {
            url?: string | undefined;
            override?: string | undefined;
            color?: string | undefined;
        } | undefined;
        commands?: {
            start?: string | undefined;
        } | undefined;
        time: {
            created: number;
            updated: number;
            initialized?: number | undefined;
        };
        vcs?: "git" | undefined;
    }[]>;
    export function createSimple(input: {
        name: string;
        tenantUserId: string;
    }): Promise<{
        project: {
            [x: string]: any;
            name?: string | undefined;
            icon?: {
                url?: string | undefined;
                override?: string | undefined;
                color?: string | undefined;
            } | undefined;
            commands?: {
                start?: string | undefined;
            } | undefined;
            time: {
                created: number;
                updated: number;
                initialized?: number | undefined;
            };
            vcs?: "git" | undefined;
        };
        directory: string;
    }>;
    /** Host-backed project: primary key is the resolved workspace path (see `Instance.workspace`). */
    export function createForDirectory(input: {
        workspace: string;
        name: string;
        tenantUserId: string;
    }): Promise<{
        project: {
            [x: string]: any;
            name?: string | undefined;
            icon?: {
                url?: string | undefined;
                override?: string | undefined;
                color?: string | undefined;
            } | undefined;
            commands?: {
                start?: string | undefined;
            } | undefined;
            time: {
                created: number;
                updated: number;
                initialized?: number | undefined;
            };
            vcs?: "git" | undefined;
        };
    }>;
    export function get(id: ProjectID): Promise<Info | undefined>;
    export const update: {
        (input: {
            [x: string]: any;
            name?: string | undefined;
            icon?: {
                url?: string | undefined;
                override?: string | undefined;
                color?: string | undefined;
            } | undefined;
            commands?: {
                start?: string | undefined;
            } | undefined;
        }): Promise<{
            [x: string]: any;
            name?: string | undefined;
            icon?: {
                url?: string | undefined;
                override?: string | undefined;
                color?: string | undefined;
            } | undefined;
            commands?: {
                start?: string | undefined;
            } | undefined;
            time: {
                created: number;
                updated: number;
                initialized?: number | undefined;
            };
            vcs?: "git" | undefined;
        }>;
        force: (input: {
            [x: string]: any;
            name?: string | undefined;
            icon?: {
                url?: string | undefined;
                override?: string | undefined;
                color?: string | undefined;
            } | undefined;
            commands?: {
                start?: string | undefined;
            } | undefined;
        }) => Promise<{
            [x: string]: any;
            name?: string | undefined;
            icon?: {
                url?: string | undefined;
                override?: string | undefined;
                color?: string | undefined;
            } | undefined;
            commands?: {
                start?: string | undefined;
            } | undefined;
            time: {
                created: number;
                updated: number;
                initialized?: number | undefined;
            };
            vcs?: "git" | undefined;
        }>;
        schema: z.ZodObject<{
            projectID: any;
            name: z.ZodOptional<z.ZodString>;
            icon: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                url: z.ZodOptional<z.ZodString>;
                override: z.ZodOptional<z.ZodString>;
                color: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>>;
            commands: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                start: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>>;
        }, z.core.$strip>;
    };
    export {};
}
