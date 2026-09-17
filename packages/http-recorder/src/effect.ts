import { NodeFileSystem } from "@effect/platform-node"
import * as Layer from "effect/Layer"
import { FetchHttpClient } from "effect/unstable/http"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as CassetteService from "./cassette.js"
import { recordingLayer } from "./internal-effect.js"
import { make } from "./redactor.js"
import type { RecorderOptions } from "./types.js"

/**
 * Provides a fetch-backed `HttpClient` with cassette recording and replay.
 *
 * Locally, a missing cassette is recorded from the real service. Existing
 * cassettes are replayed, and `CI=true` makes a missing cassette fail.
 */
export const http = (name: string, options: RecorderOptions = {}): Layer.Layer<HttpClient.HttpClient> =>
  recordingLayer(name, {
    metadata: options.metadata,
    redactor: make(options.redact),
    match: options.match,
  }).pipe(
    Layer.provide(CassetteService.fileSystem({ directory: options.directory })),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(NodeFileSystem.layer),
  )
