# psychoscript-mobile

PsychoScript for iOS and Android: UniFFI bindings over the `psychoscript` crate, with no JavaScript engine. A host
hands a program JSON and reads JSON back. With the `widget-gpu` feature (on by default) it also replays OpenCode widgets'
GPU canvases on the device's GPU (wgpu: Metal on iOS, Vulkan on Android) and presents them into the app's surfaces
([GPU canvases](#gpu-canvases)).

| | Swift | Kotlin |
| --- | --- | --- |
| Module / package | `import PsychoScript` | `com.anomalyco.psychoscript` |
| Native library | `PsychoScriptFFI.xcframework` (static) | `libpsychoscript_mobile.so` (JNA) |

## API

```swift
let program = try Program(source: source)                       // inputName: "__input" by default
let out = try program.run(inputJson: #"{"n":21}"#, options: RunOptions(timeoutMs: 250))
```

```kotlin
val program = Program(source)                                   // inputName = "__input" by default
val out = program.run("""{"n":21}""", RunOptions(timeoutMs = 250uL))
```

- `Program(source, inputName = "__input")` compiles once. Fails with `Syntax`.
- `run(inputJson, options = RunOptions())` runs it: `inputName()` is a sync host function returning the input, and the
  result is the program's completion value (a top-level `return`'s, or the last expression statement's) as compact
  JSON, `undefined` as `null`. `RunOptions(timeoutMs?, maxOutputBytes?, maxHeapBytes?)`: active-time limit, result
  size limit and heap cap, all off by default.
- `program.session(fieldsJson) -> RunSession` parses a JSON object once; `session.run(inputJson, options)` runs with
  those fields followed by `inputJson`'s own (a JSON object) as the input. The program sees the same input as
  `run` with the whole object (shared fields first). For a widget, keep a session per widget with its `data`, and send
  only `{ phase, state, event | frame }` per step. That saves sending and parsing `data` on every step: on a Mac JVM
  (Android-style JNA) bench with 25.6 KB of `data`, a trivial step went from ~400 to ~350 µs. Most of what remains is
  the VM turning the input into its own values, which every run pays.
- `PsychoScriptError` (Kotlin `PsychoScriptException`); `reason` is the message, `kind` the language's diagnostic kind,
  `line`/`column` 1-based in the source:
  - `Syntax(kind, reason, line, column)`: `ParseError`, or `UnsupportedSyntax` (which may surface only when a run
    reaches it).
  - `Runtime(kind, reason, line, column)`: `ExecutionFailure` (the reason starts with the thrown error's name, as
    `TypeError: ...`), `InvalidDataValue` (a result that isn't JSON data), or a host kind.
  - `Timeout(reason, timeoutMs)`, `OutputTooLarge(reason, maxOutputBytes)`, `InvalidInput(reason)` (input not JSON,
    `timeoutMs` 0).
  - `MemoryLimitExceeded(reason, maxHeapBytes)`: the run's heap went over `maxHeapBytes`. Sizes follow the language's
    model of what the program can still reach, not the process's memory.
Swift errors also get `.reason` on the enum. Kotlin exceptions' `message` lists every field.

### Bytes instead of JSON

A `ValueEncoder` writes what a program hands its host as bytes in its own format. The crate carries them and knows
nothing of the format. `ValueEncoder.widget()` (feature `widget-wire`, on by default) is OpenCode widgets' binary
format (opencode `specs/v2/widgets-binary.md`, crate `widget-wire`) for a native host of widget protocol 2
(`widgets.md`, Native hosts): it builds the view tree (ids, keys, handlers) itself while it encodes, from the view as
the program built it. Runs with an encoder pass program functions to the host as markers (psychoscript
`translate: { functions: "mark" }`). Runs with the widget encoder (steps and live runs) also have psychoscript's typed
arrays (`typedArrays: true`: `ArrayBuffer`, `Float32Array`, `Uint16Array`, `Uint32Array`, `Int32Array`,
`Float64Array`), for a GPU batch's bytes; other runs keep psychoscript's default, without them (only `Uint8Array`).
A snapshot resumes only with the same setting, so restore a widget run with the widget encoder.

- **Checked before running.** `runBytes` and `startLive` with an encoder first let it check the program's first line;
  a refused program doesn't run, and the call fails with `Runtime` of the encoder's kind. The widget encoder runs only
  protocol 2 (`const __widget_protocol = 2`): an older program fails with kind `OlderProtocol` and the message
  `This widget was built with an older widget runtime; ask the agent to post it again` (a program error in the phase
  of the step or run refused: `init`, `event`, `draw`, `main`), a newer one with kind `NewerProtocol` and
  `This widget needs a newer version of this app` (a client error: show it, don't report it).
- `program.runBytes(inputJson, encoder, options = RunOptions())`, also on `RunSession`, defines the host global
  `encoder.emitName()` (`__widget_emit`) beside the input function, and returns the bytes the encoder makes of what
  the program passed to the global and of the run's result, instead of the result's JSON. For widgets: the encoder
  reads the step's `phase` from the input. In `init` and `event` steps the view goes through `__widget_emit`, and
  `{ state, submit?, dismiss?, send? }` is the run's result, so it keeps the JSON path's rules exactly (`toJSON`, an
  `Error`'s fields, a typed array failing the step). In `draw` steps the commands go through `__widget_emit`, read as
  JSON reads them (functions left out), and the run has no result.
  `maxOutputBytes` limits the bytes. Failures (`Runtime`, by kind):
  - `InvalidView`, no line: the view breaks Keys and depth (`A node's key must be a string, a number or a boolean`,
    `The view nests more than 100 levels`), whatever the run did after;
  - `InvalidDraw`, no line: a draw step's commands failing the Draw command checks (`widgets.md`, Canvas), with
    exactly that section's message, e.g. `draw command 2: a text weight must be 400, 500, 600 or 700` (after the
    run; the run's own failure first). Clients get the normalised commands (clamped values, defaults for absent
    fields);
  - `ExecutionFailure` `TypeError: Argument <n> to __widget_emit contains a function, which cannot be passed to the
    host. (line, col)`: a function in the view anywhere but a node's `onPress`, `onChange`, `onPointer`;
  - `InvalidDataValue` `The step gave no view`: an init or event step that never called `__widget_emit`;
  - and the run's own failures, as `run` has them.
- With `startLive(..., encoder:)` (and `LiveRun.restore(..., encoder:)`, with the same encoder), every post reaches
  `handler.onPostsBytes(messages)` as the encoder's bytes, a wake-up's posts in one call, and `onPosts` is never
  called. `__host.post` returns what the encoder says: for a widget `render`, whether the view has handlers (the
  prelude keeps the run going on it), else `undefined`. A post the encoder can't write throws at `__host.post`:
  uncaught, the run ends with `Failed(Runtime)` of the encoder's kind, located at the post. A live draw's commands
  get a draw step's checks and message (kind `InvalidDraw`, the message without an `invalid post:` prefix). A view
  breaking Keys and depth doesn't throw: the run ends at once with `Failed(Runtime(kind: "InvalidView"))`, no line.
  What the encoder keeps (a widget's canvases by key) goes into a snapshot.
- **An encoder may hold posts back** and hand them over later: the crate asks it again when it says (its timer wakes
  the waiting run, whose next poll hands them over), and takes all of them when the run ends, before `onExit`,
  unless `stop()` ended it (then they're dropped). The widget encoder holds back for the **post rate**
  (`widgets-live.md`, Post rate): `render` and `draw` posts take a token from a bucket of 8 refilled at 240 a second;
  without one they wait, a newer render replacing the waiting render and a newer draw the waiting draw of its canvas
  key, and go out in order as tokens come. Every post is checked when it's posted (errors and `post`'s answer don't
  wait). `submit` and `dismiss` hand over what waits first; `frame`, `send` and `capture` go at once. A post carrying
  a GPU batch takes no token but waits behind waiting posts, in order (the frame request it rides in too); a frame
  request while one is pending (no `frame` delivered since) sends nothing, its batch still applies. GPU batches never
  reach `onPostsBytes`: they are replayed here ([GPU canvases](#gpu-canvases)). Nothing is dropped and the rate is
  never an error. A `draw` post whose `key` isn't a string ends the run with
  `Failed(Runtime(kind: "InvalidDataValue", reason: "A draw post needs a string key"))`, no line.
- A function (marker) in the argument of a host function the encoder doesn't handle, or where the encoder allows none
  (a post's values, draw commands, `fetch`'s request), fails the call with the runtime's `TypeError`
  `Argument <n> to <name> contains a function, which cannot be passed to the host.` at the call, as it does without
  an encoder: a real `TypeError` the program can catch, located at the call when uncaught.
- Widget live draws name their canvas by key (`{ type: "draw", key, commands }`); the encoder sends the canvas's id
  from the last render. An unknown key, or a canvas drawn by its `wgsl` or by the GPU (`gpu: true`), throws an
  `Error` at the post that the program can catch, as the prelude does.
- The widget encoder's kinds name the spec's phase for the report: `InvalidView` (phase `view`), `InvalidDraw`
  (`draw`). Anything else it can't write (an unknown post type) is `InvalidDataValue`, an invalid post as today. A GPU
  batch's errors don't end the run: they stop canvases (`onGpuCanvas`, phase `gpu`).

## Live runs

`program.startLive(inputJson, handler, options = LiveOptions(), transport = nil, encoder = nil)` runs the program on a thread of
its own until it returns or is stopped. Beside its input function it gets `__host`:

| Function | Kind | |
| --- | --- | --- |
| `__host.post(message)` | sync | `handler.onPosts([json, ...])`, a wake-up's posts in one call (`onPostsBytes` with an encoder) |
| `await __host.receive()` | async | the next message `deliver(json)` queued, in order |
| `await __host.sleep(ms)` | async | resolves after `ms` of running time (clamped to >= 0) |
| `__host.now()` | sync | ms of running time, paused time left out |
| `await __host.fetch(request)` | async | HTTPS through the app's `FetchTransport` (below) |

- `LiveHandler` (callback interface): `onPosts(messagesJson)` gets every post of one wake-up of the program, in
  order, in one call, as soon as the program waits again (or ends). A live frame that draws and then asks for the next
  frame costs one callback, not two. `onPostsBytes(messages)` replaces `onPosts` for a run with an encoder (above);
  implement it as a no-op otherwise. `onWarning(message)` comes in its own call: a `fetch` the crate denies, once per denial as the program gets it,
  `CapabilityDenied: <reason>` (no https capability, a host not declared, a local address outside `allowLocalNetwork`,
  credentials in the URL, ...), for the app to log in dev mode (the crate logs nothing). Both run on the run's thread: hand
  them to the UI thread and return. `onExit(LiveExit)` runs once on the run's thread:
  `Finished(resultJson)`, `Failed(error)` (`SliceBudget`, `Runtime`, ...), or `Stopped`. `onGpuCanvas(key, state)`
  tells a widget run's GPU canvas states ([GPU canvases](#gpu-canvases)); implement it as a no-op otherwise.
- `LiveOptions(sliceBudgetMs = 50, httpsHosts = nil, allowLocalNetwork = false, maxHeapBytes = nil)`. The crate
  limits no post rate: a widget's is its encoder's (above).
  - **Slice budget:** a run computing past the budget without waiting is stopped with `SliceBudget`. Only the VM's
    own execution counts, in its thread's CPU time, so time the OS doesn't schedule the thread (a loaded device, a
    paused emulator) isn't compute: not the time it waits on pending host calls (several at once included), and not time
    inside host code on its thread (`post`, `now`, the input function, polls of host calls, and the handler's
    callbacks, however long the app takes in them). Pausing doesn't change the accounting. A run that reaches a wait
    while paused (its calls are held by the pause) answers the check from there and counts as at rest. A run still
    computing while paused is stopped as it would be otherwise. On resume, the program's next stretch starts a fresh
    budget, so the paused time never counts. Don't "reset" the stretch on pause: a loop that never waits would then
    run unchecked. The language can't
    time-slice a VM, so the crate has psychoscript's suspender stop the run at its next step, which works inside tight
    loops. A timer checks each stretch of compute; past the budget it probes the run by waking its pending host calls,
    which the VM polls as soon as it waits and can't while it computes. An unanswered probe (30 ms grace) means the run
    is still computing.
  - **Heap:** `maxHeapBytes` caps the run's heap: over it the run ends with `Failed(MemoryLimitExceeded)`. The
    contract's default for live widgets is 32 MB (`32 * 1024 * 1024`), but the crate sets no default: pass it.
    A snapshot keeps the cap it ran with.
- `deliver(json)`, `pause()`, `resume()`, `snapshot()`, `stop()`, `isRunning()`, `attachSurface(key, surface, width,
  height)`, `detachSurface(key)` ([GPU canvases](#gpu-canvases));
  `LiveRun.restore(snapshot, handler, inputName = "__input", options = LiveOptions(), transport = nil, encoder = nil)`.
  - Android, frames without JSON: `LiveFrames(run)` (Kotlin) takes a reference to the run once; each
    `frames.deliver(t, dt, width, height, scale, pointer, pointerX, pointerY, pointerDown, dark, fullscreen, close,
    closeX, closeY, closeWidth, closeHeight)` queues the message `deliver` would for
    `{"type":"frame","frame":{t, dt, width, height, scale, pointer: {x, y, down} | null, dark, fullscreen,
    close: {x, y, width, height} | null}}`, in order with the other messages, through one JNI call (no string, no
    UniFFI call); `InvalidState` once the run ended. Its `Float`s are passed exactly (`toDouble()`), not rounded to
    the decimals a JSON text would print. `frames.close()` when the run ends.
  - `pause()`: no frames, messages or timers reach the program. `sleep` timers freeze with their remaining time,
    `now()` stops, delivered messages and finished fetches are held, and nothing is scheduled. A stretch of compute in
    progress finishes first (within the slice budget). After that it costs no CPU (measured: 0 ms over 2 s).
  - `resume()`: the program's next `receive` is `{ type: "resumed", pausedMs }`, before anything delivered meanwhile.
    A program waiting in `sleep` or `fetch` finishes that first.
  - `snapshot()`: for a run paused a while (over 30 s, or when the OS asks for memory). It saves the paused run's state
    (psychoscript `suspend`), ends its thread and frees its VM, and returns the bytes. `resume()` continues it here;
    `LiveRun.restore` continues it in a later process of the same build, with input, running time and timers. Messages
    delivered but not yet received stay in the old run. It fails with `Snapshot` while a `fetch` is in flight: then
    `stop()` and start again later.
  - `stop()`: doesn't block. A waiting run wakes to an interrupt; a computing one is suspended at its next step.
    Dropping the `LiveRun` stops it.

### fetch

`options.httpsHosts` is the template's `https` capability: exact names, `*.` suffixes (not the bare domain), or `*`,
each optionally with a `:port` (`localhost:4097`) that then must match. Without it, or without a transport, every
fetch rejects with `CapabilityDenied`. The program passes `{ url, method?, headers?, body? | body64? }` and gets
`{ status, url, headers, body | body64 }`: the body is text when it's UTF-8, else base64. Headers come lowercased,
with repeats joined and `set-cookie` dropped. Rejections are errors with `kind` (`CapabilityDenied`, `Network`,
`Timeout`, `TooLarge`, `RateLimited`) and `message`.

The crate enforces:
- `https:` only, and no credentials in the URL.
- The host must be on the list, checked again on every redirect. The crate follows redirects itself, at most 5, and
  turns 303 (and 301/302 after POST) into GET.
- Methods GET, POST, PUT, PATCH, DELETE and HEAD.
- `Cookie`, `Host`, `Content-Length` and hop-by-hop request headers are dropped.
- Request body at most 256 KB, response body at most 2 MB, 15 s per fetch with its redirects included.
- At most 4 fetches in flight and 10 a second per run.
- No loopback, private, link-local, CGNAT, multicast or reserved destination, checked against the address the
  transport connects to:
  - **Resolve once:** the crate resolves the host itself (a literal IP as is) and checks every address. The transport
    gets them in `request.addresses` and must connect to one of them: OkHttp with a `Dns` that returns them (below),
    so DNS rebinding can't redirect the connection.
  - **Check again:** the address the transport reports in `remoteAddress` is checked before the program sees the
    response.
  - **iOS limitation:** URLSession resolves names itself and can't be told which address to use. The Swift sample
    reports the address it connected to (transaction metrics), so a rebound response never reaches the program.
    The request has still been sent by then.

**Dev mode** (`LiveOptions.allowLocalNetwork`, default off; on only in debug builds or by the user's choice, e.g. a
debug-settings toggle) also allows loopback, private (RFC 1918, CGNAT, IPv6 unique local) and link-local
destinations, and plain `http:` to them (never to a public address), still only for declared hosts, e.g.
`["localhost:4097"]`. iOS: plain `http:` also needs `NSAppTransportSecurity` / `NSAllowsLocalNetworking` in the
debug build's Info.plist, and local addresses need `NSLocalNetworkUsageDescription`.

The transport carries one exchange and doesn't follow redirects. It uses an ephemeral session: no cookies, cache,
credential store or client certificates. It calls `completion.succeed(...)` or `completion.fail(...)` once, from any
thread.

```swift
final class URLSessionTransport: NSObject, FetchTransport, URLSessionDataDelegate, @unchecked Sendable {
    private struct Exchange {
        let request: FetchRequest
        let completion: FetchCompletion
        var data = Data()
        var remote: String?
    }
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private var exchanges: [Int: Exchange] = [:]   // by task identifier
    private var tasks: [UInt64: URLSessionTask] = [:]
    private let lock = NSLock()

    func start(request: FetchRequest, completion: FetchCompletion) {
        guard let url = URL(string: request.url) else { return completion.fail(message: "bad URL") }
        var r = URLRequest(url: url, timeoutInterval: Double(request.timeoutMs) / 1000)
        r.httpMethod = request.method
        r.httpBody = request.body
        for h in request.headers { r.setValue(h.value, forHTTPHeaderField: h.name) }
        let task = session.dataTask(with: r)
        lock.withLock {
            exchanges[task.taskIdentifier] = Exchange(request: request, completion: completion)
            tasks[request.id] = task
        }
        task.resume()
    }

    func cancel(id: UInt64) {
        lock.withLock { tasks.removeValue(forKey: id) }?.cancel()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let over = lock.withLock { () -> Bool in
            guard var e = exchanges[dataTask.taskIdentifier] else { return false }
            e.data.append(data)
            exchanges[dataTask.taskIdentifier] = e
            return e.data.count > Int(e.request.maxResponseBytes)
        }
        if over { dataTask.cancel() }   // the crate reports TooLarge
    }

    // The address it actually connected to, which the crate checks.
    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        let remote = metrics.transactionMetrics.last?.remoteAddress
        lock.withLock { exchanges[task.taskIdentifier]?.remote = remote }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let e = lock.withLock({ () -> Exchange? in
            tasks.removeValue(forKey: exchanges[task.taskIdentifier]?.request.id ?? 0)
            return exchanges.removeValue(forKey: task.taskIdentifier)
        }) else { return }
        let over = e.data.count > Int(e.request.maxResponseBytes)
        guard let http = task.response as? HTTPURLResponse, error == nil || over else {
            return e.completion.fail(message: error?.localizedDescription ?? "no response")
        }
        let headers = http.allHeaderFields.map { HttpHeader(name: "\($0.key)", value: "\($0.value)") }
        e.completion.succeed(response: FetchResponse(
            status: UInt16(http.statusCode), headers: headers, body: e.data, remoteAddress: e.remote))
    }

    // The crate checks and follows redirects.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    // Server trust as usual; no client certificates or HTTP auth.
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust
            ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
    }
}
```

```kotlin
class OkHttpTransport : FetchTransport {
    private val client = OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false)        // the crate checks and follows redirects
        .cookieJar(CookieJar.NO_COOKIES)
        .build()
    private val calls = ConcurrentHashMap<ULong, Call>()

    override fun start(request: FetchRequest, completion: FetchCompletion) {
        val url = request.url.toHttpUrl()
        // Connect only to the addresses the crate resolved and checked (literals: no lookup). Other names (a proxy)
        // resolve as usual.
        val checked = request.addresses.map { InetAddress.getByName(it) }
        val type = request.headers.firstOrNull { it.name == "content-type" }?.value?.toMediaTypeOrNull()
        val body = request.body?.toRequestBody(type)
            ?: if (HttpMethod.requiresRequestBody(request.method)) ByteArray(0).toRequestBody(type) else null
        val builder = Request.Builder().url(url).method(request.method, body)
        request.headers.forEach { builder.addHeader(it.name, it.value) }
        val call = client.newBuilder()
            .dns { host -> if (host == url.host) checked else Dns.SYSTEM.lookup(host) }
            .callTimeout(request.timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .build()
            .newCall(builder.build())
        calls[request.id] = call
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                calls.remove(request.id); completion.fail(e.message ?: "network error")
            }
            override fun onResponse(call: Call, response: Response) {
                calls.remove(request.id)
                response.use {
                    val max = request.maxResponseBytes.toLong() + 1       // one more: the crate reports TooLarge
                    val source = it.body.source().apply { request(max) }
                    val bytes = source.buffer.readByteArray(minOf(source.buffer.size, max))
                    completion.succeed(FetchResponse(it.code.toUShort(), it.headers.map { (n, v) -> HttpHeader(n, v) }, bytes, null))
                }
            }
        })
    }

    override fun cancel(id: ULong) { calls.remove(id)?.cancel() }
}
```

## Threading and cost

`Program` and `LiveRun` are `Send + Sync`. Each live run has one thread (1 MB of stack reserved, ~136 KB resident
while idle with a small program), one timer thread shared by all, and a short-lived thread per `fetch` and per budget
stop. `run`s may come from any thread, concurrently too: each run gets its own VM over the shared
compiled program. A run is synchronous, so keep it off the main thread when it can be slow. In Kotlin, `Program` is
`AutoCloseable`: `close()` frees it right away, rather than when the GC cleaner gets to it.

What one `run` copies:

1. The input string, encoded once by UniFFI into a Rust-owned buffer that becomes the Rust `String` without another
   copy.
2. Parsed straight into the language's host value (no `serde_json::Value` in between); the first `__input()` call
   hands it over whole, and later calls parse the kept text again.
3. The VM's own values for it, the run's heap, and a small `Runtime` (a few allocations).
4. The result, as the language crate builds it (VM value, then its JSON data), written once as a JSON string that
   becomes UniFFI's return buffer without a copy, and is decoded once into a Swift/Kotlin string.

Logs (`console.log`) are kept for the run and dropped; the timeout bounds them.

## GPU canvases

With feature `widget-gpu` (on by default), a widget run replays its GPU canvases itself (opencode
`specs/v2/widgets-gpu.md`, `widget-gpu` crate): the app attaches a surface per canvas and shows placeholders; batches,
WebGPU, shader translation and presenting are this crate's.

- **The device:** one per app, shared by every widget run, made when first needed (a live run with
  `ValueEncoder.widget()`, or the first `ShaderCanvas`), never for steps, on a thread of its own: a live run's
  `__input()` doesn't wait for it, and what the program posts meanwhile replays once it is there. Metal on iOS; Vulkan
  1.1 or newer on Android 15 or newer (API 35 and up), else none. On the iOS Simulator only, whose GPU is under some of the
  spec's limits (`max_inter_stage_shader_variables` 15), the device has the Simulator's where they fall short (said once
  on stderr), and a program over them gets wgpu's validation error there; real devices have the spec's. The program's
  input gets `gpu: { available, format }`
  (`format` `bgra8unorm` on iOS, `rgba8unorm` on Android). While the device is still being made, that is
  `available: true` (where the platform has a GPU); if it then can't be made, the canvases go `unavailable` and the
  program gets `{ type: "gpu", lost: "unknown", message }`, as on a device loss (its device and handles are gone, and
  what it posts is dropped). Once it is known there is none, runs get `available: false`. After a device loss the
  crate makes a new device, tells the program (`{ type: "gpu", lost }`) and replays on it; what the program posted
  before it learned of the loss is dropped quietly. A run restored from a snapshot is a device loss too: the program
  gets `{ type: "gpu", lost: "unknown" }` before it runs on, batches naming handles from before are dropped, and the
  canvases an error stopped stay stopped (the app is told again, with `report` false); with no device, every canvas
  is `unavailable`.
- **Surfaces:** `GpuSurface.metal(layer)` (Swift, a `CAMetalLayer`, retained while the surface lives; Rust/FFI
  `GpuSurface.metalLayer(pointer:)`), `PsychoScriptGpu.surface(surface)` (Kotlin, an `android.view.Surface`, e.g.
  `SurfaceHolder.surface` in `surfaceCreated`; it holds the `ANativeWindow` until the `GpuSurface` is dropped).
- **`liveRun.attachSurface(key, surface, width, height)`:** the `gpu: true` canvas `key` (from the decoded view) is
  presented into `surface`, `width` × `height` physical pixels (its view's size × scale). The program gets that size,
  clamped to 4096 a side with the aspect kept, before its next frame; a clamped canvas is scaled to the surface. Call
  it again with the new size when the view's size changes (or with a new surface). A surface not laid out yet (a side
  0) is attached, but the program gets its size only once both sides are positive.
- **`liveRun.detachSurface(key)`:** before the surface goes (Android `surfaceDestroyed`, an iOS view leaving its
  window): once it returns (it waits for a present in progress, at most a frame), the surface is never touched again.
- **`handler.onGpuCanvas(key, state)`:** `key` the canvas, or `nil` for every GPU canvas of the run (now and later).
  On the run's thread, like the other callbacks. Show the surface for `live`, the canvas's placeholder (`poster`, else
  `alt`, else "GPU canvas not supported") for anything else:
  - `live(opaque)`: it has an image. `opaque` is whether the program configured its context `alphaMode: "opaque"`
    (the default) rather than `"premultiplied"`: no transparency (Android: `TextureView.setOpaque(opaque)`). Told as
    the canvas goes live, and again only if a reconfigure changes it. A `ShaderCanvas` (`wgsl`) is always
    premultiplied: not opaque;
  - `unavailable(reason)`: no GPU here (a client error, nothing to report). `reason` says why, worked out once when
    the canvases go unavailable: the Android version (`GPU canvases need Android 15 or newer (API 35), not API
    34`), no Vulkan adapter (wgpu's text), the GPU's Vulkan version, each limit under the spec's with the GPU's value
    and the one needed (`the GPU (Mali-G715, Vulkan, driver ...) is under the spec's limits:
    maxStorageBuffersPerShaderStage 4 (needs 8)`), or wgpu's error making the device;
  - `stopped(kind, message, report)`: an error stopped it for the rest of the run, with `message`. `report` once per
    error (`kind` `program`: report it, phase `gpu`); `kind` `client` (a driver failure, out of GPU memory, a GPU hang
    or timeout, below, a surface that failed or was lost: attach a new one; one that can't be configured says what was
    asked, its size, format, alpha and present mode, and wgpu's error);
  - `lost(reason)`: the device was lost (`reason` wgpu's: `the GPU device was lost (unknown): ...`); `live` again when
    the program draws on the new one. A canvas an error stopped isn't told `lost`: it stays stopped.

  Each `reason` and a client error's `message` are worked out once, when the state changes, never per frame, batch or
  call; the crate logs nothing. In dev mode (`widgets.md`, Failures) log them and show them under the placeholder;
  otherwise ignore them.
- **Threading:** batches replay on the run's thread, with the program's bytes in place (no copy, nothing crosses to
  Swift or Kotlin); a thread of the run's own presents (one copy of the canvas into the surface's next texture, or a
  scaled draw), so a slow, hidden or detached surface never holds up the run. Presents beyond the surface's rate are
  skipped. `attachSurface` never blocks (a new size or surface applies at the next present); `detachSurface` waits
  only for a present in progress.
- **Heavy GPU work** (`widgets-gpu.md`, GPU hang): a run's batch replays once the GPU is done with the one before its
  last, so the GPU draws a frame while the next replays, and a program whose frames take the GPU longer than the
  display's waits for it on its own thread, with at most one batch queued behind the GPU. Work still unfinished 250 ms after its submit stops the canvases it draws into: `stopped(client, "the GPU work
  hung; the canvas is stopped")`. Apple's GPUs stop work themselves sooner (after 0.05 to 0.6 s on an M5 Max) and fail
  what follows it on the queue: with the vendored wgpu-hal (`rust/vendor/`, gfx-rs/wgpu#10875; stock wgpu-hal counts
  such work finished and tells nothing) that loses the device: every run gets `lost` and draws again on a new one. A loss
  with a run's GPU work in flight is a strike against it; a second within 30 s stops every canvas of the run, the
  same `stopped(client, "the GPU work hung; the canvas is stopped")`, so a widget can't keep resetting the GPU. The
  app's thread never waits on any of it. On the iOS Simulator only, such a timeout can bring down the Simulator's
  Metal host, which then kills the app (`OS_REASON_METAL`, "Connection to SimMetalHost ... lost"), or leave other Metal
  work of the process stuck.
- **`ShaderCanvas(wgsl:, surface:, width:, height:)`:** the `wgsl` shorthand, in steps and live widgets (`widgets.md`,
  GPU canvases). It returns at once (create it on the UI thread). `render(time:, scale:, pointer:, values:)` on the
  display link at the canvas's `fps` only records the frame (a few µs); a thread of the canvas's own waits for the
  device, compiles the shader, and draws and presents the newest frame (frames faster than the surface are skipped).
  Nothing is drawn or reported before the device is ready. `render` returns, once, what stopped the canvas for good,
  its `reason` the message: `GpuFailure.program` for a WGSL error (its line the template's: report it, phase `gpu`),
  `.client` without a GPU (log it); show the placeholder then. A shader over 50 ms a frame three frames in a row stops
  on its last frame (`widgets-gpu.md`): `render` returns `.client` with reason `the shader took over 50 ms a frame,
  three frames in a row` once; log it and keep the surface (its last frame), not the placeholder. A frame the GPU hung
  on (Heavy GPU work, above) returns `.client` with `the GPU work hung; the canvas is stopped`: log it, show the
  placeholder. After a device loss it draws again on the new device. `resize(width:, height:)` takes effect at the
  next frame. Drop it before its surface goes: once dropped, it never touches the surface again (a present in progress finishes first).

```swift
let surface = try GpuSurface.metal(metalView.layer as! CAMetalLayer)
run.attachSurface(key: "scene", surface: surface, width: UInt32(w * scale), height: UInt32(h * scale))
// view leaving: run.detachSurface(key: "scene")
func onGpuCanvas(key: String?, state: GpuCanvasState) { DispatchQueue.main.async { ui.gpu(key, state) } }
```

```kotlin
override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    run.attachSurface("scene", PsychoScriptGpu.surface(holder.surface), width.toUInt(), height.toUInt())
}
override fun surfaceDestroyed(holder: SurfaceHolder) = run.detachSurface("scene")
```

## Building

```sh
rust/crates/psychoscript-mobile/scripts/build-ios.sh <out>        # macOS + Xcode -> <out>/PsychoScript (Swift package)
ANDROID_NDK_HOME=… rust/crates/psychoscript-mobile/scripts/build-android.sh <out>
                                                                  # -> <out>/jniLibs, <out>/kotlin
```

Both need the toolchain in `rust/rust-toolchain.toml` with the targets they name (`rustup target add …`), and
`cargo install cargo-ndk` for Android. They write `<out>/REVISION` (the commit) and copy this README.
`FEATURES=--no-default-features` builds the language alone; `FEATURES="--no-default-features --features widget-wire"`
the widget encoder without GPU canvases (no wgpu). The ICU data the language
crate compiles in for `Intl`-style date formatting and collation (most of the ~5 MB of read-only data) can't be left
out from this crate: that would need a feature in `psychoscript` itself.

### In an app: pin a rev, build into a gitignored directory

```sh
# scripts/psychoscript.sh in the app; .psychoscript/ and Vendor/PsychoScript/ in .gitignore
REV=<commit on anomalyco/psychoscript mobile>
[ -d .psychoscript ] || git clone https://github.com/anomalyco/psychoscript .psychoscript
git -C .psychoscript fetch origin "$REV" && git -C .psychoscript checkout --detach "$REV"
.psychoscript/rust/crates/psychoscript-mobile/scripts/build-ios.sh Vendor/PsychoScript         # iOS
# Android: ANDROID_NDK_HOME=… .psychoscript/rust/crates/psychoscript-mobile/scripts/build-android.sh vendor/psychoscript
```

- iOS: add the local package `Vendor/PsychoScript/PsychoScript` (Xcode › Add Package Dependencies › Add Local…, or
  `.package(path: "Vendor/PsychoScript/PsychoScript")`) and its product `PsychoScript` to the app target.
- Android: `android { sourceSets["main"].jniLibs.srcDir("…/vendor/psychoscript/jniLibs") }`, add
  `…/vendor/psychoscript/kotlin` as a Kotlin source dir (`sourceSets["main"].kotlin.srcDir(...)`), and
  `implementation("net.java.dev.jna:jna:5.17.0@aar")`. With R8: keep `com.sun.jna.**` and
  `com.anomalyco.psychoscript.**`, and `-dontwarn java.awt.**`.

## OpenCode widgets on this API

The widget glue lives in the apps; with this API it's a few lines. A widget template's served `program` is
`prelude + "\n" + source`, and the step ABI is one entry call:

```swift
let program = try Program(source: served.program + "\nreturn __widget_step(__input())")
let step = RunOptions(timeoutMs: 250), draw = RunOptions(timeoutMs: 8)
let out = try program.run(inputJson: #"{"phase":"init","data":\#(dataJson)}"#, options: step)   // {state, view, ...}
let frame = try program.run(inputJson: drawInputJson, options: draw)                               // {commands}
```

```kotlin
val program = Program(served.program + "\nreturn __widget_step(__input())")
val out = program.run("""{"phase":"init","data":$dataJson}""", RunOptions(timeoutMs = 250uL))
val frame = program.run(drawInputJson, RunOptions(timeoutMs = 8uL))   // a Timeout here counts as a draw overrun
```

With the binary format (widget protocol 2, a native host): the step program ends in
`return __widget_native_step(__input())` instead of `return __widget_step(__input())`, a live one in
`return await __widget_live(__input(), true)`, and the app decodes the bytes (`widgets-binary.md`) rather than parsing
JSON. Live posts arrive in `onPostsBytes`:

```swift
let wire = ValueEncoder.widget()
let program = try Program(source: served.program + "\nreturn __widget_native_step(__input())")
let liveProgram = try Program(source: served.program + "\nreturn await __widget_live(__input(), true)")
let bytes = try program.runBytes(inputJson: stepInputJson, encoder: wire, options: step)    // 01 'S' ... or 01 'D' ...
let run = try liveProgram.startLive(inputJson: input, handler: handler, options: opts, transport: t, encoder: wire)
```

```kotlin
val wire = ValueEncoder.widget()
val program = Program(served.program + "\nreturn __widget_native_step(__input())")
val liveProgram = Program(served.program + "\nreturn await __widget_live(__input(), true)")
val bytes = program.runBytes(stepInputJson, wire, RunOptions(timeoutMs = 250uL))
val run = liveProgram.startLive(input, handler, opts, transport, wire)          // handler.onPostsBytes(List<ByteArray>)
```

`examples/wire_bench.rs` times both paths on opencode's bench workloads (`tests/fixtures/workloads`).

A `wgsl` canvas, in a step or a live widget: a [`ShaderCanvas`](#gpu-canvases) per canvas, drawn on the display link.
The 16 KB source cap, the draw command cap and output parsing are the app's, per the spec.
