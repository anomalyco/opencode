import { SerovalObjectFlags } from '../constants';
import type { PluginAccessOptions } from '../plugin';
import { SerovalMode } from '../plugin';
import type { SerovalNode } from '../types';
declare const enum AssignmentType {
    Index = 0,
    Add = 1,
    Set = 2,
    Delete = 3
}
interface IndexAssignment {
    t: AssignmentType.Index;
    s: string;
    k: undefined;
    v: string;
}
interface SetAssignment {
    t: AssignmentType.Set;
    s: string;
    k: string;
    v: string;
}
interface AddAssignment {
    t: AssignmentType.Add;
    s: string;
    k: undefined;
    v: string;
}
interface DeleteAssignment {
    t: AssignmentType.Delete;
    s: string;
    k: string;
    v: undefined;
}
type Assignment = IndexAssignment | AddAssignment | SetAssignment | DeleteAssignment;
export interface FlaggedObject {
    type: SerovalObjectFlags;
    value: string;
}
export interface BaseSerializerContextOptions extends PluginAccessOptions {
    features: number;
    markedRefs: number[] | Set<number>;
}
export interface BaseSerializerContext extends PluginAccessOptions {
    readonly mode: SerovalMode;
    features: number;
    stack: number[];
    /**
     * Array of object mutations
     */
    flags: FlaggedObject[];
    /**
     * Array of assignments to be done (used for recursion)
     */
    assignments: Assignment[];
    /**
     * Refs that are...referenced
     */
    marked: Set<number>;
}
export interface CrossContextOptions {
    scopeId?: string;
}
export declare function createBaseSerializerContext(mode: SerovalMode, options: BaseSerializerContextOptions): BaseSerializerContext;
export interface VanillaSerializerState {
    valid: Map<number, number>;
    vars: string[];
}
export interface VanillaSerializerContext {
    mode: SerovalMode.Vanilla;
    base: BaseSerializerContext;
    state: VanillaSerializerState;
    child: SerializePluginContext | undefined;
}
export type VanillaSerializerContextOptions = BaseSerializerContextOptions;
export declare function createVanillaSerializerContext(options: VanillaSerializerContextOptions): VanillaSerializerContext;
export interface CrossSerializerContext {
    mode: SerovalMode.Cross;
    base: BaseSerializerContext;
    state: CrossContextOptions;
    child: SerializePluginContext | undefined;
}
export interface CrossSerializerContextOptions extends BaseSerializerContextOptions, CrossContextOptions {
}
export declare function createCrossSerializerContext(options: CrossSerializerContextOptions): CrossSerializerContext;
type SerializerContext = VanillaSerializerContext | CrossSerializerContext;
export declare class SerializePluginContext {
    private _p;
    constructor(_p: SerializerContext);
    serialize(node: SerovalNode): string;
}
export declare function serializeRoot(ctx: SerializerContext, node: SerovalNode): string;
export declare function serializeTopVanilla(ctx: VanillaSerializerContext, tree: SerovalNode): string;
export declare function serializeTopCross(ctx: CrossSerializerContext, tree: SerovalNode): string;
export {};
//# sourceMappingURL=serializer.d.ts.map