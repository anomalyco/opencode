declare module "bun" {
  /**
   * A status that represents the outcome of a sent message.
   *
   * - if **0**, the message was **dropped**.
   * - if **-1**, there is **backpressure** of messages.
   * - if **>0**, it represents the **number of bytes sent**.
   *
   * @example
   * ```js
   * const status = ws.send("Hello!");
   * if (status === 0) {
   *   console.log("Message was dropped");
   * } else if (status === -1) {
   *   console.log("Backpressure was applied");
   * } else {
   *   console.log(`Success! Sent ${status} bytes`);
   * }
   * ```
   */
  type ServerWebSocketSendStatus = number;

  /**
   * A state that represents if a WebSocket is connected.
   *
   * - `WebSocket.CONNECTING` is `0`, the connection is pending.
   * - `WebSocket.OPEN` is `1`, the connection is established and `send()` is possible.
   * - `WebSocket.CLOSING` is `2`, the connection is closing.
   * - `WebSocket.CLOSED` is `3`, the connection is closed or couldn't be opened.
   *
   * @link https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/readyState
   */
  type WebSocketReadyState = 0 | 1 | 2 | 3;

  /**
   * A fast WebSocket designed for servers.
   *
   * Features:
   * - **Message compression** - Messages can be compressed
   * - **Backpressure** - If the client is not ready to receive data, the server will tell you.
   * - **Dropped messages** - If the client cannot receive data, the server will tell you.
   * - **Topics** - Messages can be {@link ServerWebSocket.publish}ed to a specific topic and the client can {@link ServerWebSocket.subscribe} to topics
   *
   * This is slightly different than the browser {@link WebSocket} which Bun supports for clients.
   *
   * Powered by [uWebSockets](https://github.com/uNetworking/uWebSockets).
   *
   * @example
   * ```ts
   * Bun.serve({
   *   websocket: {
   *     open(ws) {
   *       console.log("Connected", ws.remoteAddress);
   *     },
   *     message(ws, data) {
   *       console.log("Received", data);
   *       ws.send(data);
   *     },
   *     close(ws, code, reason) {
   *       console.log("Disconnected", code, reason);
   *     },
   *   }
   * });
   * ```
   */
  interface ServerWebSocket<T = undefined> {
    /**
     * Sends a message to the client.
     *
     * @param data The data to send.
     * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
     * @example
     * ws.send("Hello!");
     * ws.send("Compress this.", true);
     * ws.send(new Uint8Array([1, 2, 3, 4]));
     */
    send(data: string | BufferSource, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Sends a text message to the client.
     *
     * @param data The data to send.
     * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
     * @example
     * ws.send("Hello!");
     * ws.send("Compress this.", true);
     */
    sendText(data: string, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Sends a binary message to the client.
     *
     * @param data The data to send.
     * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
     * @example
     * ws.send(new TextEncoder().encode("Hello!"));
     * ws.send(new Uint8Array([1, 2, 3, 4]), true);
     */
    sendBinary(data: BufferSource, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Closes the connection.
     *
     * Here is a list of close codes:
     * - `1000` means "normal closure" **(default)**
     * - `1009` means a message was too big and was rejected
     * - `1011` means the server encountered an error
     * - `1012` means the server is restarting
     * - `1013` means the server is too busy or the client is rate-limited
     * - `4000` through `4999` are reserved for applications (you can use it!)
     *
     * To close the connection abruptly, use `terminate()`.
     *
     * @param code The close code to send
     * @param reason The close reason to send
     */
    close(code?: number, reason?: string): void;

    /**
     * Abruptly close the connection.
     *
     * To gracefully close the connection, use `close()`.
     */
    terminate(): void;

    /**
     * Sends a ping.
     *
     * @param data The data to send
     */
    ping(data?: string | BufferSource): ServerWebSocketSendStatus;

    /**
     * Sends a pong.
     *
     * @param data The data to send
     */
    pong(data?: string | BufferSource): ServerWebSocketSendStatus;

    /**
     * Sends a message to subscribers of the topic.
     *
     * @param topic The topic name.
     * @param data The data to send.
     * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
     * @example
     * ws.publish("chat", "Hello!");
     * ws.publish("chat", "Compress this.", true);
     * ws.publish("chat", new Uint8Array([1, 2, 3, 4]));
     */
    publish(topic: string, data: string | BufferSource, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Sends a text message to subscribers of the topic.
     *
     * @param topic The topic name.
     * @param data The data to send.
     * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
     * @example
     * ws.publish("chat", "Hello!");
     * ws.publish("chat", "Compress this.", true);
     */
    publishText(topic: string, data: string, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Sends a binary message to subscribers of the topic.
     *
     * @param topic The topic name.
     * @param data The data to send.
     * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
     * @example
     * ws.publish("chat", new TextEncoder().encode("Hello!"));
     * ws.publish("chat", new Uint8Array([1, 2, 3, 4]), true);
     */
    publishBinary(topic: string, data: BufferSource, compress?: boolean): ServerWebSocketSendStatus;

    /**
     * Subscribes a client to the topic.
     *
     * @param topic The topic name.
     * @example
     * ws.subscribe("chat");
     */
    subscribe(topic: string): void;

    /**
     * Unsubscribes a client to the topic.
     *
     * @param topic The topic name.
     * @example
     * ws.unsubscribe("chat");
     */
    unsubscribe(topic: string): void;

    /**
     * Is the client subscribed to a topic?
     *
     * @param topic The topic name.
     * @example
     * ws.subscribe("chat");
     * console.log(ws.isSubscribed("chat")); // true
     */
    isSubscribed(topic: string): boolean;

    /**
     * Returns an array of all topics the client is currently subscribed to.
     *
     * @example
     * ws.subscribe("chat");
     * ws.subscribe("notifications");
     * console.log(ws.subscriptions); // ["chat", "notifications"]
     */
    readonly subscriptions: string[];

    /**
     * Batches `send()` and `publish()` operations, which makes it faster to send data.
     *
     * The `message`, `open`, and `drain` callbacks are automatically corked, so
     * you only need to call this if you are sending messages outside of those
     * callbacks or in async functions.
     *
     * @param callback The callback to run.
     * @example
     * ws.cork((ctx) => {
     *   ctx.send("These messages");
     *   ctx.sendText("are sent");
     *   ctx.sendBinary(new TextEncoder().encode("together!"));
     * });
     */
    cork<T = unknown>(callback: (ws: ServerWebSocket<T>) => T): T;

    /**
     * The IP address of the client.
     *
     * @example
     * console.log(socket.remoteAddress); // "127.0.0.1"
     */
    readonly remoteAddress: string;

    /**
     * The ready state of the client.
     *
     * - if `0`, the client is connecting.
     * - if `1`, the client is connected.
     * - if `2`, the client is closing.
     * - if `3`, the client is closed.
     *
     * @example
     * console.log(socket.readyState); // 1
     */
    readonly readyState: WebSocketReadyState;

    /**
     * Sets how binary data is returned in events.
     *
     * - if `nodebuffer`, binary data is returned as `Buffer` objects. **(default)**
     * - if `arraybuffer`, binary data is returned as `ArrayBuffer` objects.
     * - if `uint8array`, binary data is returned as `Uint8Array` objects.
     *
     * @example
     * let ws: WebSocket;
     * ws.binaryType = "uint8array";
     * ws.addEventListener("message", ({ data }) => {
     *   console.log(data instanceof Uint8Array); // true
     * });
     */
    binaryType?: "nodebuffer" | "arraybuffer" | "uint8array";

    /**
     * Custom data that you can assign to a client, can be read and written at any time.
     *
     * @example
     * import { serve } from "bun";
     *
     * serve({
     *   fetch(request, server) {
     *     const data = {
     *       accessToken: request.headers.get("Authorization"),
     *     };
     *     if (server.upgrade(request, { data })) {
     *       return;
     *     }
     *     return new Response();
     *   },
     *   websocket: {
     *     data: {} as {accessToken: string | null},
     *     message(ws) {
     *       console.log(ws.data.accessToken);
     *     }
     *   }
     * });
     */
    data: T;

    getBufferedAmount(): number;
  }

  /**
   * Compression options for WebSocket messages.
   */
  type WebSocketCompressor =
    | "disable"
    | "shared"
    | "dedicated"
    | "3KB"
    | "4KB"
    | "8KB"
    | "16KB"
    | "32KB"
    | "64KB"
    | "128KB"
    | "256KB";

  /**
   * Create a server-side {@link ServerWebSocket} handler for use with {@link Bun.serve}
   *
   * @example
   * ```ts
   * import { websocket, serve } from "bun";
   *
   * serve<{name: string}>({
   *   port: 3000,
   *   websocket: {
   *     open: (ws) => {
   *       console.log("Client connected");
   *    },
   *     message: (ws, message) => {
   *       console.log(`${ws.data.name}: ${message}`);
   *    },
   *     close: (ws) => {
   *       console.log("Client disconnected");
   *    },
   *  },
   *
   *   fetch(req, server) {
   *     const url = new URL(req.url);
   *     if (url.pathname === "/chat") {
   *       const upgraded = server.upgrade(req, {
   *         data: {
   *           name: new URL(req.url).searchParams.get("name"),
   *        },
   *      });
   *       if (!upgraded) {
   *         return new Response("Upgrade failed", { status: 400 });
   *      }
   *      return;
   *    }
   *     return new Response("Hello World");
   *  },
   * });
   * ```
   */
  interface WebSocketHandler<T> {
    /**
     * Specify the type for the {@link ServerWebSocket.data} property on
     * connecting websocket clients. You can pass this value when you make a
     * call to {@link Server.upgrade}.
     *
     * This pattern exists in Bun due to a [TypeScript limitation (#26242)](https://github.com/microsoft/TypeScript/issues/26242)
     *
     * @example
     * ```ts
     * Bun.serve({
     *   websocket: {
     *     data: {} as { name: string }, // ← Specify the type of `ws.data` like this
     *     message: (ws, message) => console.log(ws.data.name, 'says:', message);
     *   },
     *   // ...
     * });
     * ```
     */
    data?: T;

    /**
     * Called when the server receives an incoming message.
     *
     * If the message is not a `string`, its type is based on the value of `binaryType`.
     * - if `nodebuffer`, then the message is a `Buffer`.
     * - if `arraybuffer`, then the message is an `ArrayBuffer`.
     * - if `uint8array`, then the message is a `Uint8Array`.
     *
     * @param ws The websocket that sent the message
     * @param message The message received
     */
    message(ws: ServerWebSocket<T>, message: string | Buffer<ArrayBuffer>): void | Promise<void>;

    /**
     * Called when a connection is opened.
     *
     * @param ws The websocket that was opened
     */
    open?(ws: ServerWebSocket<T>): void | Promise<void>;

    /**
     * Called when a connection was previously under backpressure,
     * meaning it had too many queued messages, but is now ready to receive more data.
     *
     * @param ws The websocket that is ready for more data
     */
    drain?(ws: ServerWebSocket<T>): void | Promise<void>;

    /**
     * Called when a connection is closed.
     *
     * @param ws The websocket that was closed
     * @param code The close code
     * @param reason The close reason
     */
    close?(ws: ServerWebSocket<T>, code: number, reason: string): void | Promise<void>;

    /**
     * Called when a ping is sent.
     *
     * @param ws The websocket that received the ping
     * @param data The data sent with the ping
     */
    ping?(ws: ServerWebSocket<T>, data: Buffer): void | Promise<void>;

    /**
     * Called when a pong is received.
     *
     * @param ws The websocket that received the ping
     * @param data The data sent with the ping
     */
    pong?(ws: ServerWebSocket<T>, data: Buffer): void | Promise<void>;

    /**
     * Sets the maximum size of messages in bytes.
     *
     * Default is 16 MB, or `1024 * 1024 * 16` in bytes.
     */
    maxPayloadLength?: number;

    /**
     * Sets the maximum number of bytes that can be buffered on a single connection.
     *
     * Default is 16 MB, or `1024 * 1024 * 16` in bytes.
     */
    backpressureLimit?: number;

    /**
     * Sets if the connection should be closed if `backpressureLimit` is reached.
     *
     * @default false
     */
    closeOnBackpressureLimit?: boolean;

    /**
     * Sets the number of seconds to wait before timing out a connection
     * due to no messages or pings.
     *
     * @default 120
     */
    idleTimeout?: number;

    /**
     * Should `ws.publish()` also send a message to `ws` (itself), if it is subscribed?
     *
     * @default false
     */
    publishToSelf?: boolean;

    /**
     * Should the server automatically send and respond to pings to clients?
     *
     * @default true
     */
    sendPings?: boolean;

    /**
     * Sets the compression level for messages, for clients that supports it. By default, compression is disabled.
     *
     * @default false
     */
    perMessageDeflate?:
      | boolean
      | {
          /**
           * Sets the compression level.
           */
          compress?: WebSocketCompressor | boolean;
          /**
           * Sets the decompression level.
           */
          decompress?: WebSocketCompressor | boolean;
        };
  }

  namespace Serve {
    type ExtractRouteParams<T> = string extends T
      ? Record<string, string>
      : T extends `${string}:${infer Param}/${infer Rest}`
        ? { [K in Param]: string } & ExtractRouteParams<Rest>
        : T extends `${string}:${infer Param}`
          ? { [K in Param]: string }
          : T extends `${string}*`
            ? {}
            : {};

    /**
     * Development configuration for {@link Bun.serve}
     */
    type Development =
      | boolean
      | {
          /**
           * Enable Hot Module Replacement for routes (including React Fast Refresh, if React is in use)
           *
           * @default true if process.env.NODE_ENV !== 'production'
           *
           */
          hmr?: boolean;

          /**
           * Enable console log streaming from browser to server
           * @default false
           */
          console?: boolean;

          /**
           * Enable automatic workspace folders for Chrome DevTools
           *
           * This lets you persistently edit files in the browser. It works by adding the following route to the server:
           * `/.well-known/appspecific/com.chrome.devtools.json`
           *
           * The response is a JSON object with the following shape:
           * ```json
           * {
           *   "workspace": {
           *     "root": "<cwd>",
           *     "uuid": "<uuid>"
           *   }
           * }
           * ```
           *
           * The `root` field is the current working directory of the server.
           * The `"uuid"` field is a hash of the file that started the server and a hash of the current working directory.
           *
           * For security reasons, if the remote socket address is not from localhost, 127.0.0.1, or ::1, the request is ignored.
           * @default true
           */
          chromeDevToolsAutomaticWorkspaceFolders?: boolean;
        };

    type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

    type Handler<Req extends Request, S, Res> = (request: Req, server: S) => MaybePromise<Res>;

    type BaseRouteValue = Response | false | HTMLBundle | BunFile;

    type Routes<WebSocketData, R extends string> = {
      [Path in R]:
        | BaseRouteValue
        | Handler<BunRequest<Path>, Server<WebSocketData>, Response>
        | Partial<Record<HTTPMethod, Handler<BunRequest<Path>, Server<WebSocketData>, Response> | Response>>;
    };

    type RoutesWithUpgrade<WebSocketData, R extends string> = {
      [Path in R]:
        | BaseRouteValue
        | Handler<BunRequest<Path>, Server<WebSocketData>, Response | undefined | void>
        | Partial<
            Record<HTTPMethod, Handler<BunRequest<Path>, Server<WebSocketData>, Response | undefined | void> | Response>
          >;
    };

    type FetchOrRoutes<WebSocketData, R extends string> =
      | {
          /**
           * Handle HTTP requests
           *
           * Respond to {@link Request} objects with a {@link Response} object.
           */
          fetch?(this: Server<WebSocketData>, req: Request, server: Server<WebSocketData>): MaybePromise<Response>;

          routes: Routes<WebSocketData, R>;
        }
      | {
          /**
           * Handle HTTP requests
           *
           * Respond to {@link Request} objects with a {@link Response} object.
           */
          fetch(this: Server<WebSocketData>, req: Request, server: Server<WebSocketData>): MaybePromise<Response>;

          routes?: Routes<WebSocketData, R>;
        };

    type FetchOrRoutesWithWebSocket<WebSocketData, R extends string> = {
      /**
       * Enable websockets with {@link Bun.serve}
       *
       * Upgrade a {@link Request} to a {@link ServerWebSocket} via {@link Server.upgrade}
       *
       * Pass `data` in {@link Server.upgrade} to attach data to the {@link ServerWebSocket.data} property
       *
       * @example
       * ```js
       * const server: Bun.Server = Bun.serve({
       *  websocket: {
       *    open: (ws) => {
       *      console.log("Client connected");
       *    },
       *    message: (ws, message) => {
       *      console.log("Client sent message", message);
       *    },
       *    close: (ws) => {
       *      console.log("Client disconnected");
       *    },
       *  },
       *  fetch(req, server) {
       *    const url = new URL(req.url);
       *    if (url.pathname === "/chat") {
       *      const upgraded = server.upgrade(req);
       *      if (!upgraded) {
       *        return new Response("Upgrade failed", { status: 400 });
       *      }
       *    }
       *    return new Response("Hello World");
       *  },
       * });
       * ```
       */
      websocket: WebSocketHandler<WebSocketData>;
    } & (
      | {
          /**
           * Handle HTTP requests, or call {@link Server.upgrade} and return early
           *
           * Respond to {@link Request} objects with a {@link Response} object.
           */
          fetch?(
            this: Server<WebSocketData>,
            req: Request,
            server: Server<WebSocketData>,
          ): MaybePromise<Response | void | undefined>;

          routes: RoutesWithUpgrade<WebSocketData, R>;
        }
      | {
          /**
           * Handle HTTP requests, or call {@link Server.upgrade} and return early
           *
           * Respond to {@link Request} objects with a {@link Response} object.
           */
          fetch(
            this: Server<WebSocketData>,
            req: Request,
            server: Server<WebSocketData>,
          ): MaybePromise<Response | void | undefined>;

          routes?: RoutesWithUpgrade<WebSocketData, R>;
        }
    );

    interface BaseServeOptions<WebSocketData> {
      /**
       * Set options for using TLS with this server
       *
       * @example
       * ```ts
       * const server = Bun.serve({
       *   fetch: request => new Response("Welcome to Bun!"),
       *   tls: {
       *     cert: Bun.file("cert.pem"),
       *     key: Bun.file("key.pem"),
       *     ca: [Bun.file("ca1.pem"), Bun.file("ca2.pem")],
       *   },
       * });
       * ```
       */
      tls?: TLSOptions | TLSOptions[];

      /**
       * What is the maximum size of a request body? (in bytes)
       * @default 1024 * 1024 * 128 // 128MB
       */
      maxRequestBodySize?: number;

      /**
       * Render contextual errors? This enables bun's error page
       * @default process.env.NODE_ENV !== 'production'
       */
      development?: Development;

      /**
       * Callback called when an error is thrown during request handling
       * @param error The error that was thrown
       * @returns A response to send to the client
       *
       * @example
       * ```ts
       * error: (error) => {
       *   return new Response("Internal Server Error", { status: 500 });
       * }
       * ```
       */
      error?: (this: Server<WebSocketData>, error: ErrorLike) => Response | Promise<Response> | void | Promise<void>;

      /**
       * Uniquely identify a server instance with an ID
       *
       * ---
       *
       * **When bun is started with the `--hot` flag**:
       *
       * This string will be used to hot reload the server without interrupting
       * pending requests or websockets. If not provided, a value will be
       * generated. To disable hot reloading, set this value to `null`.
       *
       * **When bun is not started with the `--hot` flag**:
       *
       * This string will currently do nothing. But in the future it could be useful for logs or metrics.
       */
      id?: string | null;
    }

    interface HostnamePortServeOptions<WebSocketData> extends BaseServeOptions<WebSocketData> {
      /**
       * What hostname should the server listen on?
       *
       * @default
       * ```js
       * "0.0.0.0" // listen on all interfaces
       * ```
       * @example
       *  ```js
       * "127.0.0.1" // Only listen locally
       * ```
       * @example
       * ```js
       * "remix.run" // Only listen on remix.run
       * ````
       *
       * note: hostname should not include a {@link port}
       */
      hostname?: "0.0.0.0" | "127.0.0.1" | "localhost" | (string & {});

      /**
       * What port should the server listen on?
       * @default process.env.PORT || "3000"
       */
      port?: string | number;

      /**
       * Whether the `SO_REUSEPORT` flag should be set.
       *
       * This allows multiple processes to bind to the same port, which is useful for load balancing.
       *
       * @default false
       */
      reusePort?: boolean;

      /**
       * Whether the `IPV6_V6ONLY` flag should be set.
       * @default false
       */
      ipv6Only?: boolean;

      /**
       * Also listen for HTTP/3 (QUIC) on the same port. Requires {@link tls}.
       * @default false
       * @experimental
       */
      http3?: boolean;

      /**
       * Listen for HTTP/1.1 over TCP. Set to `false` together with
       * `http3: true` to serve HTTP/3 only.
       * @default true
       * @experimental
       */
      http1?: boolean;

      /**
       * Sets the number of seconds to wait before timing out a connection
       * due to inactivity.
       *
       * @default 10
       */
      idleTimeout?: number;
    }

    interface UnixServeOptions<WebSocketData> extends BaseServeOptions<WebSocketData> {
      /**
       * If set, the HTTP server will listen on a unix socket instead of a port.
       * (Cannot be used with hostname+port)
       */
      unix?: string;
    }

    /**
     * The type of options that can be passed to {@link serve}, with support for
     * `routes` and a safer requirement for `fetch`
     *
     * @example
     * ```ts
     * export default {
     *   fetch: req => Response.json(req.url),
     *
     *   websocket: {
     *     message(ws) {
     *       ws.data.name; // string
     *     },
     *   },
     * } satisfies Bun.Serve.Options<{ name: string }>;
     * ```
     */
    type Options<WebSocketData, R extends string = string> = Bun.__internal.XOR<
      HostnamePortServeOptions<WebSocketData>,
      UnixServeOptions<WebSocketData>
    > &
      Bun.__internal.XOR<FetchOrRoutes<WebSocketData, R>, FetchOrRoutesWithWebSocket<WebSocketData, R>>;
  }

  interface BunRequest<T extends string = string> extends Request {
    readonly params: {
      [Key in keyof Serve.ExtractRouteParams<T>]: Serve.ExtractRouteParams<T>[Key];
    } & {};
    readonly cookies: CookieMap;
    clone(): BunRequest<T>;
  }

  /**
   * HTTP & HTTPS Server
   *
   * To start the server, see {@link serve}
   *
   * For performance, Bun pre-allocates most of the data for 2048 concurrent requests.
   * That means starting a new server allocates about 500 KB of memory. Try to
   * avoid starting and stopping the server often (unless it's a new instance of bun).
   *
   * Powered by a fork of [uWebSockets](https://github.com/uNetworking/uWebSockets). Thank you \@alexhultman.
   */
  interface Server<WebSocketData> extends Disposable {
    /**
     * Stop listening to prevent new connections from being accepted.
     *
     * By default, it does not cancel in-flight requests or websockets. That means it may take some time before all network activity stops.
     *
     * @param closeActiveConnections Immediately terminate in-flight requests, websockets, and stop accepting new connections.
     * @default false
     */
    stop(closeActiveConnections?: boolean): Promise<void>;

    /**
     * Update the `fetch` and `error` handlers without restarting the server.
     *
     * This is useful if you want to change the behavior of your server without
     * restarting it or for hot reloading.
     *
     * @example
     *
     * ```js
     * // create the server
     * const server = Bun.serve({
     *  fetch(request) {
     *    return new Response("Hello World v1")
     *  }
     * });
     *
     * // Update the server to return a different response
     * server.reload({
     *   fetch(request) {
     *     return new Response("Hello World v2")
     *   }
     * });
     * ```
     *
     * Passing other options such as `port` or `hostname` won't do anything.
     */
    reload<R extends string>(options: Serve.Options<WebSocketData, R>): Server<WebSocketData>;

    /**
     * Mock the fetch handler for a running server.
     *
     * This feature is not fully implemented yet. It doesn't normalize URLs
     * consistently in all cases and it doesn't yet call the `error` handler
     * consistently. This needs to be fixed
     */
    fetch(request: Request | string): Response | Promise<Response>;

    /**
     * Upgrade a {@link Request} to a {@link ServerWebSocket}
     *
     * @param request The {@link Request} to upgrade
     * @param options Pass headers or attach data to the {@link ServerWebSocket}
     *
     * @returns `true` if the upgrade was successful and `false` if it failed
     *
     * @example
     * ```js
     * import { serve } from "bun";
     * const server: Bun.Server<{ user: string }> = serve({
     *   websocket: {
     *     open: (ws) => {
     *       console.log("Client connected");
     *     },
     *     message: (ws, message) => {
     *       console.log("Client sent message", message);
     *     },
     *     close: (ws) => {
     *       console.log("Client disconnected");
     *     },
     *   },
     *   fetch(req, server) {
     *     const url = new URL(req.url);
     *     if (url.pathname === "/chat") {
     *       const upgraded = server.upgrade(req, {
     *         data: {user: "John Doe"}
     *       });
     *       if (!upgraded) {
     *         return new Response("Upgrade failed", { status: 400 });
     *       }
     *     }
     *     return new Response("Hello World");
     *   },
     * });
     * ```
     *
     * What you pass to `data` is available on the {@link ServerWebSocket.data} property
     */
    upgrade(
      request: Request,
      ...options: [WebSocketData] extends [undefined]
        ? [
            options?: {
              /**
               */
              headers?: HeadersInit;

              /**
               * Data to store on the WebSocket instance
               *
               * ---
               *
               * **Surprised this line is erroring?**
               *
               * Tell TypeScript about the WebSocket data by using `Bun.Server<MyWebSocketData>`
               *
               * ```ts
               * const server: Bun.Server<MyWebSocketData> = Bun.serve({
               *      fetch: (req, server) => {
               *          const didUpgrade = server.upgrade(req, {
               *              data: { ... }, // Works now!
               *          });
               *      },
               * });
               * ```
               */
              data?: undefined;
            },
          ]
        : [
            options: {
              /**
               * Send any additional headers while upgrading, like cookies
               */
              headers?: HeadersInit;

              /**
               * Data to store on the WebSocket instance
               */
              data: WebSocketData;
            },
          ]
    ): boolean;

    /**
     * Send a message to all connected {@link ServerWebSocket} subscribed to a topic
     *
     * @param topic The topic to publish to
     * @param data The data to send
     * @param compress Should the data be compressed? Ignored if the client does not support compression.
     *
     * @returns 0 if the message was dropped, -1 if backpressure was applied, or the number of bytes sent.
     *
     * @example
     *
     * ```js
     * server.publish("chat", "Hello World");
     * ```
     *
     * @example
     * ```js
     * server.publish("chat", new Uint8Array([1, 2, 3, 4]));
     * ```
     *
     * @example
     * ```js
     * server.publish("chat", new ArrayBuffer(4), true);
     * ```
     *
     * @example
     * ```js
     * server.publish("chat", new DataView(new ArrayBuffer(4)));
     * ```
     */
    publish(
      topic: string,
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
      compress?: boolean,
    ): ServerWebSocketSendStatus;

    /**
     * A count of connections subscribed to a given topic
     *
     * This operation will loop through each topic internally to get the count.
     *
     * @param topic the websocket topic to check how many subscribers are connected to
     * @returns the number of subscribers
     */
    subscriberCount(topic: string): number;

    /**
     * Returns the client IP address and port of the given Request. If the request was closed or is a unix socket, returns null.
     *
     * @example
     * ```js
     * export default {
     *  async fetch(request, server) {
     *    return new Response(server.requestIP(request));
     *  }
     * }
     * ```
     */
    requestIP(request: Request): SocketAddress | null;

    /**
     * Reset the idleTimeout of the given Request to the number in seconds. 0 means no timeout.
     *
     * @example
     * ```js
     * export default {
     *  async fetch(request, server) {
     *    server.timeout(request, 60);
     *    await Bun.sleep(30000);
     *    return new Response("30 seconds have passed");
     *  }
     * }
     * ```
     */
    timeout(request: Request, seconds: number): void;

    /**
     * Undo a call to {@link Server.unref}
     *
     * If the Server has already been stopped, this does nothing.
     *
     * If {@link Server.ref} is called multiple times, this does nothing. Think of it as a boolean toggle.
     */
    ref(): void;

    /**
     * Don't keep the process alive if this server is the only thing left.
     * Active connections may continue to keep the process alive.
     *
     * By default, the server is ref'd.
     *
     * To prevent new connections from being accepted, use {@link Server.stop}
     */
    unref(): void;

    /**
     * How many requests are in-flight right now?
     */
    readonly pendingRequests: number;

    /**
     * How many {@link ServerWebSocket}s are in-flight right now?
     */
    readonly pendingWebSockets: number;

    readonly url: URL;

    /**
     * The port the server is listening on.
     *
     * This will be undefined when the server is listening on a unix socket.
     *
     * @example
     * ```js
     * 3000
     * ```
     */
    readonly port: number | undefined;

    /**
     * The hostname the server is listening on. Does not include the port.
     *
     * This will be `undefined` when the server is listening on a unix socket.
     *
     * @example
     * ```js
     * "localhost"
     * ```
     */
    readonly hostname: string | undefined;

    /**
     * The protocol the server is listening on.
     *
     * - "http" for normal servers
     * - "https" when TLS is enabled
     * - null for unix sockets or when unavailable
     */
    readonly protocol: "http" | "https" | null;

    /**
     * Is the server running in development mode?
     *
     * In development mode, `Bun.serve()` returns rendered error messages with
     * stack traces instead of a generic 500 error. This makes debugging easier,
     * but development mode shouldn't be used in production or you will risk
     * leaking sensitive information.
     */
    readonly development: boolean;

    /**
     * An identifier of the server instance
     *
     * When bun is started with the `--hot` flag, this ID is used to hot reload the server without interrupting pending requests or websockets.
     *
     * When bun is not started with the `--hot` flag, this ID is currently unused.
     */
    readonly id: string;
  }

  /**
   * Bun.serve provides a high-performance HTTP server with built-in routing support.
   * It enables both function-based and object-based route handlers with type-safe
   * parameters and method-specific handling.
   *
   * @param options Server configuration options
   *
   * @example
   * **Basic Usage**
   *
   * ```ts
   * Bun.serve({
   *   port: 3000,
   *   fetch(req) {
   *     return new Response("Hello World");
   *   }
   * });
   * ```
   *
   * @example
   * **Route-based Handlers**
   *
   * ```ts
   * Bun.serve({
   *   routes: {
   *     // Static responses
   *     "/": new Response("Home page"),
   *
   *     // Function handlers with type-safe parameters
   *     "/users/:id": (req) => {
   *       // req.params.id is typed as string
   *       return new Response(`User ${req.params.id}`);
   *     },
   *
   *     // Method-specific handlers
   *     "/api/posts": {
   *       GET: () => new Response("Get posts"),
   *       POST: async (req) => {
   *         const body = await req.json();
   *         return new Response("Created post");
   *       },
   *       DELETE: (req) => new Response("Deleted post")
   *     },
   *
   *     // Wildcard routes
   *     "/static/*": (req) => {
   *       // Handle any path under /static/
   *       return new Response("Static file");
   *     },
   *
   *     // Disable route (fall through to fetch handler)
   *     "/api/legacy": false
   *   },
   *
   *   // Fallback handler for unmatched routes
   *   fetch(req) {
   *     return new Response("Not Found", { status: 404 });
   *   }
   * });
   * ```
   *
   * @example
   * **Path Parameters**
   *
   * ```ts
   * Bun.serve({
   *   routes: {
   *     // Single parameter
   *     "/users/:id": (req: BunRequest<"/users/:id">) => {
   *       return new Response(`User ID: ${req.params.id}`);
   *     },
   *
   *     // Multiple parameters
   *     "/posts/:postId/comments/:commentId": (
   *       req: BunRequest<"/posts/:postId/comments/:commentId">
   *     ) => {
   *       return new Response(JSON.stringify(req.params));
   *       // Output: {"postId": "123", "commentId": "456"}
   *     }
   *   }
   * });
   * ```
   *
   * @example
   * **Route Precedence**
   *
   * ```ts
   * // Routes are matched in the following order:
   * // 1. Exact static routes ("/about")
   * // 2. Parameter routes ("/users/:id")
   * // 3. Wildcard routes ("/api/*")
   *
   * Bun.serve({
   *   routes: {
   *     "/api/users": () => new Response("Users list"),
   *     "/api/users/:id": (req) => new Response(`User ${req.params.id}`),
   *     "/api/*": () => new Response("API catchall"),
   *     "/*": () => new Response("Root catchall")
   *   }
   * });
   * ```
   *
   * @example
   * **Error Handling**
   *
   * ```ts
   * Bun.serve({
   *   routes: {
   *     "/error": () => {
   *       throw new Error("Something went wrong");
   *     }
   *   },
   *   error(error) {
   *     // Custom error handler
   *     console.error(error);
   *     return new Response(`Error: ${error.message}`, {
   *       status: 500
   *     });
   *   }
   * });
   * ```
   *
   * @example
   * **Server Lifecycle**
   *
   * ```ts
   * const server = Bun.serve({
   *   // Server config...
   * });
   *
   * // Update routes at runtime
   * server.reload({
   *   routes: {
   *     "/": () => new Response("Updated route")
   *   }
   * });
   *
   * // Stop the server
   * server.stop();
   * ```
   *
   * @example
   * **Development Mode**
   *
   * ```ts
   * Bun.serve({
   *   development: true, // Enable hot reloading
   *   routes: {
   *     // Routes will auto-reload on changes
   *   }
   * });
   * ```
   *
   * @example
   * **Type-Safe Request Handling**
   *
   * ```ts
   * type Post = {
   *   id: string;
   *   title: string;
   * };
   *
   * Bun.serve({
   *  routes: {
   *     "/api/posts/:id": async (
   *       req: BunRequest<"/api/posts/:id">
   *     ) => {
   *       if (req.method === "POST") {
   *         const body: Post = await req.json();
   *         return Response.json(body);
   *       }
   *       return new Response("Method not allowed", {
   *         status: 405
   *       });
   *     }
   *   }
   * });
   * ```
   */
  function serve<WebSocketData = undefined, R extends string = never>(
    options: Serve.Options<WebSocketData, R>,
  ): Server<WebSocketData>;
}
