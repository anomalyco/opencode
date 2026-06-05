import { NodeFileSystem } from "@effect/platform-node"
import * as Layer from "effect/Layer"
import { FetchHttpClient } from "effect/unstable/http"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as CassetteService from "./cassette.js"
import { defaultMatcher as defaultRequestMatcher, recordingLayer } from "./internal-effect.js"
import { make } from "./redactor.js"
import type { RecorderOptions, RequestMatcher } from "./types.js"

export type { RecorderOptions, RequestMatcher } from "./types.js"

/** Matches HTTP requests by method, URL, allowed headers, and canonical JSON body. */
export const defaultMatcher: RequestMatcher = defaultRequestMatcher

/**
 * Wraps an existing `HttpClient` with cassette recording and replay.
 *
 * Use this form to preserve application middleware, proxies, tracing, or a
 * custom transport.
 */
export const layer = (
  name: string,
  options: RecorderOptions = {},
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  recordingLayer(name, {
    metadata: options.metadata,
    redactor: make(options.redact),
    match: options.match,
  }).pipe(
    Layer.provide(CassetteService.fileSystem({ directory: options.directory })),
    Layer.provide(NodeFileSystem.layer),
  )

/**
 * Provides a recorded `HttpClient` backed by Effect's fetch transport.
 *
 * Locally, a missing cassette is recorded from the live endpoint. Existing
 * cassettes are replayed, and `CI=true` makes a missing cassette fail.
 */
export const layerFetch = (name: string, options: RecorderOptions = {}): Layer.Layer<HttpClient.HttpClient> =>
  layer(name, options).pipe(Layer.provide(FetchHttpClient.layer))
