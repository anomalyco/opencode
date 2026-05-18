/// <reference types="pridepack/env" />

import { serializeString } from './string';
import type { SerovalNode } from './types';

const { toString: objectToString } = /* @__PURE__ */ Object.prototype;

const enum StepErrorCodes {
  Parse = 1,
  Serialize = 2,
  Deserialize = 3,
}

function getErrorMessageDev(type: string, cause: unknown): string {
  if (cause instanceof Error) {
    return `Seroval caught an error during the ${type} process.

${cause.name}
${cause.message}

- For more information, please check the "cause" property of this error.
- If you believe this is an error in Seroval, please submit an issue at https://github.com/lxsmnsyc/seroval/issues/new`;
  }
  return `Seroval caught an error during the ${type} process.

"${objectToString.call(cause)}"

For more information, please check the "cause" property of this error.`;
}

const STEP_ERROR_CODES: Record<string, StepErrorCodes> = {
  parsing: StepErrorCodes.Parse,
  serialization: StepErrorCodes.Serialize,
  deserialization: StepErrorCodes.Deserialize,
};

function getErrorMessageProd(type: string): string {
  return `Seroval Error (step: ${STEP_ERROR_CODES[type]})`;
}

const getErrorMessage = (type: string, cause: any) =>
  import.meta.env.PROD
    ? getErrorMessageProd(type)
    : getErrorMessageDev(type, cause);

export class SerovalError extends Error {
  constructor(
    type: string,
    public cause: unknown,
  ) {
    super(getErrorMessage(type, cause));
  }
}

export class SerovalParserError extends SerovalError {
  constructor(cause: unknown) {
    super('parsing', cause);
  }
}

export class SerovalSerializationError extends SerovalError {
  constructor(cause: unknown) {
    super('serialization', cause);
  }
}

export class SerovalDeserializationError extends SerovalError {
  constructor(cause: unknown) {
    super('deserialization', cause);
  }
}

const enum SpecificErrorCodes {
  UnsupportedType = 1,
  UnsupportedNode = 2,
  MissingPlugin = 3,
  MissingInstance = 4,
  MissingReference = 5,
  MissingReferenceForId = 6,
  UnknownTypedArray = 7,
  MalformedNode = 8,
  ConflictedNodeId = 9,
  DepthLimit = 10,
}

function getSpecificErrorMessage(code: SpecificErrorCodes): string {
  return `Seroval Error (specific: ${code})`;
}

export class SerovalUnsupportedTypeError extends Error {
  constructor(public value: unknown) {
    super(
      import.meta.env.PROD
        ? getSpecificErrorMessage(SpecificErrorCodes.UnsupportedType)
        : `The value ${objectToString.call(value)} of type "${typeof value}" cannot be parsed/serialized.
      
There are few workarounds for this problem:
- Transform the value in a way that it can be serialized.
- If the reference is present on multiple runtimes (isomorphic), you can use the Reference API to map the references.`,
    );
  }
}

export class SerovalUnsupportedNodeError extends Error {
  constructor(node: SerovalNode) {
    super(
      import.meta.env.PROD
        ? getSpecificErrorMessage(SpecificErrorCodes.UnsupportedNode)
        : 'Unsupported node type "' + node.t + '".',
    );
  }
}

export class SerovalMissingPluginError extends Error {
  constructor(tag: string) {
    super(
      import.meta.env.PROD
        ? getSpecificErrorMessage(SpecificErrorCodes.MissingPlugin)
        : 'Missing plugin for tag "' + tag + '".',
    );
  }
}

export class SerovalMissingInstanceError extends Error {
  constructor(tag: string) {
    super(
      import.meta.env.PROD
        ? getSpecificErrorMessage(SpecificErrorCodes.MissingInstance)
        : 'Missing "' + tag + '" instance.',
    );
  }
}

export class SerovalMissingReferenceError extends Error {
  constructor(public value: unknown) {
    super(
      import.meta.env.PROD
        ? getSpecificErrorMessage(SpecificErrorCodes.MissingReference)
        : 'Missing reference for the value "' +
            objectToString.call(value) +
            '" of type "' +
            typeof value +
            '"',
    );
  }
}

export class SerovalMissingReferenceForIdError extends Error {
  constructor(id: string) {
    super(
      import.meta.env.PROD
        ? getSpecificErrorMessage(SpecificErrorCodes.MissingReferenceForId)
        : 'Missing reference for id "' + serializeString(id) + '"',
    );
  }
}

export class SerovalUnknownTypedArrayError extends Error {
  constructor(name: string) {
    super(
      import.meta.env.PROD
        ? getSpecificErrorMessage(SpecificErrorCodes.UnknownTypedArray)
        : 'Unknown TypedArray "' + name + '"',
    );
  }
}

export class SerovalMalformedNodeError extends Error {
  constructor(node: SerovalNode) {
    super(
      import.meta.env.PROD
        ? getSpecificErrorMessage(SpecificErrorCodes.MalformedNode)
        : 'Malformed node type "' + node.t + '".',
    );
  }
}

export class SerovalConflictedNodeIdError extends Error {
  constructor(node: SerovalNode) {
    super(
      import.meta.env.PROD
        ? getSpecificErrorMessage(SpecificErrorCodes.ConflictedNodeId)
        : 'Conflicted node id "' + node.i + '".',
    );
  }
}

export class SerovalDepthLimitError extends Error {
  constructor(limit: number) {
    super(
      import.meta.env.PROD
        ? getSpecificErrorMessage(SpecificErrorCodes.ConflictedNodeId)
        : 'Depth limit of ' + limit + ' reached',
    );
  }
}
