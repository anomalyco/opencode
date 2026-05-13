import z from "zod";
import { SessionTable } from "@/storage/schema";
import { SessionID } from "./schema";
import { PermissionNext } from "@/permission/next";
export declare namespace Session {
    export function isDefaultTitle(title: string): boolean;
    type SessionRow = typeof SessionTable.$inferSelect;
    export function fromRow(row: SessionRow): Info;
    export function toRow(info: Info): {
        id: any;
        project_id: any;
        workspace_id: null;
        parent_id: any;
        slug: string;
        title: string;
        version: string;
        share_url: string | undefined;
        summary_additions: number | undefined;
        summary_deletions: number | undefined;
        summary_files: number | undefined;
        summary_diffs: any;
        revert: {
            [x: string]: any;
            snapshot?: string | undefined;
            diff?: string | undefined;
        } | null;
        permission: any;
        time_created: number;
        time_updated: number;
        time_compacting: number | undefined;
        time_archived: number | undefined;
    };
    export const Info: z.ZodObject<{
        id: any;
        slug: z.ZodString;
        projectID: any;
        parentID: any;
        summary: z.ZodOptional<z.ZodObject<{
            additions: z.ZodNumber;
            deletions: z.ZodNumber;
            files: z.ZodNumber;
            diffs: any;
        }, z.core.$strip>>;
        share: z.ZodOptional<z.ZodObject<{
            url: z.ZodString;
        }, z.core.$strip>>;
        title: z.ZodString;
        version: z.ZodString;
        time: z.ZodObject<{
            created: z.ZodNumber;
            updated: z.ZodNumber;
            compacting: z.ZodOptional<z.ZodNumber>;
            archived: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
        permission: any;
        revert: z.ZodOptional<z.ZodObject<{
            messageID: any;
            partID: any;
            snapshot: z.ZodOptional<z.ZodString>;
            diff: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    export type Info = z.output<typeof Info>;
    export const ProjectInfo: z.ZodObject<{
        id: any;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    export type ProjectInfo = z.output<typeof ProjectInfo>;
    export const GlobalInfo: z.ZodObject<{
        id: any;
        slug: z.ZodString;
        projectID: any;
        parentID: any;
        summary: z.ZodOptional<z.ZodObject<{
            additions: z.ZodNumber;
            deletions: z.ZodNumber;
            files: z.ZodNumber;
            diffs: any;
        }, z.core.$strip>>;
        share: z.ZodOptional<z.ZodObject<{
            url: z.ZodString;
        }, z.core.$strip>>;
        title: z.ZodString;
        version: z.ZodString;
        time: z.ZodObject<{
            created: z.ZodNumber;
            updated: z.ZodNumber;
            compacting: z.ZodOptional<z.ZodNumber>;
            archived: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
        permission: any;
        revert: z.ZodOptional<z.ZodObject<{
            messageID: any;
            partID: any;
            snapshot: z.ZodOptional<z.ZodString>;
            diff: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        project: z.ZodNullable<z.ZodObject<{
            id: any;
            name: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    export type GlobalInfo = z.output<typeof GlobalInfo>;
    export const Event: {
        Created: any;
        Updated: any;
        Deleted: any;
        Diff: any;
        Error: any;
        PyodideRequest: any;
    };
    export const create: any;
    export const fork: any;
    export const touch: any;
    export function createNext(input: {
        id?: SessionID;
        title?: string;
        parentID?: SessionID;
        permission?: PermissionNext.Ruleset;
    }): Promise<{
        [x: string]: any;
        slug: string;
        summary?: {
            [x: string]: any;
            additions: number;
            deletions: number;
            files: number;
        } | undefined;
        share?: {
            url: string;
        } | undefined;
        title: string;
        version: string;
        time: {
            created: number;
            updated: number;
            compacting?: number | undefined;
            archived?: number | undefined;
        };
        revert?: {
            [x: string]: any;
            snapshot?: string | undefined;
            diff?: string | undefined;
        } | undefined;
    }>;
    export function plan(input: {
        slug: string;
        time: {
            created: number;
        };
    }): string;
    export const get: any;
    export const share: any;
    export const unshare: any;
    export const setTitle: any;
    export const setArchived: any;
    export const setPermission: any;
    export const setRevert: any;
    export const clearRevert: any;
    export const setSummary: any;
    export const diff: any;
    export const messages: any;
    export function list(input?: {
        roots?: boolean;
        start?: number;
        search?: string;
        limit?: number;
    }): AsyncGenerator<{
        [x: string]: any;
        slug: string;
        summary?: {
            [x: string]: any;
            additions: number;
            deletions: number;
            files: number;
        } | undefined;
        share?: {
            url: string;
        } | undefined;
        title: string;
        version: string;
        time: {
            created: number;
            updated: number;
            compacting?: number | undefined;
            archived?: number | undefined;
        };
        revert?: {
            [x: string]: any;
            snapshot?: string | undefined;
            diff?: string | undefined;
        } | undefined;
    }, void, unknown>;
    export function listGlobal(input?: {
        roots?: boolean;
        start?: number;
        cursor?: number;
        search?: string;
        limit?: number;
        archived?: boolean;
    }): AsyncGenerator<{
        slug: string;
        summary?: {
            [x: string]: any;
            additions: number;
            deletions: number;
            files: number;
        } | undefined;
        share?: {
            url: string;
        } | undefined;
        title: string;
        version: string;
        time: {
            created: number;
            updated: number;
            compacting?: number | undefined;
            archived?: number | undefined;
        };
        revert?: {
            [x: string]: any;
            snapshot?: string | undefined;
            diff?: string | undefined;
        } | undefined;
        project: {
            [x: string]: any;
            name?: string | undefined;
        } | null;
    }, void, unknown>;
    export const children: any;
    export const remove: any;
    export const updateMessage: any;
    export const removeMessage: any;
    export const removePart: any;
    export const updatePart: any;
    export const updatePartDelta: any;
    export const getUsage: any;
    export class BusyError extends Error {
        readonly sessionID: string;
        constructor(sessionID: string);
    }
    export const initialize: any;
    export {};
}
