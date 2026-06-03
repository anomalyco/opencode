import { Feature } from '../compat';
import {
  CONSTANT_STRING,
  ERROR_CONSTRUCTOR_STRING,
  NIL,
  SerovalNodeType,
  SerovalObjectFlags,
  SYMBOL_STRING,
} from '../constants';
import {
  SERIALIZED_ASYNC_ITERATOR_CONSTRUCTOR,
  SERIALIZED_ITERATOR_CONSTRUCTOR,
} from '../constructors';
import {
  SerovalMissingPluginError,
  SerovalSerializationError,
  SerovalUnsupportedNodeError,
} from '../errors';
import { createEffectfulFunction, createFunction } from '../function-string';
import { GLOBAL_CONTEXT_REFERENCES, REFERENCES_KEY } from '../keys';
import type { PluginAccessOptions } from '../plugin';
import { SerovalMode } from '../plugin';
import { SPECIAL_REF_STRING } from '../special-reference';
import { serializeString } from '../string';
import type {
  SerovalAggregateErrorNode,
  SerovalArrayBufferNode,
  SerovalArrayNode,
  SerovalAsyncIteratorFactoryInstanceNode,
  SerovalAsyncIteratorFactoryNode,
  SerovalBigIntTypedArrayNode,
  SerovalBoxedNode,
  SerovalDataViewNode,
  SerovalDateNode,
  SerovalErrorNode,
  SerovalIndexedValueNode,
  SerovalIteratorFactoryInstanceNode,
  SerovalIteratorFactoryNode,
  SerovalMapNode,
  SerovalNode,
  SerovalNodeWithID,
  SerovalNullConstructorNode,
  SerovalObjectNode,
  SerovalObjectRecordKey,
  SerovalObjectRecordNode,
  SerovalPluginNode,
  SerovalPromiseConstructorNode,
  SerovalPromiseNode,
  SerovalPromiseRejectNode,
  SerovalPromiseResolveNode,
  SerovalReferenceNode,
  SerovalRegExpNode,
  SerovalSequenceNode,
  SerovalSetNode,
  SerovalStreamConstructorNode,
  SerovalStreamNextNode,
  SerovalStreamReturnNode,
  SerovalStreamThrowNode,
  SerovalTypedArrayNode,
} from '../types';
import getIdentifier from '../utils/get-identifier';
import { isValidIdentifier } from '../utils/is-valid-identifier';

const enum AssignmentType {
  Index = 0,
  Add = 1,
  Set = 2,
  Delete = 3,
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

// Array of assignments to be done (used for recursion)
type Assignment =
  | IndexAssignment
  | AddAssignment
  | SetAssignment
  | DeleteAssignment;

export interface FlaggedObject {
  type: SerovalObjectFlags;
  value: string;
}

function getAssignmentExpression(assignment: Assignment): string {
  switch (assignment.t) {
    case AssignmentType.Index:
      return assignment.s + '=' + assignment.v;
    case AssignmentType.Set:
      return assignment.s + '.set(' + assignment.k + ',' + assignment.v + ')';
    case AssignmentType.Add:
      return assignment.s + '.add(' + assignment.v + ')';
    case AssignmentType.Delete:
      return assignment.s + '.delete(' + assignment.k + ')';
  }
}

function mergeAssignments(assignments: Assignment[]): Assignment[] {
  const newAssignments: Assignment[] = [];
  let current = assignments[0];
  for (
    let i = 1, len = assignments.length, item: Assignment, prev = current;
    i < len;
    i++
  ) {
    item = assignments[i];
    if (item.t === AssignmentType.Index && item.v === prev.v) {
      // Merge if the right-hand value is the same
      // saves at least 2 chars
      current = {
        t: AssignmentType.Index,
        s: item.s,
        k: NIL,
        v: getAssignmentExpression(current),
      } as IndexAssignment;
    } else if (item.t === AssignmentType.Set && item.s === prev.s) {
      // Maps has chaining methods, merge if source is the same
      current = {
        t: AssignmentType.Set,
        s: getAssignmentExpression(current),
        k: item.k,
        v: item.v,
      } as SetAssignment;
    } else if (item.t === AssignmentType.Add && item.s === prev.s) {
      // Sets has chaining methods too
      current = {
        t: AssignmentType.Add,
        s: getAssignmentExpression(current),
        k: NIL,
        v: item.v,
      } as AddAssignment;
    } else if (item.t === AssignmentType.Delete && item.s === prev.s) {
      // Maps has chaining methods, merge if source is the same
      current = {
        t: AssignmentType.Delete,
        s: getAssignmentExpression(current),
        k: item.k,
        v: NIL,
      } as DeleteAssignment;
    } else {
      // Different assignment, push current
      newAssignments.push(current);
      current = item;
    }
    prev = item;
  }

  newAssignments.push(current);

  return newAssignments;
}

function resolveAssignments(assignments: Assignment[]): string | undefined {
  if (assignments.length) {
    let result = '';
    const merged = mergeAssignments(assignments);
    for (let i = 0, len = merged.length; i < len; i++) {
      result += getAssignmentExpression(merged[i]) + ',';
    }
    return result;
  }
  return NIL;
}

const NULL_CONSTRUCTOR = 'Object.create(null)';
const SET_CONSTRUCTOR = 'new Set';
const MAP_CONSTRUCTOR = 'new Map';

const PROMISE_RESOLVE = 'Promise.resolve';
const PROMISE_REJECT = 'Promise.reject';

const OBJECT_FLAG_CONSTRUCTOR: Record<SerovalObjectFlags, string | undefined> =
  {
    [SerovalObjectFlags.Frozen]: 'Object.freeze',
    [SerovalObjectFlags.Sealed]: 'Object.seal',
    [SerovalObjectFlags.NonExtensible]: 'Object.preventExtensions',
    [SerovalObjectFlags.None]: NIL,
  };

type SerovalNodeWithProperties =
  | SerovalObjectNode
  | SerovalNullConstructorNode
  | SerovalAggregateErrorNode
  | SerovalErrorNode;

export interface BaseSerializerContextOptions extends PluginAccessOptions {
  features: number;
  markedRefs: number[] | Set<number>;
}

export interface BaseSerializerContext extends PluginAccessOptions {
  readonly mode: SerovalMode;

  features: number;
  /*
   * To check if an object is synchronously referencing itself
   */
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

export function createBaseSerializerContext(
  mode: SerovalMode,
  options: BaseSerializerContextOptions,
): BaseSerializerContext {
  return {
    mode,
    plugins: options.plugins,
    features: options.features,
    marked: new Set(options.markedRefs),
    stack: [],
    flags: [],
    assignments: [],
  };
}

export interface VanillaSerializerState {
  valid: Map<number, number>;
  vars: string[];
}

function createVanillaSerializerState(): VanillaSerializerState {
  return {
    valid: new Map(),
    vars: [],
  };
}

export interface VanillaSerializerContext {
  mode: SerovalMode.Vanilla;
  base: BaseSerializerContext;
  state: VanillaSerializerState;
  child: SerializePluginContext | undefined;
}

export type VanillaSerializerContextOptions = BaseSerializerContextOptions;

export function createVanillaSerializerContext(
  options: VanillaSerializerContextOptions,
): VanillaSerializerContext {
  return {
    mode: SerovalMode.Vanilla,
    base: createBaseSerializerContext(SerovalMode.Vanilla, options),
    state: createVanillaSerializerState(),
    child: NIL,
  };
}

export interface CrossSerializerContext {
  mode: SerovalMode.Cross;
  base: BaseSerializerContext;
  state: CrossContextOptions;
  child: SerializePluginContext | undefined;
}

export interface CrossSerializerContextOptions
  extends BaseSerializerContextOptions,
    CrossContextOptions {
  // empty
}

export function createCrossSerializerContext(
  options: CrossSerializerContextOptions,
): CrossSerializerContext {
  return {
    mode: SerovalMode.Cross,
    base: createBaseSerializerContext(SerovalMode.Cross, options),
    state: options,
    child: NIL,
  };
}

type SerializerContext = VanillaSerializerContext | CrossSerializerContext;

export class SerializePluginContext {
  constructor(private _p: SerializerContext) {}

  serialize(node: SerovalNode) {
    return serialize(this._p, node);
  }
}

/**
 * Creates the reference param (identifier) from the given reference ID
 * Calling this function means the value has been referenced somewhere
 */
function getVanillaRefParam(
  state: VanillaSerializerState,
  index: number,
): string {
  /**
   * Creates a new reference ID from a given reference ID
   * This new reference ID means that the reference itself
   * has been referenced at least once, and is used to generate
   * the variables
   */
  let actualIndex = state.valid.get(index);
  if (actualIndex == null) {
    actualIndex = state.valid.size;
    state.valid.set(index, actualIndex);
  }
  let identifier = state.vars[actualIndex];
  if (identifier == null) {
    identifier = getIdentifier(actualIndex);
    state.vars[actualIndex] = identifier;
  }
  return identifier;
}

function getCrossRefParam(id: number): string {
  return GLOBAL_CONTEXT_REFERENCES + '[' + id + ']';
}

/**
 * Converts the ID of a reference into a identifier string
 * that is used to refer to the object instance in the
 * generated script.
 */
function getRefParam(ctx: SerializerContext, id: number): string {
  return ctx.mode === SerovalMode.Vanilla
    ? getVanillaRefParam(ctx.state, id)
    : getCrossRefParam(id);
}

function markSerializerRef(ctx: BaseSerializerContext, id: number): void {
  ctx.marked.add(id);
}

function isSerializerRefMarked(
  ctx: BaseSerializerContext,
  id: number,
): boolean {
  return ctx.marked.has(id);
}

function pushObjectFlag(
  ctx: SerializerContext,
  flag: SerovalObjectFlags,
  id: number,
): void {
  if (flag !== SerovalObjectFlags.None) {
    markSerializerRef(ctx.base, id);
    ctx.base.flags.push({
      type: flag,
      value: getRefParam(ctx, id),
    });
  }
}

function resolveFlags(ctx: BaseSerializerContext): string | undefined {
  let result = '';
  for (let i = 0, current = ctx.flags, len = current.length; i < len; i++) {
    const flag = current[i];
    result += OBJECT_FLAG_CONSTRUCTOR[flag.type] + '(' + flag.value + '),';
  }
  return result;
}

function resolvePatches(ctx: BaseSerializerContext): string | undefined {
  const assignments = resolveAssignments(ctx.assignments);
  const flags = resolveFlags(ctx);
  if (assignments) {
    if (flags) {
      return assignments + flags;
    }
    return assignments;
  }
  return flags;
}

/**
 * Generates the inlined assignment for the reference
 * This is different from the assignments array as this one
 * signifies creation rather than mutation
 */
function createAssignment(
  ctx: BaseSerializerContext,
  source: string,
  value: string,
): void {
  ctx.assignments.push({
    t: AssignmentType.Index,
    s: source,
    k: NIL,
    v: value,
  });
}

function createAddAssignment(
  ctx: SerializerContext,
  ref: number,
  value: string,
): void {
  ctx.base.assignments.push({
    t: AssignmentType.Add,
    s: getRefParam(ctx, ref),
    k: NIL,
    v: value,
  });
}

function createSetAssignment(
  ctx: SerializerContext,
  ref: number,
  key: string,
  value: string,
): void {
  ctx.base.assignments.push({
    t: AssignmentType.Set,
    s: getRefParam(ctx, ref),
    k: key,
    v: value,
  });
}

function createDeleteAssignment(
  ctx: SerializerContext,
  ref: number,
  key: string,
): void {
  ctx.base.assignments.push({
    t: AssignmentType.Delete,
    s: getRefParam(ctx, ref),
    k: key,
    v: NIL,
  });
}

function createArrayAssign(
  ctx: SerializerContext,
  ref: number,
  index: number | string,
  value: string,
): void {
  createAssignment(ctx.base, getRefParam(ctx, ref) + '[' + index + ']', value);
}

function createObjectAssign(
  ctx: SerializerContext,
  ref: number,
  key: string,
  value: string,
): void {
  createAssignment(ctx.base, getRefParam(ctx, ref) + '.' + key, value);
}

function createSequenceAssign(
  ctx: SerializerContext,
  ref: number,
  index: number | string,
  value: string,
): void {
  createAssignment(
    ctx.base,
    getRefParam(ctx, ref) + '.v[' + index + ']',
    value,
  );
}

/**
 * Checks if the value is in the stack. Stack here is a reference
 * structure to know if a object is to be accessed in a TDZ.
 */
function isIndexedValueInStack(
  ctx: BaseSerializerContext,
  node: SerovalNode,
): boolean {
  return node.t === SerovalNodeType.IndexedValue && ctx.stack.includes(node.i);
}

/**
 * Produces an assignment expression. `id` generates a reference
 * parameter (through `getRefParam`) and has the option to
 * return the reference parameter directly or assign a value to
 * it.
 */
function assignIndexedValue(
  ctx: SerializerContext,
  index: number,
  value: string,
): string {
  if (
    ctx.mode === SerovalMode.Vanilla &&
    !isSerializerRefMarked(ctx.base, index)
  ) {
    return value;
  }
  /**
   * In cross-reference, we have to assume that
   * every reference are going to be referenced
   * in the future, and so we need to store
   * all of it into the reference array.
   *
   * otherwise in vanilla, we only do this if it
   * is actually referenced
   */
  return getRefParam(ctx, index) + '=' + value;
}

function serializeReference(node: SerovalReferenceNode): string {
  return REFERENCES_KEY + '.get("' + node.s + '")';
}

function serializeArrayItem(
  ctx: SerializerContext,
  id: number,
  item: SerovalNode | 0,
  index: number,
): string {
  // Check if index is a hole
  if (item) {
    // Check if item is a parent
    if (isIndexedValueInStack(ctx.base, item)) {
      markSerializerRef(ctx.base, id);
      createArrayAssign(
        ctx,
        id,
        index,
        getRefParam(ctx, (item as SerovalIndexedValueNode).i),
      );
      return '';
    }
    return serialize(ctx, item);
  }
  return '';
}

function serializeArray(
  ctx: SerializerContext,
  node: SerovalArrayNode,
): string {
  const id = node.i;
  const list = node.a;
  const len = list.length;
  if (len > 0) {
    ctx.base.stack.push(id);
    let values = serializeArrayItem(ctx, id, list[0], 0);
    // This is different than Map and Set
    // because we also need to serialize
    // the holes of the Array
    let isHoley = values === '';
    for (let i = 1, item: string; i < len; i++) {
      item = serializeArrayItem(ctx, id, list[i], i);
      values += ',' + item;
      isHoley = item === '';
    }
    ctx.base.stack.pop();
    pushObjectFlag(ctx, node.o, node.i);
    return '[' + values + (isHoley ? ',]' : ']');
  }
  return '[]';
}

function serializeProperty(
  ctx: SerializerContext,
  source: SerovalNodeWithProperties,
  key: SerovalObjectRecordKey,
  val: SerovalNode,
): string {
  if (typeof key === 'string') {
    const check = Number(key);
    const isIdentifier =
      // Test if key is a valid positive number or JS identifier
      // so that we don't have to serialize the key and wrap with brackets
      (check >= 0 &&
        // It's also important to consider that if the key is
        // indeed numeric, we need to make sure that when
        // converted back into a string, it's still the same
        // to the original key. This allows us to differentiate
        // keys that has numeric formats but in a different
        // format, which can cause unintentional key declaration
        // Example: { 0x1: 1 } vs { '0x1': 1 }
        check.toString() === key) ||
      isValidIdentifier(key);
    if (isIndexedValueInStack(ctx.base, val)) {
      const refParam = getRefParam(ctx, (val as SerovalIndexedValueNode).i);
      markSerializerRef(ctx.base, source.i);
      // Strict identifier check, make sure
      // that it isn't numeric (except NaN)
      if (isIdentifier && check !== check) {
        createObjectAssign(ctx, source.i, key, refParam);
      } else {
        createArrayAssign(
          ctx,
          source.i,
          isIdentifier ? key : '"' + key + '"',
          refParam,
        );
      }
      return '';
    }
    return (isIdentifier ? key : '"' + key + '"') + ':' + serialize(ctx, val);
  }
  return '[' + serialize(ctx, key) + ']:' + serialize(ctx, val);
}

function serializeProperties(
  ctx: SerializerContext,
  source: SerovalNodeWithProperties,
  record: SerovalObjectRecordNode,
): string {
  const keys = record.k;
  const len = keys.length;
  if (len > 0) {
    const values = record.v;
    ctx.base.stack.push(source.i);
    let result = serializeProperty(ctx, source, keys[0], values[0]);
    for (let i = 1, item = result; i < len; i++) {
      item = serializeProperty(ctx, source, keys[i], values[i]);
      result += (item && result && ',') + item;
    }
    ctx.base.stack.pop();
    return '{' + result + '}';
  }
  return '{}';
}

function serializeObject(
  ctx: SerializerContext,
  node: SerovalObjectNode,
): string {
  pushObjectFlag(ctx, node.o, node.i);
  return serializeProperties(ctx, node, node.p);
}

function serializeWithObjectAssign(
  ctx: SerializerContext,
  source: SerovalNodeWithProperties,
  value: SerovalObjectRecordNode,
  serialized: string,
): string {
  const fields = serializeProperties(ctx, source, value);
  if (fields !== '{}') {
    return 'Object.assign(' + serialized + ',' + fields + ')';
  }
  return serialized;
}

function serializeStringKeyAssignment(
  ctx: SerializerContext,
  source: SerovalNodeWithProperties,
  mainAssignments: Assignment[],
  key: string,
  value: SerovalNode,
): void {
  const base = ctx.base;
  const serialized = serialize(ctx, value);
  const check = Number(key);
  const isIdentifier =
    // Test if key is a valid positive number or JS identifier
    // so that we don't have to serialize the key and wrap with brackets
    (check >= 0 &&
      // It's also important to consider that if the key is
      // indeed numeric, we need to make sure that when
      // converted back into a string, it's still the same
      // to the original key. This allows us to differentiate
      // keys that has numeric formats but in a different
      // format, which can cause unintentional key declaration
      // Example: { 0x1: 1 } vs { '0x1': 1 }
      check.toString() === key) ||
    isValidIdentifier(key);
  if (isIndexedValueInStack(base, value)) {
    // Strict identifier check, make sure
    // that it isn't numeric (except NaN)
    if (isIdentifier && check !== check) {
      createObjectAssign(ctx, source.i, key, serialized);
    } else {
      createArrayAssign(
        ctx,
        source.i,
        isIdentifier ? key : '"' + key + '"',
        serialized,
      );
    }
  } else {
    const parentAssignment = base.assignments;
    base.assignments = mainAssignments;
    if (isIdentifier && check !== check) {
      createObjectAssign(ctx, source.i, key, serialized);
    } else {
      createArrayAssign(
        ctx,
        source.i,
        isIdentifier ? key : '"' + key + '"',
        serialized,
      );
    }
    base.assignments = parentAssignment;
  }
}

function serializeAssignment(
  ctx: SerializerContext,
  source: SerovalNodeWithProperties,
  mainAssignments: Assignment[],
  key: SerovalObjectRecordKey,
  value: SerovalNode,
): void {
  if (typeof key === 'string') {
    serializeStringKeyAssignment(ctx, source, mainAssignments, key, value);
  } else {
    const base = ctx.base;
    const parent = base.stack;
    base.stack = [];
    const serialized = serialize(ctx, value);
    base.stack = parent;
    const parentAssignment = base.assignments;
    base.assignments = mainAssignments;
    createArrayAssign(ctx, source.i, serialize(ctx, key), serialized);
    base.assignments = parentAssignment;
  }
}

function serializeAssignments(
  ctx: SerializerContext,
  source: SerovalNodeWithProperties,
  node: SerovalObjectRecordNode,
): string | undefined {
  const keys = node.k;
  const len = keys.length;
  if (len > 0) {
    const mainAssignments: Assignment[] = [];
    const values = node.v;
    ctx.base.stack.push(source.i);
    for (let i = 0; i < len; i++) {
      serializeAssignment(ctx, source, mainAssignments, keys[i], values[i]);
    }
    ctx.base.stack.pop();
    return resolveAssignments(mainAssignments);
  }
  return NIL;
}

function serializeDictionary(
  ctx: SerializerContext,
  node: SerovalNodeWithProperties,
  init: string,
): string {
  if (node.p) {
    const base = ctx.base;
    if (base.features & Feature.ObjectAssign) {
      init = serializeWithObjectAssign(ctx, node, node.p, init);
    } else {
      markSerializerRef(base, node.i);
      const assignments = serializeAssignments(ctx, node, node.p);
      if (assignments) {
        return (
          '(' +
          assignIndexedValue(ctx, node.i, init) +
          ',' +
          assignments +
          getRefParam(ctx, node.i) +
          ')'
        );
      }
    }
  }
  return init;
}

function serializeNullConstructor(
  ctx: SerializerContext,
  node: SerovalNullConstructorNode,
): string {
  pushObjectFlag(ctx, node.o, node.i);
  return serializeDictionary(ctx, node, NULL_CONSTRUCTOR);
}

function serializeDate(node: SerovalDateNode): string {
  return 'new Date("' + node.s + '")';
}

function serializeRegExp(
  ctx: SerializerContext,
  node: SerovalRegExpNode,
): string {
  if (ctx.base.features & Feature.RegExp) {
    return '/' + node.c + '/' + node.m;
  }
  throw new SerovalUnsupportedNodeError(node);
}

function serializeSetItem(
  ctx: SerializerContext,
  id: number,
  item: SerovalNode,
): string {
  const base = ctx.base;
  if (isIndexedValueInStack(base, item)) {
    markSerializerRef(base, id);
    createAddAssignment(
      ctx,
      id,
      getRefParam(ctx, (item as SerovalIndexedValueNode).i),
    );
    return '';
  }
  return serialize(ctx, item);
}

function serializeSet(ctx: SerializerContext, node: SerovalSetNode): string {
  let serialized = SET_CONSTRUCTOR;
  const items = node.a;
  const size = items.length;
  const id = node.i;
  if (size > 0) {
    ctx.base.stack.push(id);
    let result = serializeSetItem(ctx, id, items[0]);
    for (let i = 1, item = result; i < size; i++) {
      item = serializeSetItem(ctx, id, items[i]);
      result += (item && result && ',') + item;
    }
    ctx.base.stack.pop();
    if (result) {
      serialized += '([' + result + '])';
    }
  }
  return serialized;
}

function serializeMapEntry(
  ctx: SerializerContext,
  id: number,
  key: SerovalNode,
  val: SerovalNode,
  sentinel: string,
): string {
  const base = ctx.base;
  if (isIndexedValueInStack(base, key)) {
    // Create reference for the map instance
    const keyRef = getRefParam(ctx, (key as SerovalIndexedValueNode).i);
    markSerializerRef(base, id);
    // Check if value is a parent
    if (isIndexedValueInStack(base, val)) {
      const valueRef = getRefParam(ctx, (val as SerovalIndexedValueNode).i);
      // Register an assignment since
      // both key and value are a parent of this
      // Map instance
      createSetAssignment(ctx, id, keyRef, valueRef);
      return '';
    }
    // Reset the stack
    // This is required because the serialized
    // value is no longer part of the expression
    // tree and has been moved to the deferred
    // assignment
    if (
      val.t !== SerovalNodeType.IndexedValue &&
      val.i != null &&
      isSerializerRefMarked(base, val.i)
    ) {
      // We use a trick here using sequence (or comma) expressions
      // basically we serialize the intended object in place WITHOUT
      // actually returning it, this is by returning a placeholder
      // value that we will remove sometime after.
      const serialized =
        '(' + serialize(ctx, val) + ',[' + sentinel + ',' + sentinel + '])';
      createSetAssignment(ctx, id, keyRef, getRefParam(ctx, val.i));
      createDeleteAssignment(ctx, id, sentinel);
      return serialized;
    }
    const parent = base.stack;
    base.stack = [];
    createSetAssignment(ctx, id, keyRef, serialize(ctx, val));
    base.stack = parent;
    return '';
  }
  if (isIndexedValueInStack(base, val)) {
    // Create ref for the Map instance
    const valueRef = getRefParam(ctx, (val as SerovalIndexedValueNode).i);
    markSerializerRef(base, id);
    if (
      key.t !== SerovalNodeType.IndexedValue &&
      key.i != null &&
      isSerializerRefMarked(base, key.i)
    ) {
      const serialized =
        '(' + serialize(ctx, key) + ',[' + sentinel + ',' + sentinel + '])';
      createSetAssignment(ctx, id, getRefParam(ctx, key.i), valueRef);
      createDeleteAssignment(ctx, id, sentinel);
      return serialized;
    }
    // Reset stack for the key serialization
    const parent = base.stack;
    base.stack = [];
    createSetAssignment(ctx, id, serialize(ctx, key), valueRef);
    base.stack = parent;
    return '';
  }

  return '[' + serialize(ctx, key) + ',' + serialize(ctx, val) + ']';
}

function serializeMap(ctx: SerializerContext, node: SerovalMapNode): string {
  let serialized = MAP_CONSTRUCTOR;
  const keys = node.e.k;
  const size = keys.length;
  const id = node.i;
  const sentinel = node.f;
  const sentinelId = getRefParam(ctx, sentinel.i);
  const base = ctx.base;
  if (size > 0) {
    const vals = node.e.v;
    base.stack.push(id);
    let result = serializeMapEntry(ctx, id, keys[0], vals[0], sentinelId);
    for (let i = 1, item = result; i < size; i++) {
      item = serializeMapEntry(ctx, id, keys[i], vals[i], sentinelId);
      result += (item && result && ',') + item;
    }
    base.stack.pop();
    // Check if there are any values
    // so that the empty Map constructor
    // can be used instead
    if (result) {
      serialized += '([' + result + '])';
    }
  }
  if (sentinel.t === SerovalNodeType.SpecialReference) {
    markSerializerRef(base, sentinel.i);
    serialized = '(' + serialize(ctx, sentinel) + ',' + serialized + ')';
  }
  return serialized;
}

function serializeArrayBuffer(
  ctx: SerializerContext,
  node: SerovalArrayBufferNode,
): string {
  return getConstructor(ctx, node.f) + '("' + node.s + '")';
}

function serializeTypedArray(
  ctx: SerializerContext,
  node: SerovalTypedArrayNode | SerovalBigIntTypedArrayNode,
): string {
  return (
    'new ' +
    node.c +
    '(' +
    serialize(ctx, node.f) +
    ',' +
    node.b +
    ',' +
    node.l +
    ')'
  );
}

function serializeDataView(
  ctx: SerializerContext,
  node: SerovalDataViewNode,
): string {
  return (
    'new DataView(' + serialize(ctx, node.f) + ',' + node.b + ',' + node.l + ')'
  );
}

function serializeAggregateError(
  ctx: SerializerContext,
  node: SerovalAggregateErrorNode,
): string {
  const id = node.i;
  // `AggregateError` might've been extended
  // either through class or custom properties
  // Make sure to assign extra properties
  ctx.base.stack.push(id);
  const serialized = serializeDictionary(
    ctx,
    node,
    'new AggregateError([],"' + node.m + '")',
  );
  ctx.base.stack.pop();
  return serialized;
}

function serializeError(
  ctx: SerializerContext,
  node: SerovalErrorNode,
): string {
  return serializeDictionary(
    ctx,
    node,
    'new ' + ERROR_CONSTRUCTOR_STRING[node.s] + '("' + node.m + '")',
  );
}

function serializePromise(
  ctx: SerializerContext,
  node: SerovalPromiseNode,
): string {
  let serialized: string;
  // Check if resolved value is a parent expression
  const fulfilled = node.f;
  const id = node.i;
  const promiseConstructor = node.s ? PROMISE_RESOLVE : PROMISE_REJECT;
  const base = ctx.base;
  if (isIndexedValueInStack(base, fulfilled)) {
    // A Promise trick, reference the value
    // inside the `then` expression so that
    // the Promise evaluates after the parent
    // has initialized
    const ref = getRefParam(ctx, (fulfilled as SerovalIndexedValueNode).i);
    serialized =
      promiseConstructor +
      (node.s
        ? '().then(' + createFunction([], ref) + ')'
        : '().catch(' + createEffectfulFunction([], 'throw ' + ref) + ')');
  } else {
    base.stack.push(id);
    const result = serialize(ctx, fulfilled);
    base.stack.pop();
    // just inline the value/reference here
    serialized = promiseConstructor + '(' + result + ')';
  }
  return serialized;
}

function serializeBoxed(
  ctx: SerializerContext,
  node: SerovalBoxedNode,
): string {
  return 'Object(' + serialize(ctx, node.f) + ')';
}

function getConstructor(
  ctx: SerializerContext,
  node: SerovalNodeWithID,
): string {
  const current = serialize(ctx, node);
  return node.t === SerovalNodeType.IndexedValue
    ? current
    : '(' + current + ')';
}

function serializePromiseConstructor(
  ctx: SerializerContext,
  node: SerovalPromiseConstructorNode,
): string {
  if (ctx.mode === SerovalMode.Vanilla) {
    throw new SerovalUnsupportedNodeError(node);
  }
  const resolver = assignIndexedValue(
    ctx,
    node.s,
    getConstructor(ctx, node.f) + '()',
  );
  return '(' + resolver + ').p';
}

function serializePromiseResolve(
  ctx: SerializerContext,
  node: SerovalPromiseResolveNode,
): string {
  if (ctx.mode === SerovalMode.Vanilla) {
    throw new SerovalUnsupportedNodeError(node);
  }
  return (
    getConstructor(ctx, node.a[0]) +
    '(' +
    getRefParam(ctx, node.i) +
    ',' +
    serialize(ctx, node.a[1]) +
    ')'
  );
}

function serializePromiseReject(
  ctx: SerializerContext,
  node: SerovalPromiseRejectNode,
): string {
  if (ctx.mode === SerovalMode.Vanilla) {
    throw new SerovalUnsupportedNodeError(node);
  }
  return (
    getConstructor(ctx, node.a[0]) +
    '(' +
    getRefParam(ctx, node.i) +
    ',' +
    serialize(ctx, node.a[1]) +
    ')'
  );
}

function serializePlugin(
  ctx: SerializerContext,
  node: SerovalPluginNode,
): string {
  const currentPlugins = ctx.base.plugins;
  if (currentPlugins) {
    for (let i = 0, len = currentPlugins.length; i < len; i++) {
      const plugin = currentPlugins[i];
      if (plugin.tag === node.c) {
        if (ctx.child == null) {
          ctx.child = new SerializePluginContext(ctx);
        }
        return plugin.serialize(node.s, ctx.child, {
          id: node.i,
        });
      }
    }
  }
  throw new SerovalMissingPluginError(node.c);
}

function serializeIteratorFactory(
  ctx: SerializerContext,
  node: SerovalIteratorFactoryNode,
): string {
  let result = '';
  let initialized = false;
  if (node.f.t !== SerovalNodeType.IndexedValue) {
    markSerializerRef(ctx.base, node.f.i);
    result = '(' + serialize(ctx, node.f) + ',';
    initialized = true;
  }
  result += assignIndexedValue(
    ctx,
    node.i,
    '(' +
      SERIALIZED_ITERATOR_CONSTRUCTOR +
      ')(' +
      getRefParam(ctx, node.f.i) +
      ')',
  );
  if (initialized) {
    result += ')';
  }
  return result;
}

function serializeIteratorFactoryInstance(
  ctx: SerializerContext,
  node: SerovalIteratorFactoryInstanceNode,
): string {
  return getConstructor(ctx, node.a[0]) + '(' + serialize(ctx, node.a[1]) + ')';
}

function serializeAsyncIteratorFactory(
  ctx: SerializerContext,
  node: SerovalAsyncIteratorFactoryNode,
): string {
  const promise = node.a[0];
  const symbol = node.a[1];
  const base = ctx.base;

  let result = '';

  if (promise.t !== SerovalNodeType.IndexedValue) {
    markSerializerRef(base, promise.i);
    result += '(' + serialize(ctx, promise);
  }
  if (symbol.t !== SerovalNodeType.IndexedValue) {
    markSerializerRef(base, symbol.i);
    result += (result ? ',' : '(') + serialize(ctx, symbol);
  }
  if (result) {
    result += ',';
  }

  const iterator = assignIndexedValue(
    ctx,
    node.i,
    '(' +
      SERIALIZED_ASYNC_ITERATOR_CONSTRUCTOR +
      ')(' +
      getRefParam(ctx, symbol.i) +
      ',' +
      getRefParam(ctx, promise.i) +
      ')',
  );

  if (result) {
    return result + iterator + ')';
  }

  return iterator;
}

function serializeAsyncIteratorFactoryInstance(
  ctx: SerializerContext,
  node: SerovalAsyncIteratorFactoryInstanceNode,
): string {
  return getConstructor(ctx, node.a[0]) + '(' + serialize(ctx, node.a[1]) + ')';
}

function serializeStreamConstructor(
  ctx: SerializerContext,
  node: SerovalStreamConstructorNode,
): string {
  const result = assignIndexedValue(
    ctx,
    node.i,
    getConstructor(ctx, node.f) + '()',
  );
  const len = node.a.length;
  if (len) {
    let values = serialize(ctx, node.a[0]);
    for (let i = 1; i < len; i++) {
      values += ',' + serialize(ctx, node.a[i]);
    }
    return '(' + result + ',' + values + ',' + getRefParam(ctx, node.i) + ')';
  }
  return result;
}

function serializeStreamNext(
  ctx: SerializerContext,
  node: SerovalStreamNextNode,
): string {
  return getRefParam(ctx, node.i) + '.next(' + serialize(ctx, node.f) + ')';
}

function serializeStreamThrow(
  ctx: SerializerContext,
  node: SerovalStreamThrowNode,
): string {
  return getRefParam(ctx, node.i) + '.throw(' + serialize(ctx, node.f) + ')';
}

function serializeStreamReturn(
  ctx: SerializerContext,
  node: SerovalStreamReturnNode,
): string {
  return getRefParam(ctx, node.i) + '.return(' + serialize(ctx, node.f) + ')';
}

function serializeSequenceItem(
  ctx: SerializerContext,
  id: number,
  index: number,
  item: SerovalNode,
): string {
  const base = ctx.base;
  if (isIndexedValueInStack(base, item)) {
    markSerializerRef(base, id);
    createSequenceAssign(
      ctx,
      id,
      index,
      getRefParam(ctx, (item as SerovalIndexedValueNode).i),
    );
    return '';
  }
  return serialize(ctx, item);
}

function serializeSequence(
  ctx: SerializerContext,
  node: SerovalSequenceNode,
): string {
  const items = node.a;
  const size = items.length;
  const id = node.i;
  if (size > 0) {
    ctx.base.stack.push(id);
    let result = serializeSequenceItem(ctx, id, 0, items[0]);
    for (let i = 1, item = result; i < size; i++) {
      item = serializeSequenceItem(ctx, id, i, items[i]);
      result += (item && result && ',') + item;
    }
    ctx.base.stack.pop();
    if (result) {
      return (
        '{__SEROVAL_SEQUENCE__:!0,v:[' +
        result +
        '],t:' +
        node.s +
        ',d:' +
        node.l +
        '}'
      );
    }
  }
  return '{__SEROVAL_SEQUENCE__:!0,v:[],t:-1,d:0}';
}

function serializeAssignable(
  ctx: SerializerContext,
  node: SerovalNode,
): string {
  switch (node.t) {
    case SerovalNodeType.WKSymbol:
      return SYMBOL_STRING[node.s];
    case SerovalNodeType.Reference:
      return serializeReference(node);
    case SerovalNodeType.Array:
      return serializeArray(ctx, node);
    case SerovalNodeType.Object:
      return serializeObject(ctx, node);
    case SerovalNodeType.NullConstructor:
      return serializeNullConstructor(ctx, node);
    case SerovalNodeType.Date:
      return serializeDate(node);
    case SerovalNodeType.RegExp:
      return serializeRegExp(ctx, node);
    case SerovalNodeType.Set:
      return serializeSet(ctx, node);
    case SerovalNodeType.Map:
      return serializeMap(ctx, node);
    case SerovalNodeType.ArrayBuffer:
      return serializeArrayBuffer(ctx, node);
    case SerovalNodeType.BigIntTypedArray:
    case SerovalNodeType.TypedArray:
      return serializeTypedArray(ctx, node);
    case SerovalNodeType.DataView:
      return serializeDataView(ctx, node);
    case SerovalNodeType.AggregateError:
      return serializeAggregateError(ctx, node);
    case SerovalNodeType.Error:
      return serializeError(ctx, node);
    case SerovalNodeType.Promise:
      return serializePromise(ctx, node);
    case SerovalNodeType.Boxed:
      return serializeBoxed(ctx, node);
    case SerovalNodeType.PromiseConstructor:
      return serializePromiseConstructor(ctx, node);
    case SerovalNodeType.Plugin:
      return serializePlugin(ctx, node);
    case SerovalNodeType.SpecialReference:
      return SPECIAL_REF_STRING[node.s];
    case SerovalNodeType.Sequence:
      return serializeSequence(ctx, node);
    default:
      throw new SerovalUnsupportedNodeError(node);
  }
}

function serialize(ctx: SerializerContext, node: SerovalNode): string {
  switch (node.t) {
    case SerovalNodeType.Constant:
      return CONSTANT_STRING[node.s];
    case SerovalNodeType.Number:
      return '' + node.s;
    case SerovalNodeType.String:
      return '"' + node.s + '"';
    case SerovalNodeType.BigInt:
      return node.s + 'n';
    case SerovalNodeType.IndexedValue:
      return getRefParam(ctx, node.i);
    case SerovalNodeType.PromiseSuccess:
      return serializePromiseResolve(ctx, node);
    case SerovalNodeType.PromiseFailure:
      return serializePromiseReject(ctx, node);
    case SerovalNodeType.IteratorFactory:
      return serializeIteratorFactory(ctx, node);
    case SerovalNodeType.IteratorFactoryInstance:
      return serializeIteratorFactoryInstance(ctx, node);
    case SerovalNodeType.AsyncIteratorFactory:
      return serializeAsyncIteratorFactory(ctx, node);
    case SerovalNodeType.AsyncIteratorFactoryInstance:
      return serializeAsyncIteratorFactoryInstance(ctx, node);
    case SerovalNodeType.StreamConstructor:
      return serializeStreamConstructor(ctx, node);
    case SerovalNodeType.StreamNext:
      return serializeStreamNext(ctx, node);
    case SerovalNodeType.StreamThrow:
      return serializeStreamThrow(ctx, node);
    case SerovalNodeType.StreamReturn:
      return serializeStreamReturn(ctx, node);
    default:
      return assignIndexedValue(ctx, node.i, serializeAssignable(ctx, node));
  }
}

export function serializeRoot(
  ctx: SerializerContext,
  node: SerovalNode,
): string {
  try {
    return serialize(ctx, node);
  } catch (error) {
    throw error instanceof SerovalSerializationError
      ? error
      : new SerovalSerializationError(error);
  }
}

export function serializeTopVanilla(
  ctx: VanillaSerializerContext,
  tree: SerovalNode,
): string {
  const result = serialize(ctx, tree);
  // Shared references detected
  if (tree.i != null && ctx.state.vars.length) {
    const patches = resolvePatches(ctx.base);
    let body = result;
    if (patches) {
      // Get (or create) a ref from the source
      const index = getRefParam(ctx, tree.i);
      body = result + ',' + patches + index;
      if (!result.startsWith(index + '=')) {
        body = index + '=' + body;
      }
      body = '(' + body + ')';
    }
    return '(' + createFunction(ctx.state.vars, body) + ')()';
  }
  if (tree.t === SerovalNodeType.Object) {
    return '(' + result + ')';
  }
  return result;
}

export function serializeTopCross(
  ctx: CrossSerializerContext,
  tree: SerovalNode,
): string {
  // Get the serialized result
  const result = serialize(ctx, tree);
  // If the node is a non-reference, return
  // the result immediately
  const id = tree.i;
  if (id == null) {
    return result;
  }
  // Get the patches
  const patches = resolvePatches(ctx.base);
  // Get the variable that represents the root
  const ref = getRefParam(ctx, id);
  const scopeId = ctx.state.scopeId;
  // Parameters needed for scoping
  const params = scopeId == null ? '' : GLOBAL_CONTEXT_REFERENCES;
  // If there are patches, append it after the result
  const body = patches ? '(' + result + ',' + patches + ref + ')' : result;
  // If there are no params, there's no need to generate a function
  if (params === '') {
    if (tree.t === SerovalNodeType.Object && !patches) {
      return '(' + body + ')';
    }
    return body;
  }
  // Get the arguments for the IIFE
  const args =
    scopeId == null
      ? '()'
      : '(' +
        GLOBAL_CONTEXT_REFERENCES +
        '["' +
        serializeString(scopeId) +
        '"])';
  // Create the IIFE
  return '(' + createFunction([params], body) + ')' + args;
}
