import { expect, test } from "bun:test"
import { ConfigProvider, Effect, FileSystem, Layer } from "effect"
import { DriveManifest } from "../src/manifest"

test("loads and validates a Drive manifest through Effect services", async () => {
  const manifest = await Effect.runPromise(
    DriveManifest.resolve().pipe(
      Effect.provide(
        Layer.merge(
          FileSystem.layerNoop({
            readFileString: () =>
              Effect.succeed(
                JSON.stringify({
                  endpoints: {
                    ui: "ws://127.0.0.1:41000",
                    backend: "ws://127.0.0.1:41050",
                  },
                  viewport: { cols: 120, rows: 50 },
                  recording: { timeline: "/tmp/drive/timeline.jsonl" },
                }),
              ),
          }),
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              OPENCODE_DRIVE: "test-instance",
              DRIVE_REGISTRY_DIR: "/tmp/drive",
            }),
          ),
        ),
      ),
    ),
  )

  expect(manifest).toEqual({
    endpoints: {
      ui: "ws://127.0.0.1:41000",
      backend: "ws://127.0.0.1:41050",
    },
    viewport: { cols: 120, rows: 50 },
    recording: { timeline: "/tmp/drive/timeline.jsonl" },
  })
})

test("accepts an explicit port 0, which asks the endpoint for a port of its own", async () => {
  const manifest = await Effect.runPromise(
    DriveManifest.resolve().pipe(
      Effect.provide(
        Layer.merge(
          FileSystem.layerNoop({
            readFileString: () =>
              Effect.succeed(
                JSON.stringify({
                  endpoints: { ui: "ws://127.0.0.1:0", backend: "ws://127.0.0.1:41050" },
                }),
              ),
          }),
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ OPENCODE_DRIVE: "test-instance", DRIVE_REGISTRY_DIR: "/tmp/drive" }),
          ),
        ),
      ),
    ),
  )

  expect(manifest.endpoints.ui).toBe("ws://127.0.0.1:0")
})

test("reports schema-invalid manifests as typed decode failures", async () => {
  for (const ui of ["https://example.com", "ws://127.0.0.1"]) {
    const error = await Effect.runPromise(
      DriveManifest.resolve().pipe(
        Effect.flip,
        Effect.provide(
          Layer.merge(
            FileSystem.layerNoop({
              readFileString: () =>
                Effect.succeed(
                  JSON.stringify({
                    endpoints: {
                      ui,
                      backend: "ws://127.0.0.1:41050",
                    },
                  }),
                ),
            }),
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                OPENCODE_DRIVE: "test-instance",
                DRIVE_REGISTRY_DIR: "/tmp/drive",
              }),
            ),
          ),
        ),
      ),
    )

    expect(error).toBeInstanceOf(DriveManifest.ResolveError)
    expect(error.reason).toBe("decode")
  }
})
