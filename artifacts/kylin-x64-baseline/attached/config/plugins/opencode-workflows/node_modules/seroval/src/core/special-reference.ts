import {
  SERIALIZED_ARRAY_BUFFER_CONSTRUCTOR,
  SERIALIZED_PROMISE_CONSTRUCTOR,
  SERIALIZED_PROMISE_FAILURE,
  SERIALIZED_PROMISE_SUCCESS,
  SERIALIZED_STREAM_CONSTRUCTOR,
} from './constructors';

export const ITERATOR = {};

export const ASYNC_ITERATOR = {};

export const enum SpecialReference {
  MapSentinel = 0,
  PromiseConstructor = 1,
  PromiseSuccess = 2,
  PromiseFailure = 3,
  StreamConstructor = 4,
  ArrayBufferConstructor = 5,
}

/**
 * Placeholder references
 */
export const SPECIAL_REFS: Record<SpecialReference, unknown> = {
  [SpecialReference.MapSentinel]: {},
  [SpecialReference.PromiseConstructor]: {},
  [SpecialReference.PromiseSuccess]: {},
  [SpecialReference.PromiseFailure]: {},
  [SpecialReference.StreamConstructor]: {},
  [SpecialReference.ArrayBufferConstructor]: {},
};

export const SPECIAL_REF_STRING: Record<SpecialReference, string> = {
  [SpecialReference.MapSentinel]: '[]',
  [SpecialReference.PromiseConstructor]: SERIALIZED_PROMISE_CONSTRUCTOR,
  [SpecialReference.PromiseSuccess]: SERIALIZED_PROMISE_SUCCESS,
  [SpecialReference.PromiseFailure]: SERIALIZED_PROMISE_FAILURE,
  [SpecialReference.StreamConstructor]: SERIALIZED_STREAM_CONSTRUCTOR,
  [SpecialReference.ArrayBufferConstructor]:
    SERIALIZED_ARRAY_BUFFER_CONSTRUCTOR,
};
