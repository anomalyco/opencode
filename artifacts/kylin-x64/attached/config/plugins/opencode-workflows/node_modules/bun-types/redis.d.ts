declare module "bun" {
  export interface RedisOptions {
    /**
     * Connection timeout in milliseconds
     * @default 10000
     */
    connectionTimeout?: number;

    /**
     * Idle timeout in milliseconds
     * @default 0 (no timeout)
     */
    idleTimeout?: number;

    /**
     * Whether to automatically reconnect
     * @default true
     */
    autoReconnect?: boolean;

    /**
     * Maximum number of reconnection attempts
     * @default 10
     */
    maxRetries?: number;

    /**
     * Whether to queue commands when disconnected
     * @default true
     */
    enableOfflineQueue?: boolean;

    /**
     * TLS options
     * Can be a boolean or an object with TLS options
     */
    tls?: boolean | Bun.TLSOptions;

    /**
     * Whether to enable auto-pipelining
     * @default true
     */
    enableAutoPipelining?: boolean;
  }

  export namespace RedisClient {
    type KeyLike = string | ArrayBufferView | Blob;
    type StringPubSubListener = (message: string, channel: string) => void;

    // Buffer subscriptions are not yet implemented
    // type BufferPubSubListener = (message: Uint8Array<ArrayBuffer>, channel: string) => void;
  }

  export class RedisClient {
    /**
     * Creates a new Redis client
     *
     * @param url URL to connect to, defaults to `process.env.VALKEY_URL`,
     * `process.env.REDIS_URL`, or `"valkey://localhost:6379"`
     * @param options Additional options
     *
     * @example
     * ```ts
     * const redis = new RedisClient();
     * await redis.set("hello", "world");
     * console.log(await redis.get("hello"));
     * ```
     */
    constructor(url?: string, options?: RedisOptions);

    /**
     * Whether the client is connected to the Redis server
     */
    readonly connected: boolean;

    /**
     * Amount of data buffered in bytes
     */
    readonly bufferedAmount: number;

    /**
     * Callback fired when the client connects to the Redis server
     */
    onconnect: ((this: RedisClient) => void) | null;

    /**
     * Callback fired when the client disconnects from the Redis server
     *
     * @param error The error that caused the disconnection
     */
    onclose: ((this: RedisClient, error: Error) => void) | null;

    /**
     * Connect to the Redis server
     *
     * @returns A promise that resolves when connected
     */
    connect(): Promise<void>;

    /**
     * Disconnect from the Redis server
     */
    close(): void;

    /**
     * Send a raw command to the Redis server
     * @param command The command to send
     * @param args The arguments to the command
     * @returns A promise that resolves with the command result
     */
    send(command: string, args: string[]): Promise<any>;

    /**
     * Get the value of a key
     * @param key The key to get
     * @returns Promise that resolves with the key's value as a string, or null if the key doesn't exist
     */
    get(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the value of a key as a Uint8Array
     * @param key The key to get
     * @returns Promise that resolves with the key's value as a Uint8Array, or null if the key doesn't exist
     */
    getBuffer(key: RedisClient.KeyLike): Promise<Uint8Array<ArrayBuffer> | null>;

    /**
     * Set key to hold the string value
     * @param key The key to set
     * @param value The value to set
     * @returns Promise that resolves with "OK" on success
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<"OK">;

    /**
     * Set key to hold the string value with expiration
     * @param key The key to set
     * @param value The value to set
     * @param ex Set the specified expire time, in seconds
     * @returns Promise that resolves with "OK" on success
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, ex: "EX", seconds: number): Promise<"OK">;

    /**
     * Set key to hold the string value with expiration
     * @param key The key to set
     * @param value The value to set
     * @param px Set the specified expire time, in milliseconds
     * @returns Promise that resolves with "OK" on success
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, px: "PX", milliseconds: number): Promise<"OK">;

    /**
     * Set key to hold the string value with expiration at a specific Unix
     * timestamp
     * @param key The key to set
     * @param value The value to set
     * @param exat Set the specified Unix time at which the key will expire, in
     * seconds
     * @returns Promise that resolves with "OK" on success
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, exat: "EXAT", timestampSeconds: number): Promise<"OK">;

    /**
     * Set key to hold the string value with expiration at a specific Unix timestamp
     * @param key The key to set
     * @param value The value to set
     * @param pxat Set the specified Unix time at which the key will expire, in milliseconds
     * @returns Promise that resolves with "OK" on success
     */
    set(
      key: RedisClient.KeyLike,
      value: RedisClient.KeyLike,
      pxat: "PXAT",
      timestampMilliseconds: number,
    ): Promise<"OK">;

    /**
     * Set key to hold the string value only if key does not exist
     * @param key The key to set
     * @param value The value to set
     * @param nx Only set the key if it does not already exist
     * @returns Promise that resolves with "OK" on success, or null if the key
     * already exists
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, nx: "NX"): Promise<"OK" | null>;

    /**
     * Set key to hold the string value only if key already exists
     * @param key The key to set
     * @param value The value to set
     * @param xx Only set the key if it already exists
     * @returns Promise that resolves with "OK" on success, or null if the key
     * does not exist
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, xx: "XX"): Promise<"OK" | null>;

    /**
     * Set key to hold the string value and return the old value
     * @param key The key to set
     * @param value The value to set
     * @param get Return the old string stored at key, or null if key did not
     * exist
     * @returns Promise that resolves with the old value, or null if key did not
     * exist
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, get: "GET"): Promise<string | null>;

    /**
     * Set key to hold the string value and retain the time to live
     * @param key The key to set
     * @param value The value to set
     * @param keepttl Retain the time to live associated with the key
     * @returns Promise that resolves with "OK" on success
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, keepttl: "KEEPTTL"): Promise<"OK">;

    /**
     * Set key to hold the string value with various options
     * @param key The key to set
     * @param value The value to set
     * @param options Array of options (EX, PX, EXAT, PXAT, NX, XX, KEEPTTL, GET)
     * @returns Promise that resolves with "OK" on success, null if NX/XX condition not met, or the old value if GET is specified
     */
    set(key: RedisClient.KeyLike, value: RedisClient.KeyLike, ...options: string[]): Promise<"OK" | string | null>;

    /**
     * Delete a key(s)
     * @param keys The keys to delete
     * @returns Promise that resolves with the number of keys removed
     */
    del(...keys: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Increment the integer value of a key by one
     * @param key The key to increment
     * @returns Promise that resolves with the new value
     */
    incr(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Increment the integer value of a key by the given amount
     * @param key The key to increment
     * @param increment The amount to increment by
     * @returns Promise that resolves with the new value after incrementing
     */
    incrby(key: RedisClient.KeyLike, increment: number): Promise<number>;

    /**
     * Increment the float value of a key by the given amount
     * @param key The key to increment
     * @param increment The amount to increment by (can be a float)
     * @returns Promise that resolves with the new value as a string after incrementing
     */
    incrbyfloat(key: RedisClient.KeyLike, increment: number | string): Promise<string>;

    /**
     * Decrement the integer value of a key by one
     * @param key The key to decrement
     * @returns Promise that resolves with the new value
     */
    decr(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Decrement the integer value of a key by the given amount
     * @param key The key to decrement
     * @param decrement The amount to decrement by
     * @returns Promise that resolves with the new value after decrementing
     */
    decrby(key: RedisClient.KeyLike, decrement: number): Promise<number>;

    /**
     * Determine if a key exists
     * @param key The key to check
     * @returns Promise that resolves with true if the key exists, false
     * otherwise
     */
    exists(key: RedisClient.KeyLike): Promise<boolean>;

    /**
     * Set a key's time to live in seconds
     * @param key The key to set the expiration for
     * @param seconds The number of seconds until expiration
     * @returns Promise that resolves with 1 if the timeout was set, 0 if not
     */
    expire(key: RedisClient.KeyLike, seconds: number): Promise<number>;

    /**
     * Set the expiration for a key as a Unix timestamp (in seconds)
     * @param key The key to set expiration on
     * @param timestamp Unix timestamp in seconds when the key should expire
     * @returns Promise that resolves with 1 if timeout was set, 0 if key does not exist
     */
    expireat(key: RedisClient.KeyLike, timestamp: number): Promise<number>;

    /**
     * Set a key's time to live in milliseconds
     * @param key The key to set the expiration for
     * @param milliseconds The number of milliseconds until expiration
     * @returns Promise that resolves with 1 if the timeout was set, 0 if the key does not exist
     */
    pexpire(key: RedisClient.KeyLike, milliseconds: number): Promise<number>;

    /**
     * Get the time to live for a key in seconds
     * @param key The key to get the TTL for
     * @returns Promise that resolves with the TTL, -1 if no expiry, or -2 if
     * key doesn't exist
     */
    ttl(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Set the value of a hash field or multiple fields
     * @param key The hash key
     * @param fields Object/Record with field-value pairs
     * @returns Promise that resolves with the number of fields that were added
     */
    hset(key: RedisClient.KeyLike, fields: Record<string | number, RedisClient.KeyLike | number>): Promise<number>;

    /**
     * Set the value of a hash field or multiple fields (variadic)
     * @param key The hash key
     * @param field The field name
     * @param value The value to set
     * @param rest Additional field-value pairs
     * @returns Promise that resolves with the number of fields that were added
     */
    hset(
      key: RedisClient.KeyLike,
      field: RedisClient.KeyLike,
      value: RedisClient.KeyLike,
      ...rest: RedisClient.KeyLike[]
    ): Promise<number>;

    /**
     * Set the value of a hash field, only if the field does not exist
     * @param key The hash key
     * @param field The field to set
     * @param value The value to set
     * @returns Promise that resolves with true if field was set, false if field already exists
     */
    hsetnx(key: RedisClient.KeyLike, field: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<boolean>;

    /**
     * Get and delete one or more hash fields (Redis 8.0.0+)
     * Syntax: HGETDEL key FIELDS numfields field [field ...]
     * @param key The hash key
     * @param fieldsKeyword Must be the literal string "FIELDS"
     * @param numfields Number of fields to follow
     * @param fields The field names to get and delete
     * @returns Promise that resolves with array of field values (null for non-existent fields)
     * @example redis.hgetdel("mykey", "FIELDS", 2, "field1", "field2")
     */
    hgetdel(
      key: RedisClient.KeyLike,
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<Array<string | null>>;

    /**
     * Get hash field values with expiration options (Redis 8.0.0+)
     * Syntax: HGETEX key [EX seconds | PX milliseconds | EXAT unix-time-seconds | PXAT unix-time-milliseconds | PERSIST] FIELDS numfields field [field ...]
     * @example redis.hgetex("mykey", "FIELDS", 1, "field1")
     * @example redis.hgetex("mykey", "EX", 10, "FIELDS", 1, "field1")
     * @example redis.hgetex("mykey", "PX", 5000, "FIELDS", 2, "field1", "field2")
     * @example redis.hgetex("mykey", "PERSIST", "FIELDS", 1, "field1")
     */
    //prettier-ignore
    hgetex(key: RedisClient.KeyLike, fieldsKeyword: "FIELDS", numfields: number, ...fields: RedisClient.KeyLike[]): Promise<Array<string | null>>;
    //prettier-ignore
    hgetex(key: RedisClient.KeyLike, ex: "EX", seconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fields: RedisClient.KeyLike[]): Promise<Array<string | null>>;
    //prettier-ignore
    hgetex(key: RedisClient.KeyLike, px: "PX", milliseconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fields: RedisClient.KeyLike[]): Promise<Array<string | null>>;
    //prettier-ignore
    hgetex(key: RedisClient.KeyLike, exat: "EXAT", unixTimeSeconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fields: RedisClient.KeyLike[]): Promise<Array<string | null>>;
    //prettier-ignore
    hgetex(key: RedisClient.KeyLike, pxat: "PXAT", unixTimeMilliseconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fields: RedisClient.KeyLike[]): Promise<Array<string | null>>;
    //prettier-ignore
    hgetex(key: RedisClient.KeyLike, persist: "PERSIST", fieldsKeyword: "FIELDS", numfields: number, ...fields: RedisClient.KeyLike[]): Promise<Array<string | null>>;

    /**
     * Set hash fields with expiration options (Redis 8.0.0+)
     * Syntax: HSETEX key [FNX | FXX] [EX seconds | PX milliseconds | EXAT unix-time-seconds | PXAT unix-time-milliseconds | KEEPTTL] FIELDS numfields field value [field value ...]
     * @example redis.hsetex("mykey", "FIELDS", 1, "field1", "value1")
     * @example redis.hsetex("mykey", "EX", 10, "FIELDS", 1, "field1", "value1")
     * @example redis.hsetex("mykey", "FNX", "EX", 10, "FIELDS", 1, "field1", "value1")
     */
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fnx: "FNX", fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fxx: "FXX", fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, ex: "EX", seconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, px: "PX", milliseconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, exat: "EXAT", unixTimeSeconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, pxat: "PXAT", unixTimeMilliseconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, keepttl: "KEEPTTL", fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fnx: "FNX", ex: "EX", seconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fnx: "FNX", px: "PX", milliseconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fnx: "FNX", exat: "EXAT", unixTimeSeconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fnx: "FNX", pxat: "PXAT", unixTimeMilliseconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fnx: "FNX", keepttl: "KEEPTTL", fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fxx: "FXX", ex: "EX", seconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fxx: "FXX", px: "PX", milliseconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fxx: "FXX", exat: "EXAT", unixTimeSeconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fxx: "FXX", pxat: "PXAT", unixTimeMilliseconds: number, fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;
    //prettier-ignore
    hsetex(key: RedisClient.KeyLike, fxx: "FXX", keepttl: "KEEPTTL", fieldsKeyword: "FIELDS", numfields: number, ...fieldValues: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Set expiration for hash fields (Redis 7.4+)
     * Syntax: HEXPIRE key seconds [NX | XX | GT | LT] FIELDS numfields field [field ...]
     * @returns Array where each element is: -2 (field doesn't exist), 0 (condition not met), 1 (expiration set), 2 (field deleted)
     * @example redis.hexpire("mykey", 10, "FIELDS", 1, "field1")
     * @example redis.hexpire("mykey", 10, "NX", "FIELDS", 2, "field1", "field2")
     */
    hexpire(
      key: RedisClient.KeyLike,
      seconds: number,
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;
    hexpire(
      key: RedisClient.KeyLike,
      seconds: number,
      condition: "NX" | "XX" | "GT" | "LT",
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;

    /**
     * Set expiration for hash fields using Unix timestamp in seconds (Redis 7.4+)
     * Syntax: HEXPIREAT key unix-time-seconds [NX | XX | GT | LT] FIELDS numfields field [field ...]
     * @returns Array where each element is: -2 (field doesn't exist), 0 (condition not met), 1 (expiration set), 2 (field deleted)
     * @example redis.hexpireat("mykey", 1735689600, "FIELDS", 1, "field1")
     */
    hexpireat(
      key: RedisClient.KeyLike,
      unixTimeSeconds: number,
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;
    hexpireat(
      key: RedisClient.KeyLike,
      unixTimeSeconds: number,
      condition: "NX" | "XX" | "GT" | "LT",
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;

    /**
     * Get expiration time of hash fields as Unix timestamp in seconds (Redis 7.4+)
     * Syntax: HEXPIRETIME key FIELDS numfields field [field ...]
     * @returns Array where each element is: -2 (field doesn't exist), -1 (no expiration), Unix timestamp in seconds
     * @example redis.hexpiretime("mykey", "FIELDS", 2, "field1", "field2")
     */
    hexpiretime(
      key: RedisClient.KeyLike,
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;

    /**
     * Remove expiration from hash fields (Redis 7.4+)
     * Syntax: HPERSIST key FIELDS numfields field [field ...]
     * @returns Array where each element is: -2 (field doesn't exist), -1 (no expiration), 1 (expiration removed)
     * @example redis.hpersist("mykey", "FIELDS", 1, "field1")
     */
    hpersist(
      key: RedisClient.KeyLike,
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;

    /**
     * Set expiration for hash fields in milliseconds (Redis 7.4+)
     * Syntax: HPEXPIRE key milliseconds [NX | XX | GT | LT] FIELDS numfields field [field ...]
     * @returns Array where each element is: -2 (field doesn't exist), 0 (condition not met), 1 (expiration set), 2 (field deleted)
     * @example redis.hpexpire("mykey", 10000, "FIELDS", 1, "field1")
     */
    hpexpire(
      key: RedisClient.KeyLike,
      milliseconds: number,
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;
    hpexpire(
      key: RedisClient.KeyLike,
      milliseconds: number,
      condition: "NX" | "XX" | "GT" | "LT",
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;

    /**
     * Set expiration for hash fields using Unix timestamp in milliseconds (Redis 7.4+)
     * Syntax: HPEXPIREAT key unix-time-milliseconds [NX | XX | GT | LT] FIELDS numfields field [field ...]
     * @returns Array where each element is: -2 (field doesn't exist), 0 (condition not met), 1 (expiration set), 2 (field deleted)
     * @example redis.hpexpireat("mykey", 1735689600000, "FIELDS", 1, "field1")
     */
    hpexpireat(
      key: RedisClient.KeyLike,
      unixTimeMilliseconds: number,
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;
    hpexpireat(
      key: RedisClient.KeyLike,
      unixTimeMilliseconds: number,
      condition: "NX" | "XX" | "GT" | "LT",
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;

    /**
     * Get expiration time of hash fields as Unix timestamp in milliseconds (Redis 7.4+)
     * Syntax: HPEXPIRETIME key FIELDS numfields field [field ...]
     * @returns Array where each element is: -2 (field doesn't exist), -1 (no expiration), Unix timestamp in milliseconds
     * @example redis.hpexpiretime("mykey", "FIELDS", 2, "field1", "field2")
     */
    hpexpiretime(
      key: RedisClient.KeyLike,
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;

    /**
     * Get TTL of hash fields in milliseconds (Redis 7.4+)
     * Syntax: HPTTL key FIELDS numfields field [field ...]
     * @returns Array where each element is: -2 (field doesn't exist), -1 (no expiration), TTL in milliseconds
     * @example redis.hpttl("mykey", "FIELDS", 2, "field1", "field2")
     */
    hpttl(
      key: RedisClient.KeyLike,
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;

    /**
     * Get TTL of hash fields in seconds (Redis 7.4+)
     * Syntax: HTTL key FIELDS numfields field [field ...]
     * @returns Array where each element is: -2 (field doesn't exist), -1 (no expiration), TTL in seconds
     * @example redis.httl("mykey", "FIELDS", 2, "field1", "field2")
     */
    httl(
      key: RedisClient.KeyLike,
      fieldsKeyword: "FIELDS",
      numfields: number,
      ...fields: RedisClient.KeyLike[]
    ): Promise<number[]>;

    /**
     * Set multiple hash fields to multiple values
     *
     * @deprecated Use {@link hset} instead. Since Redis 4.0.0, `HSET` supports multiple field-value pairs.
     *
     * @param key The hash key
     * @param fields Object/Record with field-value pairs
     * @returns Promise that resolves with "OK"
     */
    hmset(key: RedisClient.KeyLike, fields: Record<string | number, RedisClient.KeyLike | number>): Promise<"OK">;

    /**
     * Set multiple hash fields to multiple values (variadic)
     *
     * @deprecated Use {@link hset} instead. Since Redis 4.0.0, `HSET` supports multiple field-value pairs.
     *
     * @param key The hash key
     * @param field The field name
     * @param value The value to set
     * @param rest Additional field-value pairs
     * @returns Promise that resolves with "OK"
     */
    hmset(
      key: RedisClient.KeyLike,
      field: RedisClient.KeyLike,
      value: RedisClient.KeyLike,
      ...rest: RedisClient.KeyLike[]
    ): Promise<"OK">;

    /**
     * Set multiple hash fields to multiple values (array syntax, backward compat)
     *
     * @deprecated Use {@link hset} instead. Since Redis 4.0.0, `HSET` supports multiple field-value pairs.
     *
     * @param key The hash key
     * @param fieldValues An array of alternating field names and values
     * @returns Promise that resolves with "OK"
     */
    hmset(key: RedisClient.KeyLike, fieldValues: RedisClient.KeyLike[]): Promise<"OK">;

    /**
     * Get the value of a hash field
     * @param key The hash key
     * @param field The field to get
     * @returns Promise that resolves with the field value or null if the field doesn't exist
     */
    hget(key: RedisClient.KeyLike, field: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the values of all the given hash fields
     * @param key The hash key
     * @param fields The fields to get
     * @returns Promise that resolves with an array of values
     */
    hmget(key: RedisClient.KeyLike, ...fields: string[]): Promise<Array<string | null>>;

    /**
     * Get the values of all the given hash fields
     * @param key The hash key
     * @param fields The fields to get
     * @returns Promise that resolves with an array of values
     */
    hmget(key: RedisClient.KeyLike, fields: string[]): Promise<Array<string | null>>;

    /**
     * Delete one or more hash fields
     * @param key The hash key
     * @param field The field to delete
     * @param rest Additional fields to delete
     * @returns Promise that resolves with the number of fields that were removed
     */
    hdel(key: RedisClient.KeyLike, field: RedisClient.KeyLike, ...rest: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Determine if a hash field exists
     * @param key The hash key
     * @param field The field to check
     * @returns Promise that resolves with true if the field exists, false otherwise
     */
    hexists(key: RedisClient.KeyLike, field: RedisClient.KeyLike): Promise<boolean>;

    /**
     * Get one or multiple random fields from a hash
     * @param key The hash key
     * @returns Promise that resolves with a random field name, or null if the hash doesn't exist
     */
    hrandfield(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get one or multiple random fields from a hash
     * @param key The hash key
     * @param count The number of fields to return (positive for unique fields, negative for potentially duplicate fields)
     * @returns Promise that resolves with an array of random field names
     */
    hrandfield(key: RedisClient.KeyLike, count: number): Promise<string[]>;

    /**
     * Get one or multiple random fields with values from a hash
     * @param key The hash key
     * @param count The number of fields to return
     * @param withValues Literal "WITHVALUES" to include values
     * @returns Promise that resolves with an array of alternating field names and values
     */
    hrandfield(key: RedisClient.KeyLike, count: number, withValues: "WITHVALUES"): Promise<[string, string][]>;

    /**
     * Incrementally iterate hash fields and values
     * @param key The hash key
     * @param cursor The cursor value (0 to start iteration)
     * @returns Promise that resolves with [next_cursor, [field1, value1, field2, value2, ...]]
     */
    hscan(key: RedisClient.KeyLike, cursor: number | string): Promise<[string, string[]]>;

    /**
     * Incrementally iterate hash fields and values with pattern matching
     * @param key The hash key
     * @param cursor The cursor value (0 to start iteration)
     * @param match Literal "MATCH"
     * @param pattern Pattern to match field names against
     * @returns Promise that resolves with [next_cursor, [field1, value1, field2, value2, ...]]
     */
    hscan(
      key: RedisClient.KeyLike,
      cursor: number | string,
      match: "MATCH",
      pattern: string,
    ): Promise<[string, string[]]>;

    /**
     * Incrementally iterate hash fields and values with count limit
     * @param key The hash key
     * @param cursor The cursor value (0 to start iteration)
     * @param count Literal "COUNT"
     * @param limit Maximum number of fields to return per call
     * @returns Promise that resolves with [next_cursor, [field1, value1, field2, value2, ...]]
     */
    hscan(
      key: RedisClient.KeyLike,
      cursor: number | string,
      count: "COUNT",
      limit: number,
    ): Promise<[string, string[]]>;

    /**
     * Incrementally iterate hash fields and values with pattern and count
     * @param key The hash key
     * @param cursor The cursor value (0 to start iteration)
     * @param match Literal "MATCH"
     * @param pattern Pattern to match field names against
     * @param count Literal "COUNT"
     * @param limit Maximum number of fields to return per call
     * @returns Promise that resolves with [next_cursor, [field1, value1, field2, value2, ...]]
     */
    hscan(
      key: RedisClient.KeyLike,
      cursor: number | string,
      match: "MATCH",
      pattern: string,
      count: "COUNT",
      limit: number,
    ): Promise<[string, string[]]>;

    /**
     * Check if a value is a member of a set
     * @param key The set key
     * @param member The member to check
     * @returns Promise that resolves with true if the member exists, false
     * otherwise
     */
    sismember(key: RedisClient.KeyLike, member: string): Promise<boolean>;

    /**
     * Add one or more members to a set
     * @param key The set key
     * @param members The members to add
     * @returns Promise that resolves with the number of members added
     */
    sadd(key: RedisClient.KeyLike, ...members: string[]): Promise<number>;

    /**
     * Remove one or more members from a set
     * @param key The set key
     * @param members The members to remove
     * @returns Promise that resolves with the number of members removed
     */
    srem(key: RedisClient.KeyLike, ...members: string[]): Promise<number>;

    /**
     * Move a member from one set to another
     * @param source The source set key
     * @param destination The destination set key
     * @param member The member to move
     * @returns Promise that resolves with true if the element was moved, false if it wasn't a member of source
     */
    smove(source: RedisClient.KeyLike, destination: RedisClient.KeyLike, member: string): Promise<boolean>;

    /**
     * Get all the members in a set
     * @param key The set key
     * @returns Promise that resolves with an array of all members
     */
    smembers(key: RedisClient.KeyLike): Promise<string[]>;

    /**
     * Get a random member from a set
     * @param key The set key
     * @returns Promise that resolves with a random member, or null if the set
     * is empty
     */
    srandmember(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get count random members from a set
     * @param key The set key
     * @returns Promise that resolves with an array of up to count random members, or null if the set
     * doesn't exist
     */
    srandmember(key: RedisClient.KeyLike, count: number): Promise<string[] | null>;

    /**
     * Remove and return a random member from a set
     * @param key The set key
     * @returns Promise that resolves with the removed member, or null if the
     * set is empty
     */
    spop(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Remove and return count members from the set
     * @param key The set key
     * @returns Promise that resolves with the removed members, or null if the
     * set is empty
     */
    spop(key: RedisClient.KeyLike, count: number): Promise<string[] | null>;

    /**
     * Post a message to a shard channel
     * @param channel The shard channel name
     * @param message The message to publish
     * @returns Promise that resolves with the number of clients that received the message
     */
    spublish(channel: RedisClient.KeyLike, message: string): Promise<number>;

    /**
     * Store the difference of multiple sets in a key
     * @param destination The destination key to store the result
     * @param key The first set key
     * @param keys Additional set keys to subtract from the first set
     * @returns Promise that resolves with the number of elements in the resulting set
     */
    sdiffstore(
      destination: RedisClient.KeyLike,
      key: RedisClient.KeyLike,
      ...keys: RedisClient.KeyLike[]
    ): Promise<number>;

    /**
     * Check if multiple members are members of a set
     * @param key The set key
     * @param member The first member to check
     * @param members Additional members to check
     * @returns Promise that resolves with an array of 1s and 0s indicating membership
     */
    smismember(
      key: RedisClient.KeyLike,
      member: RedisClient.KeyLike,
      ...members: RedisClient.KeyLike[]
    ): Promise<number[]>;

    /**
     * Incrementally iterate over a set
     * @param key The set key
     * @param cursor The cursor value
     * @param args Additional SSCAN options (MATCH pattern, COUNT hint)
     * @returns Promise that resolves with a tuple [cursor, members[]]
     */
    sscan(key: RedisClient.KeyLike, cursor: number | string, ...args: (string | number)[]): Promise<[string, string[]]>;

    /**
     * Increment the integer value of a hash field by the given number
     * @param key The hash key
     * @param field The field to increment
     * @param increment The amount to increment by
     * @returns Promise that resolves with the new value
     */
    hincrby(key: RedisClient.KeyLike, field: string, increment: string | number): Promise<number>;

    /**
     * Increment the float value of a hash field by the given amount
     * @param key The hash key
     * @param field The field to increment
     * @param increment The amount to increment by
     * @returns Promise that resolves with the new value as a string
     */
    hincrbyfloat(key: RedisClient.KeyLike, field: string, increment: string | number): Promise<string>;

    /**
     * Get all the fields and values in a hash
     * @param key The hash key
     * @returns Promise that resolves with an object containing all fields and values, or empty object if key does not exist
     */
    hgetall(key: RedisClient.KeyLike): Promise<Record<string, string>>;

    /**
     * Get all field names in a hash
     * @param key The hash key
     * @returns Promise that resolves with an array of field names
     */
    hkeys(key: RedisClient.KeyLike): Promise<string[]>;

    /**
     * Get the number of fields in a hash
     * @param key The hash key
     * @returns Promise that resolves with the number of fields
     */
    hlen(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the string length of the value stored in a hash field
     * @param key The hash key
     * @param field The field name
     * @returns Promise that resolves with the length of the string value, or 0 if the field doesn't exist
     */
    hstrlen(key: RedisClient.KeyLike, field: string): Promise<number>;

    /**
     * Get all values in a hash
     * @param key The hash key
     * @returns Promise that resolves with an array of values
     */
    hvals(key: RedisClient.KeyLike): Promise<string[]>;

    /**
     * Find all keys matching the given pattern
     * @param pattern The pattern to match
     * @returns Promise that resolves with an array of matching keys
     */
    keys(pattern: string): Promise<string[]>;

    /**
     * Blocking pop from head of one or more lists
     *
     * Blocks until an element is available in one of the lists or the timeout expires.
     * Checks keys in order and pops from the first non-empty list.
     *
     * @param args Keys followed by timeout in seconds (can be fractional, 0 = block indefinitely)
     * @returns Promise that resolves with [key, element] or null on timeout
     *
     * @example
     * ```ts
     * // Block for up to 1 second
     * const result = await redis.blpop("mylist", 1.0);
     * if (result) {
     *   const [key, element] = result;
     *   console.log(`Popped ${element} from ${key}`);
     * }
     *
     * // Block indefinitely (timeout = 0)
     * const result2 = await redis.blpop("list1", "list2", 0);
     * ```
     */
    blpop(...args: (RedisClient.KeyLike | number)[]): Promise<[string, string] | null>;

    /**
     * Blocking pop from tail of one or more lists
     *
     * Blocks until an element is available in one of the lists or the timeout expires.
     * Checks keys in order and pops from the first non-empty list.
     *
     * @param args Keys followed by timeout in seconds (can be fractional, 0 = block indefinitely)
     * @returns Promise that resolves with [key, element] or null on timeout
     *
     * @example
     * ```ts
     * // Block for up to 1 second
     * const result = await redis.brpop("mylist", 1.0);
     * if (result) {
     *   const [key, element] = result;
     *   console.log(`Popped ${element} from ${key}`);
     * }
     *
     * // Block indefinitely (timeout = 0)
     * const result2 = await redis.brpop("list1", "list2", 0);
     * ```
     */
    brpop(...args: (RedisClient.KeyLike | number)[]): Promise<[string, string] | null>;

    /**
     * Blocking move from one list to another
     *
     * Atomically moves an element from source to destination list, blocking until an element is available
     * or the timeout expires. Allows specifying which end to pop from (LEFT/RIGHT) and which end to push to (LEFT/RIGHT).
     *
     * @param source Source list key
     * @param destination Destination list key
     * @param from Direction to pop from source: "LEFT" or "RIGHT"
     * @param to Direction to push to destination: "LEFT" or "RIGHT"
     * @param timeout Timeout in seconds (can be fractional, 0 = block indefinitely)
     * @returns Promise that resolves with the moved element or null on timeout
     *
     * @example
     * ```ts
     * // Move from right of source to left of destination (like BRPOPLPUSH)
     * const element = await redis.blmove("mylist", "otherlist", "RIGHT", "LEFT", 1.0);
     * if (element) {
     *   console.log(`Moved element: ${element}`);
     * }
     *
     * // Move from left to left
     * await redis.blmove("list1", "list2", "LEFT", "LEFT", 0.5);
     * ```
     */
    blmove(
      source: RedisClient.KeyLike,
      destination: RedisClient.KeyLike,
      from: "LEFT" | "RIGHT",
      to: "LEFT" | "RIGHT",
      timeout: number,
    ): Promise<string | null>;

    /**
     * Blocking pop multiple elements from lists
     *
     * Blocks until an element is available from one of the specified lists or the timeout expires.
     * Can pop from the LEFT or RIGHT end and optionally pop multiple elements at once using COUNT.
     *
     * @param timeout Timeout in seconds (can be fractional, 0 = block indefinitely)
     * @param numkeys Number of keys that follow
     * @param args Keys, direction ("LEFT" or "RIGHT"), and optional COUNT modifier
     * @returns Promise that resolves with [key, [elements]] or null on timeout
     *
     * @example
     * ```ts
     * // Pop from left end of first available list, wait 1 second
     * const result = await redis.blmpop(1.0, 2, "list1", "list2", "LEFT");
     * if (result) {
     *   const [key, elements] = result;
     *   console.log(`Popped from ${key}: ${elements.join(", ")}`);
     * }
     *
     * // Pop 3 elements from right end
     * const result2 = await redis.blmpop(0.5, 1, "mylist", "RIGHT", "COUNT", 3);
     * // Returns: ["mylist", ["elem1", "elem2", "elem3"]] or null if timeout
     * ```
     */
    blmpop(timeout: number, numkeys: number, ...args: (string | number)[]): Promise<[string, string[]] | null>;

    /**
     * Blocking right pop from source and left push to destination
     *
     * Atomically pops an element from the tail of source list and pushes it to the head of destination list,
     * blocking until an element is available or the timeout expires. This is the blocking version of RPOPLPUSH.
     *
     * @param source Source list key
     * @param destination Destination list key
     * @param timeout Timeout in seconds (can be fractional, 0 = block indefinitely)
     * @returns Promise that resolves with the moved element or null on timeout
     *
     * @example
     * ```ts
     * // Block for up to 1 second
     * const element = await redis.brpoplpush("tasks", "processing", 1.0);
     * if (element) {
     *   console.log(`Processing task: ${element}`);
     * } else {
     *   console.log("No tasks available");
     * }
     *
     * // Block indefinitely (timeout = 0)
     * const task = await redis.brpoplpush("queue", "active", 0);
     * ```
     */
    brpoplpush(source: RedisClient.KeyLike, destination: RedisClient.KeyLike, timeout: number): Promise<string | null>;

    /**
     * Get element at index from a list
     * @param key The list key
     * @param index Zero-based index (negative indexes count from the end, -1 is last element)
     * @returns Promise that resolves with the element at index, or null if index is out of range
     *
     * @example
     * ```ts
     * await redis.lpush("mylist", "three", "two", "one");
     * console.log(await redis.lindex("mylist", 0)); // "one"
     * console.log(await redis.lindex("mylist", -1)); // "three"
     * console.log(await redis.lindex("mylist", 5)); // null
     * ```
     */
    lindex(key: RedisClient.KeyLike, index: number): Promise<string | null>;

    /**
     * Get the length of a list
     * @param key The list key
     * @returns Promise that resolves with the length of the list
     */
    llen(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Atomically pop an element from a source list and push it to a destination list
     *
     * Pops an element from the source list (from LEFT or RIGHT) and pushes it
     * to the destination list (to LEFT or RIGHT).
     *
     * @param source The source list key
     * @param destination The destination list key
     * @param from Direction to pop from source: "LEFT" (head) or "RIGHT" (tail)
     * @param to Direction to push to destination: "LEFT" (head) or "RIGHT" (tail)
     * @returns Promise that resolves with the element moved, or null if the source list is empty
     *
     * @example
     * ```ts
     * await redis.lpush("source", "a", "b", "c");
     * const result1 = await redis.lmove("source", "dest", "LEFT", "RIGHT");
     * // result1: "c" (popped from head of source, pushed to tail of dest)
     *
     * const result2 = await redis.lmove("source", "dest", "RIGHT", "LEFT");
     * // result2: "a" (popped from tail of source, pushed to head of dest)
     * ```
     */
    lmove(
      source: RedisClient.KeyLike,
      destination: RedisClient.KeyLike,
      from: "LEFT" | "RIGHT",
      to: "LEFT" | "RIGHT",
    ): Promise<string | null>;

    /**
     * Remove and get the first element in a list
     * @param key The list key
     * @returns Promise that resolves with the first element, or null if the list is empty
     */
    lpop(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Remove and get the first count elements in a list
     * @param key The list key
     * @returns Promise that resolves with a list of elements, or null if the list doesn't exist
     */
    lpop(key: RedisClient.KeyLike, count: number): Promise<string[] | null>;

    /**
     * Find the position(s) of an element in a list
     *
     * Returns the index of matching elements inside a Redis list.
     * By default, returns the index of the first match. Use RANK to find the nth occurrence,
     * COUNT to get multiple positions, and MAXLEN to limit the search.
     *
     * @param key The list key
     * @param element The element to search for
     * @param options Optional arguments: "RANK", rank, "COUNT", num, "MAXLEN", len
     * @returns Promise that resolves with the index (number), an array of indices (number[]),
     *          or null if element is not found. Returns array when COUNT option is used.
     *
     * @example
     * ```ts
     * await redis.lpush("mylist", "a", "b", "c", "b", "d");
     * const pos1 = await redis.lpos("mylist", "b");
     * // pos1: 1 (first occurrence of "b")
     *
     * const pos2 = await redis.lpos("mylist", "b", "RANK", 2);
     * // pos2: 3 (second occurrence of "b")
     *
     * const positions = await redis.lpos("mylist", "b", "COUNT", 0);
     * // positions: [1, 3] (all occurrences of "b")
     *
     * const pos3 = await redis.lpos("mylist", "x");
     * // pos3: null (element not found)
     * ```
     */
    lpos(
      key: RedisClient.KeyLike,
      element: RedisClient.KeyLike,
      ...options: (string | number)[]
    ): Promise<number | number[] | null>;

    /**
     * Pop one or more elements from one or more lists
     *
     * Pops elements from the first non-empty list in the specified order (LEFT = from head, RIGHT = from tail).
     * Optionally specify COUNT to pop multiple elements at once.
     *
     * @param numkeys The number of keys that follow
     * @param args Keys followed by LEFT or RIGHT, optionally followed by "COUNT" and count value
     * @returns Promise that resolves with [key, [elements]] or null if all lists are empty
     *
     * @example
     * ```ts
     * await redis.lpush("list1", "a", "b", "c");
     * const result1 = await redis.lmpop(1, "list1", "LEFT");
     * // result1: ["list1", ["c"]]
     *
     * const result2 = await redis.lmpop(1, "list1", "RIGHT", "COUNT", 2);
     * // result2: ["list1", ["a", "b"]]
     *
     * const result3 = await redis.lmpop(2, "emptylist", "list1", "LEFT");
     * // result3: null (if both lists are empty)
     * ```
     */
    lmpop(numkeys: number, ...args: (string | number)[]): Promise<[string, string[]] | null>;

    /**
     * Get a range of elements from a list
     * @param key The list key
     * @param start Zero-based start index (negative indexes count from the end)
     * @param stop Zero-based stop index (negative indexes count from the end)
     * @returns Promise that resolves with array of elements in the specified range
     *
     * @example
     * ```ts
     * await redis.lpush("mylist", "three", "two", "one");
     * console.log(await redis.lrange("mylist", 0, -1)); // ["one", "two", "three"]
     * console.log(await redis.lrange("mylist", 0, 1)); // ["one", "two"]
     * console.log(await redis.lrange("mylist", -2, -1)); // ["two", "three"]
     * ```
     */
    lrange(key: RedisClient.KeyLike, start: number, stop: number): Promise<string[]>;

    /**
     * Set element at index in a list
     * @param key The list key
     * @param index Zero-based index (negative indexes count from the end)
     * @param element The value to set
     * @returns Promise that resolves with "OK" on success
     *
     * @example
     * ```ts
     * await redis.lpush("mylist", "three", "two", "one");
     * await redis.lset("mylist", 0, "zero");
     * console.log(await redis.lrange("mylist", 0, -1)); // ["zero", "two", "three"]
     * await redis.lset("mylist", -1, "last");
     * console.log(await redis.lrange("mylist", 0, -1)); // ["zero", "two", "last"]
     * ```
     */
    lset(key: RedisClient.KeyLike, index: number, element: RedisClient.KeyLike): Promise<string>;

    /**
     * Remove the expiration from a key
     * @param key The key to persist
     * @returns Promise that resolves with 1 if the timeout was removed, 0 if
     * the key doesn't exist or has no timeout
     */
    persist(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Set the expiration for a key as a Unix timestamp in milliseconds
     * @param key The key to set expiration on
     * @param millisecondsTimestamp Unix timestamp in milliseconds when the key should expire
     * @returns Promise that resolves with 1 if timeout was set, 0 if key does not exist
     */
    pexpireat(key: RedisClient.KeyLike, millisecondsTimestamp: number): Promise<number>;

    /**
     * Get the expiration time of a key as a UNIX timestamp in milliseconds
     * @param key The key to check
     * @returns Promise that resolves with the timestamp, or -1 if the key has
     * no expiration, or -2 if the key doesn't exist
     */
    pexpiretime(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the time to live for a key in milliseconds
     * @param key The key to check
     * @returns Promise that resolves with the TTL in milliseconds, or -1 if the
     * key has no expiration, or -2 if the key doesn't exist
     */
    pttl(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Return a random key from the keyspace
     *
     * Returns a random key from the currently selected database.
     *
     * @returns Promise that resolves with a random key name, or null if the
     * database is empty
     *
     * @example
     * ```ts
     * await redis.set("key1", "value1");
     * await redis.set("key2", "value2");
     * await redis.set("key3", "value3");
     * const randomKey = await redis.randomkey();
     * console.log(randomKey); // One of: "key1", "key2", or "key3"
     * ```
     */
    randomkey(): Promise<string | null>;

    /**
     * Remove and get the last element in a list
     * @param key The list key
     * @returns Promise that resolves with the last element, or null if the list is empty
     */
    rpop(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Remove and get the last element in a list
     * @param key The list key
     * @returns Promise that resolves with the last element, or null if the list is empty
     */
    rpop(key: RedisClient.KeyLike, count: number): Promise<string[]>;

    /**
     * Atomically pop the last element from a source list and push it to the head of a destination list
     *
     * This is equivalent to LMOVE with "RIGHT" "LEFT". It's an atomic operation that removes
     * the last element (tail) from the source list and pushes it to the head of the destination list.
     *
     * @param source The source list key
     * @param destination The destination list key
     * @returns Promise that resolves with the element moved, or null if the source list is empty
     *
     * @example
     * ```ts
     * await redis.lpush("source", "a", "b", "c");
     * // source: ["c", "b", "a"]
     *
     * const result = await redis.rpoplpush("source", "dest");
     * // result: "a" (removed from tail of source, added to head of dest)
     * // source: ["c", "b"]
     * // dest: ["a"]
     * ```
     */
    rpoplpush(source: RedisClient.KeyLike, destination: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Incrementally iterate the keyspace
     *
     * The SCAN command is used to incrementally iterate over a collection of
     * elements. SCAN iterates the set of keys in the currently selected Redis
     * database.
     *
     * SCAN is a cursor based iterator. This means that at every call of the
     * command, the server returns an updated cursor that the user needs to use
     * as the cursor argument in the next call.
     *
     * An iteration starts when the cursor is set to "0", and terminates when
     * the cursor returned by the server is "0".
     *
     * @param cursor The cursor value (use "0" to start a new iteration)
     * @returns Promise that resolves with a tuple [cursor, keys[]] where cursor
     * is the next cursor to use (or "0" if iteration is complete) and keys is
     * an array of matching keys
     *
     * @example
     * ```ts
     * // Basic scan - iterate all keys
     * let cursor = "0";
     * const allKeys: string[] = [];
     * do {
     *   const [nextCursor, keys] = await redis.scan(cursor);
     *   allKeys.push(...keys);
     *   cursor = nextCursor;
     * } while (cursor !== "0");
     * ```
     *
     * @example
     * ```ts
     * // Scan with MATCH pattern
     * const [cursor, keys] = await redis.scan("0", "MATCH", "user:*");
     * ```
     *
     * @example
     * ```ts
     * // Scan with COUNT hint
     * const [cursor, keys] = await redis.scan("0", "COUNT", "100");
     * ```
     */
    scan(cursor: string | number): Promise<[string, string[]]>;

    /**
     * Incrementally iterate the keyspace with a pattern match
     *
     * @param cursor The cursor value (use "0" to start a new iteration)
     * @param match The "MATCH" keyword
     * @param pattern The pattern to match (supports glob-style patterns like "user:*")
     * @returns Promise that resolves with a tuple [cursor, keys[]]
     */
    scan(cursor: string | number, match: "MATCH", pattern: string): Promise<[string, string[]]>;

    /**
     * Incrementally iterate the keyspace with a count hint
     *
     * @param cursor The cursor value (use "0" to start a new iteration)
     * @param count The "COUNT" keyword
     * @param hint The number of elements to return per call (hint only, not exact)
     * @returns Promise that resolves with a tuple [cursor, keys[]]
     */
    scan(cursor: string | number, count: "COUNT", hint: number): Promise<[string, string[]]>;

    /**
     * Incrementally iterate the keyspace with pattern match and count hint
     *
     * @param cursor The cursor value (use "0" to start a new iteration)
     * @param match The "MATCH" keyword
     * @param pattern The pattern to match
     * @param count The "COUNT" keyword
     * @param hint The number of elements to return per call
     * @returns Promise that resolves with a tuple [cursor, keys[]]
     */
    scan(
      cursor: string | number,
      match: "MATCH",
      pattern: string,
      count: "COUNT",
      hint: number,
    ): Promise<[string, string[]]>;

    /**
     * Incrementally iterate the keyspace with options
     *
     * @param cursor The cursor value
     * @param options Additional SCAN options (MATCH pattern, COUNT hint, etc.)
     * @returns Promise that resolves with a tuple [cursor, keys[]]
     */
    scan(cursor: string | number, ...options: (string | number)[]): Promise<[string, string[]]>;

    /**
     * Get the number of members in a set
     * @param key The set key
     * @returns Promise that resolves with the cardinality (number of elements)
     * of the set
     */
    scard(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the difference of multiple sets
     * @param key The first set key
     * @param keys Additional set keys to subtract from the first set
     * @returns Promise that resolves with an array of members in the difference
     */
    sdiff(key: RedisClient.KeyLike, ...keys: RedisClient.KeyLike[]): Promise<string[]>;

    /**
     * Get the intersection of multiple sets
     * @param key The first set key
     * @param keys Additional set keys to intersect
     * @returns Promise that resolves with an array of members in the intersection
     */
    sinter(key: RedisClient.KeyLike, ...keys: RedisClient.KeyLike[]): Promise<string[]>;

    /**
     * Store the intersection of multiple sets in a key
     * @param destination The destination key to store the result
     * @param key The first set key
     * @param keys Additional set keys to intersect
     * @returns Promise that resolves with the number of elements in the resulting set
     */
    sinterstore(
      destination: RedisClient.KeyLike,
      key: RedisClient.KeyLike,
      ...keys: RedisClient.KeyLike[]
    ): Promise<number>;

    /**
     * Get the cardinality of the intersection of multiple sets
     * @param numkeys The number of keys to intersect
     * @param key The first set key
     * @param args Additional set keys and optional LIMIT argument
     * @returns Promise that resolves with the number of elements in the intersection
     */
    sintercard(
      numkeys: number,
      key: RedisClient.KeyLike,
      ...args: (RedisClient.KeyLike | "LIMIT" | number)[]
    ): Promise<number>;

    /**
     * Get the length of the value stored in a key
     * @param key The key to check
     * @returns Promise that resolves with the length of the string value, or 0
     * if the key doesn't exist
     */
    strlen(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the union of multiple sets
     * @param key The first set key
     * @param keys Additional set keys to union
     * @returns Promise that resolves with an array of members in the union
     */
    sunion(key: RedisClient.KeyLike, ...keys: RedisClient.KeyLike[]): Promise<string[]>;

    /**
     * Store the union of multiple sets in a key
     * @param destination The destination key to store the result
     * @param key The first set key
     * @param keys Additional set keys to union
     * @returns Promise that resolves with the number of elements in the resulting set
     */
    sunionstore(
      destination: RedisClient.KeyLike,
      key: RedisClient.KeyLike,
      ...keys: RedisClient.KeyLike[]
    ): Promise<number>;

    /**
     * Determine the type of value stored at key
     *
     * The TYPE command returns the string representation of the type of the
     * value stored at key. The different types that can be returned are:
     * string, list, set, zset, hash and stream.
     *
     * @param key The key to check
     * @returns Promise that resolves with the type of value stored at key, or
     * "none" if the key doesn't exist
     *
     * @example
     * ```ts
     * await redis.set("mykey", "Hello");
     * console.log(await redis.type("mykey")); // "string"
     *
     * await redis.lpush("mylist", "value");
     * console.log(await redis.type("mylist")); // "list"
     *
     * await redis.sadd("myset", "value");
     * console.log(await redis.type("myset")); // "set"
     *
     * await redis.hset("myhash", "field", "value");
     * console.log(await redis.type("myhash")); // "hash"
     *
     * console.log(await redis.type("nonexistent")); // "none"
     * ```
     */
    type(key: RedisClient.KeyLike): Promise<"none" | "string" | "list" | "set" | "zset" | "hash" | "stream">;

    /**
     * Get the number of members in a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with the cardinality (number of elements)
     * of the sorted set
     */
    zcard(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Count the members in a sorted set with scores within the given range
     * @param key The sorted set key
     * @param min Minimum score (inclusive, use "-inf" for negative infinity)
     * @param max Maximum score (inclusive, use "+inf" for positive infinity)
     * @returns Promise that resolves with the count of elements in the specified score range
     */
    zcount(key: RedisClient.KeyLike, min: string | number, max: string | number): Promise<number>;

    /**
     * Count the members in a sorted set within a lexicographical range
     * @param key The sorted set key
     * @param min Minimum value (use "[" for inclusive, "(" for exclusive, e.g., "[aaa")
     * @param max Maximum value (use "[" for inclusive, "(" for exclusive, e.g., "[zzz")
     * @returns Promise that resolves with the count of elements in the specified range
     */
    zlexcount(key: RedisClient.KeyLike, min: string, max: string): Promise<number>;

    /**
     * Remove and return members with the highest scores in a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with either [member, score] or empty
     * array if the set is empty
     */
    zpopmax(key: RedisClient.KeyLike): Promise<[string, number] | []>;

    /**
     * Remove and return members with the highest scores in a sorted set
     * @param key The sorted set key
     * @param count Optional number of members to pop (default: 1)
     * @returns Promise that resolves with an array of [member, score] tuples
     */
    zpopmax(key: RedisClient.KeyLike, count: number): Promise<Array<[string, number]>>;

    /**
     * Remove and return members with the lowest scores in a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with array of [member, score] tuples, or
     * empty array if the set is empty
     */
    zpopmin(key: RedisClient.KeyLike): Promise<[string, number] | []>;

    /**
     * Remove and return members with the lowest scores in a sorted set
     * @param key The sorted set key
     * @param count Optional number of members to pop (default: 1)
     * @returns Promise that resolves with an array of [member, score] tuples
     */
    zpopmin(key: RedisClient.KeyLike, count: number): Promise<[string, number][]>;

    /**
     * Remove and return the member with the lowest score from one or more sorted sets, or block until one is available
     * @param args Keys followed by timeout in seconds (e.g., "key1", "key2", 1.0)
     * @returns Promise that resolves with [key, member, score] or null if timeout
     * @example
     * ```ts
     * // Block for up to 1 second waiting for an element
     * const result = await redis.bzpopmin("myzset", 1.0);
     * if (result) {
     *   const [key, member, score] = result;
     *   console.log(`Popped ${member} with score ${score} from ${key}`);
     * }
     * ```
     */
    bzpopmin(...args: (RedisClient.KeyLike | number)[]): Promise<[string, string, number] | null>;

    /**
     * Remove and return the member with the highest score from one or more sorted sets, or block until one is available
     * @param args Keys followed by timeout in seconds (e.g., "key1", "key2", 1.0)
     * @returns Promise that resolves with [key, member, score] or null if timeout
     * @example
     * ```ts
     * // Block for up to 1 second waiting for an element
     * const result = await redis.bzpopmax("myzset", 1.0);
     * if (result) {
     *   const [key, member, score] = result;
     *   console.log(`Popped ${member} with score ${score} from ${key}`);
     * }
     * ```
     */
    bzpopmax(...args: (RedisClient.KeyLike | number)[]): Promise<[string, string, number] | null>;

    /**
     * Get one or multiple random members from a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with a random member, or null if the set
     * is empty
     */
    zrandmember(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get one or multiple random members from a sorted set
     * @param key The sorted set key
     * @returns Promise that resolves with a random member, or null if the set
     * is empty
     */
    zrandmember(key: RedisClient.KeyLike, count: number): Promise<string[] | null>;

    /**
     * Get one or multiple random members from a sorted set, with scores
     * @param key The sorted set key
     * @returns Promise that resolves with a random member, or null if the set
     * is empty
     */
    zrandmember(key: RedisClient.KeyLike, count: number, withscores: "WITHSCORES"): Promise<[string, number][] | null>;

    /**
     * Return a range of members in a sorted set with their scores
     *
     * @param key The sorted set key
     * @param start The starting index
     * @param stop The stopping index
     * @param withscores Return members with their scores
     * @returns Promise that resolves with an array of [member, score, member, score, ...]
     *
     * @example
     * ```ts
     * const results = await redis.zrange("myzset", 0, -1, "WITHSCORES");
     * // Returns ["member1", "1.5", "member2", "2.5", ...]
     * ```
     */
    zrange(
      key: RedisClient.KeyLike,
      start: string | number,
      stop: string | number,
      withscores: "WITHSCORES",
    ): Promise<[string, number][]>;

    /**
     * Return a range of members in a sorted set by score
     *
     * @param key The sorted set key
     * @param start The minimum score (use "-inf" for negative infinity, "(" prefix for exclusive)
     * @param stop The maximum score (use "+inf" for positive infinity, "(" prefix for exclusive)
     * @param byscore Indicates score-based range
     * @returns Promise that resolves with an array of members with scores in the range
     *
     * @example
     * ```ts
     * // Get members with score between 1 and 3
     * const members = await redis.zrange("myzset", "1", "3", "BYSCORE");
     *
     * // Get members with score > 1 and <= 3 (exclusive start)
     * const members2 = await redis.zrange("myzset", "(1", "3", "BYSCORE");
     * ```
     */
    zrange(
      key: RedisClient.KeyLike,
      start: string | number,
      stop: string | number,
      byscore: "BYSCORE",
    ): Promise<string[]>;

    /**
     * Return a range of members in a sorted set lexicographically
     *
     * @param key The sorted set key
     * @param start The minimum lexicographical value (use "-" for start, "[" for inclusive, "(" for exclusive)
     * @param stop The maximum lexicographical value (use "+" for end, "[" for inclusive, "(" for exclusive)
     * @param bylex Indicates lexicographical range
     * @returns Promise that resolves with an array of members in the lexicographical range
     *
     * @example
     * ```ts
     * // Get members lexicographically from "a" to "c" (inclusive)
     * const members = await redis.zrange("myzset", "[a", "[c", "BYLEX");
     * ```
     */
    zrange(key: RedisClient.KeyLike, start: string, stop: string, bylex: "BYLEX"): Promise<string[]>;

    /**
     * Return a range of members in a sorted set with various options
     *
     * @param key The sorted set key
     * @param start The starting value (index, score, or lex depending on options)
     * @param stop The stopping value
     * @param options Additional options (BYSCORE, BYLEX, REV, LIMIT offset count, WITHSCORES)
     * @returns Promise that resolves with an array of members (or with scores if WITHSCORES)
     *
     * @example
     * ```ts
     * // Get members by score with limit
     * const members = await redis.zrange("myzset", "1", "10", "BYSCORE", "LIMIT", "0", "5");
     *
     * // Get members in reverse order with scores
     * const reversed = await redis.zrange("myzset", "0", "-1", "REV", "WITHSCORES");
     * ```
     */
    zrange(
      key: RedisClient.KeyLike,
      start: string | number,
      stop: string | number,
      ...options: string[]
    ): Promise<string[]>;

    /**
     * Return a range of members in a sorted set
     *
     * Returns the specified range of elements in the sorted set stored at key.
     * The elements are considered to be ordered from the lowest to the highest score by default.
     *
     * @param key The sorted set key
     * @param start The starting index (0-based, can be negative to count from end)
     * @param stop The stopping index (0-based, can be negative to count from end)
     * @returns Promise that resolves with an array of members in the specified range
     *
     * @example
     * ```ts
     * // Get all members
     * const members = await redis.zrange("myzset", 0, -1);
     *
     * // Get first 3 members
     * const top3 = await redis.zrange("myzset", 0, 2);
     * ```
     */
    zrange(key: RedisClient.KeyLike, start: string | number, stop: string | number): Promise<string[]>;

    /**
     * Return a range of members in a sorted set, by index, with scores ordered from high to low
     *
     * This is equivalent to ZRANGE with the REV option. Returns members in reverse order.
     *
     * @param key The sorted set key
     * @param start The starting index (0-based, can be negative to count from end)
     * @param stop The stopping index (0-based, can be negative to count from end)
     * @returns Promise that resolves with an array of members in reverse order
     *
     * @example
     * ```ts
     * // Get all members in reverse order (highest to lowest score)
     * const members = await redis.zrevrange("myzset", 0, -1);
     *
     * // Get top 3 members with highest scores
     * const top3 = await redis.zrevrange("myzset", 0, 2);
     * ```
     */
    zrevrange(key: RedisClient.KeyLike, start: number, stop: number): Promise<string[]>;

    /**
     * Return a range of members in a sorted set with their scores, ordered from high to low
     *
     * @param key The sorted set key
     * @param start The starting index
     * @param stop The stopping index
     * @param withscores Return members with their scores
     * @returns Promise that resolves with an array of [member, score, member, score, ...] in reverse order
     *
     * @example
     * ```ts
     * const results = await redis.zrevrange("myzset", 0, -1, "WITHSCORES");
     * // Returns ["member3", "3.5", "member2", "2.5", "member1", "1.5", ...]
     * ```
     */
    zrevrange(
      key: RedisClient.KeyLike,
      start: number,
      stop: number,
      withscores: "WITHSCORES",
    ): Promise<[string, number][]>;

    /**
     * Return a range of members in a sorted set with options, ordered from high to low
     *
     * @param key The sorted set key
     * @param start The starting index
     * @param stop The stopping index
     * @param options Additional options (WITHSCORES)
     * @returns Promise that resolves with an array of members (or with scores if WITHSCORES)
     */
    zrevrange(key: RedisClient.KeyLike, start: number, stop: number, ...options: string[]): Promise<string[]>;

    /**
     * Append a value to a key
     * @param key The key to append to
     * @param value The value to append
     * @returns Promise that resolves with the length of the string after the
     * append operation
     */
    append(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Set the value of a key and return its old value
     * @param key The key to set
     * @param value The value to set
     * @returns Promise that resolves with the old value, or null if the key
     * didn't exist
     */
    getset(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Insert an element before or after another element in a list
     * @param key The list key
     * @param position "BEFORE" or "AFTER" to specify where to insert
     * @param pivot The pivot element to insert before or after
     * @param element The element to insert
     * @returns Promise that resolves with the length of the list after insert, -1 if pivot not found, or 0 if key doesn't exist
     *
     * @example
     * ```ts
     * await redis.lpush("mylist", "World");
     * await redis.lpush("mylist", "Hello");
     * await redis.linsert("mylist", "BEFORE", "World", "There");
     * // List is now: ["Hello", "There", "World"]
     * ```
     */
    linsert(
      key: RedisClient.KeyLike,
      position: "BEFORE" | "AFTER",
      pivot: RedisClient.KeyLike,
      element: RedisClient.KeyLike,
    ): Promise<number>;

    /**
     * Prepend one or multiple values to a list
     * @param key The list key
     * @param value The value to prepend
     * @returns Promise that resolves with the length of the list after the push
     * operation
     */
    lpush(key: RedisClient.KeyLike, value: RedisClient.KeyLike, ...rest: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Prepend a value to a list, only if the list exists
     * @param key The list key
     * @param value The value to prepend
     * @returns Promise that resolves with the length of the list after the push
     * operation, or 0 if the list doesn't exist
     */
    lpushx(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Remove elements from a list
     * @param key The list key
     * @param count Number of elements to remove
     *   - count > 0: Remove count occurrences from head to tail
     *   - count < 0: Remove count occurrences from tail to head
     *   - count = 0: Remove all occurrences
     * @param element The element to remove
     * @returns Promise that resolves with the number of elements removed
     *
     * @example
     * ```ts
     * await redis.rpush("mylist", "hello", "hello", "world", "hello");
     * await redis.lrem("mylist", 2, "hello"); // Removes first 2 "hello"
     * // List is now: ["world", "hello"]
     * ```
     */
    lrem(key: RedisClient.KeyLike, count: number, element: RedisClient.KeyLike): Promise<number>;

    /**
     * Trim a list to the specified range
     * @param key The list key
     * @param start The start index (0-based, can be negative)
     * @param stop The stop index (0-based, can be negative)
     * @returns Promise that resolves with "OK"
     *
     * @example
     * ```ts
     * await redis.rpush("mylist", "one", "two", "three", "four");
     * await redis.ltrim("mylist", 1, 2);
     * // List is now: ["two", "three"]
     * ```
     */
    ltrim(key: RedisClient.KeyLike, start: number, stop: number): Promise<string>;

    /**
     * Add one or more members to a HyperLogLog
     * @param key The HyperLogLog key
     * @param element The element to add
     * @returns Promise that resolves with 1 if the HyperLogLog was altered, 0
     * otherwise
     */
    pfadd(key: RedisClient.KeyLike, element: string): Promise<number>;

    /**
     * Append one or multiple values to a list
     * @param key The list key
     * @param value The value to append
     * @returns Promise that resolves with the length of the list after the push
     * operation
     */
    rpush(key: RedisClient.KeyLike, value: RedisClient.KeyLike, ...rest: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Append a value to a list, only if the list exists
     * @param key The list key
     * @param value The value to append
     * @returns Promise that resolves with the length of the list after the push
     * operation, or 0 if the list doesn't exist
     */
    rpushx(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Set the value of a key, only if the key does not exist
     * @param key The key to set
     * @param value The value to set
     * @returns Promise that resolves with 1 if the key was set, 0 if the key
     * was not set
     */
    setnx(key: RedisClient.KeyLike, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Set key to hold the string value with expiration time in seconds
     * @param key The key to set
     * @param seconds The expiration time in seconds
     * @param value The value to set
     * @returns Promise that resolves with "OK" on success
     *
     * @example
     * ```ts
     * await redis.setex("mykey", 10, "Hello");
     * // Key will expire after 10 seconds
     * ```
     */
    setex(key: RedisClient.KeyLike, seconds: number, value: RedisClient.KeyLike): Promise<"OK">;

    /**
     * Set key to hold the string value with expiration time in milliseconds
     * @param key The key to set
     * @param milliseconds The expiration time in milliseconds
     * @param value The value to set
     * @returns Promise that resolves with "OK" on success
     *
     * @example
     * ```ts
     * await redis.psetex("mykey", 10000, "Hello");
     * // Key will expire after 10000 milliseconds (10 seconds)
     * ```
     */
    psetex(key: RedisClient.KeyLike, milliseconds: number, value: RedisClient.KeyLike): Promise<"OK">;

    /**
     * Get the score associated with the given member in a sorted set
     * @param key The sorted set key
     * @param member The member to get the score for
     * @returns Promise that resolves with the score of the member as a number,
     * or null if the member or key doesn't exist
     */
    zscore(key: RedisClient.KeyLike, member: string): Promise<number | null>;

    /**
     * Increment the score of a member in a sorted set
     * @param key The sorted set key
     * @param increment The increment value
     * @param member The member to increment
     * @returns Promise that resolves with the new score
     */
    zincrby(key: RedisClient.KeyLike, increment: number, member: RedisClient.KeyLike): Promise<number>;

    /**
     * Returns the scores associated with the specified members in the sorted set
     * @param key The sorted set key
     * @param member The first member to get the score for
     * @param members Additional members to get scores for
     * @returns Promise that resolves with an array of scores (number for each score, or null if member doesn't exist)
     */
    zmscore(
      key: RedisClient.KeyLike,
      member: RedisClient.KeyLike,
      ...members: RedisClient.KeyLike[]
    ): Promise<(number | null)[]>;

    /**
     * Add one or more members to a sorted set, or update scores if they already exist
     *
     * ZADD adds all the specified members with the specified scores to the sorted set stored at key.
     * It is possible to specify multiple score / member pairs. If a specified member is already a
     * member of the sorted set, the score is updated and the element reinserted at the right position
     * to ensure the correct ordering.
     *
     * If key does not exist, a new sorted set with the specified members as sole members is created.
     * If the key exists but does not hold a sorted set, an error is returned.
     *
     * The score values should be the string representation of a double precision floating point number.
     * +inf and -inf values are valid values as well.
     *
     * Options:
     * - NX: Only add new elements. Don't update already existing elements.
     * - XX: Only update elements that already exist. Never add elements.
     * - GT: Only update existing elements if the new score is greater than the current score. This flag doesn't prevent adding new elements.
     * - LT: Only update existing elements if the new score is less than the current score. This flag doesn't prevent adding new elements.
     * - CH: Modify the return value from the number of new elements added, to the total number of elements changed (CH is an abbreviation of changed).
     * - INCR: When this option is specified ZADD acts like ZINCRBY. Only one score-member pair can be specified in this mode.
     *
     * Note: The GT, LT and NX options are mutually exclusive.
     *
     * @param key The sorted set key
     * @param args Score-member pairs and optional flags (NX, XX, GT, LT, CH, INCR)
     * @returns Promise that resolves with the number of elements added (or changed if CH is used, or new score if INCR is used)
     *
     * @example
     * ```ts
     * // Add members with scores
     * await redis.zadd("myzset", "1", "one", "2", "two", "3", "three");
     *
     * // Add with NX option (only if member doesn't exist)
     * await redis.zadd("myzset", "NX", "4", "four");
     *
     * // Add with XX option (only if member exists)
     * await redis.zadd("myzset", "XX", "2.5", "two");
     *
     * // Add with CH option (return count of changed elements)
     * await redis.zadd("myzset", "CH", "5", "five", "2.1", "two");
     *
     * // Use INCR option (increment score)
     * await redis.zadd("myzset", "INCR", "1.5", "one");
     * ```
     */
    zadd(key: RedisClient.KeyLike, ...args: (string | number)[]): Promise<number>;

    /**
     * Incrementally iterate sorted set elements and their scores
     *
     * The ZSCAN command is used in order to incrementally iterate over sorted set elements and their scores.
     * ZSCAN is a cursor based iterator. This means that at every call of the command, the server returns an
     * updated cursor that the user needs to use as the cursor argument in the next call.
     *
     * An iteration starts when the cursor is set to 0, and terminates when the cursor returned by the server is 0.
     *
     * ZSCAN and the other SCAN family commands are able to provide to the user a set of guarantees associated
     * to full iterations:
     * - A full iteration always retrieves all the elements that were present in the collection from the start
     *   to the end of a full iteration. This means that if a given element is inside the collection when an
     *   iteration is started, and is still there when an iteration terminates, then at some point ZSCAN returned it.
     * - A full iteration never returns any element that was NOT present in the collection from the start to the
     *   end of a full iteration. So if an element was removed before the start of an iteration, and is never
     *   added back to the collection for all the time an iteration lasts, ZSCAN ensures that this element will
     *   never be returned.
     *
     * Options:
     * - MATCH pattern: Only return elements matching the pattern (glob-style)
     * - COUNT count: Amount of work done at every call (hint, not exact)
     *
     * @param key The sorted set key
     * @param cursor The cursor value (use 0 to start a new iteration)
     * @param options Additional ZSCAN options (MATCH pattern, COUNT hint, etc.)
     * @returns Promise that resolves with a tuple [cursor, [member1, score1, member2, score2, ...]]
     *
     * @example
     * ```ts
     * // Basic scan - iterate all elements
     * let cursor = "0";
     * const allElements: string[] = [];
     * do {
     *   const [nextCursor, elements] = await redis.zscan("myzset", cursor);
     *   allElements.push(...elements);
     *   cursor = nextCursor;
     * } while (cursor !== "0");
     * ```
     *
     * @example
     * ```ts
     * // Scan with MATCH pattern
     * const [cursor, elements] = await redis.zscan("myzset", "0", "MATCH", "user:*");
     * ```
     *
     * @example
     * ```ts
     * // Scan with COUNT hint
     * const [cursor, elements] = await redis.zscan("myzset", "0", "COUNT", "100");
     * ```
     */
    zscan(key: RedisClient.KeyLike, cursor: string | number, ...options: string[]): Promise<[string, string[]]>;

    /**
     * Remove one or more members from a sorted set
     * @param key The sorted set key
     * @param member The first member to remove
     * @param members Additional members to remove
     * @returns Promise that resolves with the number of members removed (not including non-existing members)
     */
    zrem(key: RedisClient.KeyLike, member: RedisClient.KeyLike, ...members: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Remove all members in a sorted set within the given lexicographical range
     * @param key The sorted set key
     * @param min Minimum value (use "[" for inclusive, "(" for exclusive, e.g., "[aaa")
     * @param max Maximum value (use "[" for inclusive, "(" for exclusive, e.g., "[zzz")
     * @returns Promise that resolves with the number of elements removed
     */
    zremrangebylex(key: RedisClient.KeyLike, min: string, max: string): Promise<number>;

    /**
     * Remove all members in a sorted set within the given rank range
     * @param key The sorted set key
     * @param start Start rank (0-based, can be negative to indicate offset from end)
     * @param stop Stop rank (0-based, can be negative to indicate offset from end)
     * @returns Promise that resolves with the number of elements removed
     */
    zremrangebyrank(key: RedisClient.KeyLike, start: number, stop: number): Promise<number>;

    /**
     * Remove all members in a sorted set within the given score range
     * @param key The sorted set key
     * @param min Minimum score (inclusive, use "-inf" for negative infinity, "(" prefix for exclusive)
     * @param max Maximum score (inclusive, use "+inf" for positive infinity, "(" prefix for exclusive)
     * @returns Promise that resolves with the number of elements removed
     */
    zremrangebyscore(key: RedisClient.KeyLike, min: string | number, max: string | number): Promise<number>;

    /**
     * Return members in a sorted set within a lexicographical range
     *
     * When all the elements in a sorted set have the same score, this command
     * returns the elements between min and max in lexicographical order.
     *
     * Lex ranges:
     * - `[member` for inclusive lower bound
     * - `(member` for exclusive lower bound
     * - `-` for negative infinity
     * - `+` for positive infinity
     *
     * @param key The sorted set key (all members must have the same score)
     * @param min Minimum lexicographical value (use "-" for negative infinity, "[" or "(" for inclusive/exclusive)
     * @param max Maximum lexicographical value (use "+" for positive infinity, "[" or "(" for inclusive/exclusive)
     * @returns Promise that resolves with array of members
     *
     * @example
     * ```ts
     * await redis.send("ZADD", ["myzset", "0", "apple", "0", "banana", "0", "cherry"]);
     * const members = await redis.zrangebylex("myzset", "[banana", "[cherry");
     * // Returns: ["banana", "cherry"]
     * ```
     */
    zrangebylex(key: RedisClient.KeyLike, min: string, max: string): Promise<string[]>;

    /**
     * Return members in a sorted set within a lexicographical range, with pagination
     *
     * @param key The sorted set key
     * @param min Minimum lexicographical value
     * @param max Maximum lexicographical value
     * @param limit The "LIMIT" keyword
     * @param offset The number of elements to skip
     * @param count The maximum number of elements to return
     * @returns Promise that resolves with array of members
     *
     * @example
     * ```ts
     * await redis.send("ZADD", ["myzset", "0", "a", "0", "b", "0", "c", "0", "d"]);
     * const result = await redis.zrangebylex("myzset", "-", "+", "LIMIT", 1, 2);
     * // Returns: ["b", "c"]
     * ```
     */
    zrangebylex(
      key: RedisClient.KeyLike,
      min: string,
      max: string,
      limit: "LIMIT",
      offset: number,
      count: number,
    ): Promise<string[]>;

    /**
     * Return members in a sorted set within a lexicographical range, with options
     *
     * @param key The sorted set key
     * @param min Minimum lexicographical value
     * @param max Maximum lexicographical value
     * @param options Additional options (LIMIT offset count)
     * @returns Promise that resolves with array of members
     */
    zrangebylex(key: RedisClient.KeyLike, min: string, max: string, ...options: (string | number)[]): Promise<string[]>;

    /**
     * Return members in a sorted set with scores within a given range
     *
     * Returns all the elements in the sorted set at key with a score between min
     * and max (inclusive by default). The elements are considered to be ordered
     * from low to high scores.
     *
     * Score ranges support:
     * - `-inf` and `+inf` for negative and positive infinity
     * - `(` prefix for exclusive bounds (e.g., `(5` means greater than 5, not including 5)
     *
     * @param key The sorted set key
     * @param min Minimum score (can be "-inf", a number, or prefixed with "(" for exclusive)
     * @param max Maximum score (can be "+inf", a number, or prefixed with "(" for exclusive)
     * @returns Promise that resolves with array of members
     *
     * @example
     * ```ts
     * await redis.send("ZADD", ["myzset", "1", "one", "2", "two", "3", "three"]);
     * const members = await redis.zrangebyscore("myzset", 1, 2);
     * // Returns: ["one", "two"]
     * ```
     */
    zrangebyscore(key: RedisClient.KeyLike, min: string | number, max: string | number): Promise<string[]>;

    /**
     * Return members in a sorted set with scores within a given range, with scores
     *
     * @param key The sorted set key
     * @param min Minimum score
     * @param max Maximum score
     * @param withscores The "WITHSCORES" keyword to return scores along with members
     * @returns Promise that resolves with array of [member, score, member, score, ...]
     *
     * @example
     * ```ts
     * await redis.send("ZADD", ["myzset", "1", "one", "2", "two", "3", "three"]);
     * const result = await redis.zrangebyscore("myzset", 1, 2, "WITHSCORES");
     * // Returns: ["one", "1", "two", "2"]
     * ```
     */
    zrangebyscore(
      key: RedisClient.KeyLike,
      min: string | number,
      max: string | number,
      withscores: "WITHSCORES",
    ): Promise<[string, number][]>;

    /**
     * Return members in a sorted set with scores within a given range, with pagination
     *
     * @param key The sorted set key
     * @param min Minimum score
     * @param max Maximum score
     * @param limit The "LIMIT" keyword
     * @param offset The number of elements to skip
     * @param count The maximum number of elements to return
     * @returns Promise that resolves with array of members
     *
     * @example
     * ```ts
     * await redis.send("ZADD", ["myzset", "1", "one", "2", "two", "3", "three", "4", "four"]);
     * const result = await redis.zrangebyscore("myzset", "-inf", "+inf", "LIMIT", 1, 2);
     * // Returns: ["two", "three"]
     * ```
     */
    zrangebyscore(
      key: RedisClient.KeyLike,
      min: string | number,
      max: string | number,
      limit: "LIMIT",
      offset: number,
      count: number,
    ): Promise<string[]>;

    /**
     * Return members in a sorted set with scores within a given range, with the score values
     *
     * @param key The sorted set key
     * @param min Minimum score
     * @param max Maximum score
     * @param options Additional options (WITHSCORES, LIMIT offset count)
     * @returns Promise that resolves with array of members (and scores if WITHSCORES is used)
     */
    zrangebyscore(
      key: RedisClient.KeyLike,
      min: string | number,
      max: string | number,
      withscores: "WITHSCORES",
      ...options: (string | number)[]
    ): Promise<[string, number][]>;

    /**
     * Return members in a sorted set with scores within a given range, with the score values
     *
     * @param key The sorted set key
     * @param min Minimum score
     * @param max Maximum score
     * @param options Additional options (WITHSCORES, LIMIT offset count)
     * @returns Promise that resolves with array of members (and scores if WITHSCORES is used)
     */
    zrangebyscore(
      key: RedisClient.KeyLike,
      min: string | number,
      max: string | number,
      withscores: "WITHSCORES",
      limit: "LIMIT",
      offset: number,
      count: number,
      ...options: (string | number)[]
    ): Promise<[string, number][]>;

    /**
     * Return members in a sorted set with scores within a given range, with various options
     *
     * @param key The sorted set key
     * @param min Minimum score
     * @param max Maximum score
     * @param options Additional options (WITHSCORES, LIMIT offset count)
     * @returns Promise that resolves with array of members (and scores if WITHSCORES is used)
     */
    zrangebyscore(
      key: RedisClient.KeyLike,
      min: string | number,
      max: string | number,
      ...options: (string | number)[]
    ): Promise<string[]>;

    /**
     * Return members in a sorted set with scores within a given range, ordered from high to low
     *
     * Returns all the elements in the sorted set at key with a score between max
     * and min (note: max comes before min). The elements are considered to be
     * ordered from high to low scores.
     *
     * Score ranges support:
     * - `-inf` and `+inf` for negative and positive infinity
     * - `(` prefix for exclusive bounds (e.g., `(5` means less than 5, not including 5)
     *
     * @param key The sorted set key
     * @param max Maximum score (can be "+inf", a number, or prefixed with "(" for exclusive)
     * @param min Minimum score (can be "-inf", a number, or prefixed with "(" for exclusive)
     * @returns Promise that resolves with array of members
     *
     * @example
     * ```ts
     * await redis.send("ZADD", ["myzset", "1", "one", "2", "two", "3", "three"]);
     * const members = await redis.zrevrangebyscore("myzset", 2, 1);
     * // Returns: ["two", "one"]
     * ```
     */
    zrevrangebyscore(key: RedisClient.KeyLike, max: string | number, min: string | number): Promise<string[]>;

    /**
     * Return members in a sorted set with scores within a given range, ordered from high to low, with scores
     *
     * @param key The sorted set key
     * @param max Maximum score
     * @param min Minimum score
     * @param withscores The "WITHSCORES" keyword to return scores along with members
     * @returns Promise that resolves with array of [member, score, member, score, ...]
     *
     * @example
     * ```ts
     * await redis.send("ZADD", ["myzset", "1", "one", "2", "two", "3", "three"]);
     * const result = await redis.zrevrangebyscore("myzset", 2, 1, "WITHSCORES");
     * // Returns: ["two", "2", "one", "1"]
     * ```
     */
    zrevrangebyscore(
      key: RedisClient.KeyLike,
      max: string | number,
      min: string | number,
      withscores: "WITHSCORES",
    ): Promise<[string, number][]>;

    /**
     * Return members in a sorted set with scores within a given range, ordered from high to low, with pagination
     *
     * @param key The sorted set key
     * @param max Maximum score
     * @param min Minimum score
     * @param limit The "LIMIT" keyword
     * @param offset The number of elements to skip
     * @param count The maximum number of elements to return
     * @returns Promise that resolves with array of members
     */
    zrevrangebyscore(
      key: RedisClient.KeyLike,
      max: string | number,
      min: string | number,
      limit: "LIMIT",
      offset: number,
      count: number,
    ): Promise<string[]>;

    /**
     * Return members in a sorted set with scores within a given range, ordered from high to low, with options
     *
     * @param key The sorted set key
     * @param max Maximum score
     * @param min Minimum score
     * @param options Additional options (WITHSCORES, LIMIT offset count)
     * @returns Promise that resolves with array of members (and scores if WITHSCORES is used)
     */
    zrevrangebyscore(
      key: RedisClient.KeyLike,
      max: string | number,
      min: string | number,
      ...options: (string | number)[]
    ): Promise<string[]>;

    /**
     * Return members in a sorted set within a lexicographical range, ordered from high to low
     *
     * All members in a sorted set must have the same score for this command to work correctly.
     * The max and min arguments have the same meaning as in ZRANGEBYLEX, but in reverse order.
     *
     * Use "[" for inclusive bounds and "(" for exclusive bounds. Use "-" for negative infinity and "+" for positive infinity.
     *
     * @param key The sorted set key
     * @param max The maximum lexicographical value (inclusive with "[", exclusive with "(")
     * @param min The minimum lexicographical value (inclusive with "[", exclusive with "(")
     * @param options Optional LIMIT clause: ["LIMIT", offset, count]
     * @returns Promise that resolves with an array of members in reverse lexicographical order
     *
     * @example
     * ```ts
     * // Add members with same score
     * await redis.send("ZADD", ["myzset", "0", "a", "0", "b", "0", "c", "0", "d"]);
     *
     * // Get range from highest to lowest
     * const members = await redis.zrevrangebylex("myzset", "[d", "[b");
     * console.log(members); // ["d", "c", "b"]
     *
     * // With LIMIT
     * const limited = await redis.zrevrangebylex("myzset", "+", "-", "LIMIT", "0", "2");
     * console.log(limited); // ["d", "c"] (first 2 members)
     * ```
     */
    zrevrangebylex(key: RedisClient.KeyLike, max: string, min: string, ...options: string[]): Promise<string[]>;

    /**
     * Store a range of members from a sorted set into a destination key
     *
     * This command is like ZRANGE but stores the result in a destination key instead of returning it.
     * Supports all the same options as ZRANGE including BYSCORE, BYLEX, REV, and LIMIT.
     *
     * @param destination The destination key to store results
     * @param source The source sorted set key
     * @param start The starting index or score
     * @param stop The ending index or score
     * @param options Optional flags: ["BYSCORE"], ["BYLEX"], ["REV"], ["LIMIT", offset, count]
     * @returns Promise that resolves with the number of elements in the resulting sorted set
     *
     * @example
     * ```ts
     * // Add members to source set
     * await redis.send("ZADD", ["source", "1", "one", "2", "two", "3", "three"]);
     *
     * // Store range by rank
     * const count1 = await redis.zrangestore("dest1", "source", 0, 1);
     * console.log(count1); // 2
     *
     * // Store range by score
     * const count2 = await redis.zrangestore("dest2", "source", "1", "2", "BYSCORE");
     * console.log(count2); // 2
     *
     * // Store in reverse order with limit
     * const count3 = await redis.zrangestore("dest3", "source", "0", "-1", "REV", "LIMIT", "0", "2");
     * console.log(count3); // 2
     * ```
     */
    zrangestore(
      destination: RedisClient.KeyLike,
      source: RedisClient.KeyLike,
      start: string | number,
      stop: string | number,
      ...options: string[]
    ): Promise<number>;

    /**
     * Determine the index of a member in a sorted set
     * @param key The sorted set key
     * @param member The member to find
     * @returns Promise that resolves with the rank (index) of the member, or null if the member doesn't exist
     */
    zrank(key: RedisClient.KeyLike, member: string): Promise<number | null>;

    /**
     * Determine the index of a member in a sorted set with score
     * @param key The sorted set key
     * @param member The member to find
     * @param withscore "WITHSCORE" to include the score
     * @returns Promise that resolves with [rank, score] or null if the member doesn't exist
     */
    zrank(key: RedisClient.KeyLike, member: string, withscore: "WITHSCORE"): Promise<[number, number] | null>;

    /**
     * Determine the index of a member in a sorted set, with scores ordered from high to low
     * @param key The sorted set key
     * @param member The member to find
     * @returns Promise that resolves with the rank (index) of the member, or null if the member doesn't exist
     */
    zrevrank(key: RedisClient.KeyLike, member: string): Promise<number | null>;

    /**
     * Determine the index of a member in a sorted set with score, with scores ordered from high to low
     * @param key The sorted set key
     * @param member The member to find
     * @param withscore "WITHSCORE" to include the score
     * @returns Promise that resolves with [rank, score] or null if the member doesn't exist
     */
    zrevrank(key: RedisClient.KeyLike, member: string, withscore: "WITHSCORE"): Promise<[number, number] | null>;

    /**
     * Get the values of all specified keys
     * @param keys The keys to get
     * @returns Promise that resolves with an array of values, with null for
     * keys that don't exist
     */
    mget(...keys: RedisClient.KeyLike[]): Promise<(string | null)[]>;

    /**
     * Set multiple keys to multiple values atomically
     *
     * Sets the given keys to their respective values. MSET replaces existing
     * values with new values, just as regular SET. Use MSETNX if you don't want
     * to overwrite existing values.
     *
     * MSET is atomic, so all given keys are set at once. It is not possible for
     * clients to see that some of the keys were updated while others are
     * unchanged.
     *
     * @param keyValuePairs Alternating keys and values (key1, value1, key2, value2, ...)
     * @returns Promise that resolves with "OK" on success
     *
     * @example
     * ```ts
     * await redis.mset("key1", "value1", "key2", "value2");
     * ```
     */
    mset(...keyValuePairs: RedisClient.KeyLike[]): Promise<"OK">;

    /**
     * Set multiple keys to multiple values, only if none of the keys exist
     *
     * Sets the given keys to their respective values. MSETNX will not perform
     * any operation at all even if just a single key already exists.
     *
     * Because of this semantic, MSETNX can be used in order to set different
     * keys representing different fields of a unique logic object in a way that
     * ensures that either all the fields or none at all are set.
     *
     * MSETNX is atomic, so all given keys are set at once. It is not possible
     * for clients to see that some of the keys were updated while others are
     * unchanged.
     *
     * @param keyValuePairs Alternating keys and values (key1, value1, key2, value2, ...)
     * @returns Promise that resolves with 1 if all keys were set, 0 if no key was set
     *
     * @example
     * ```ts
     * // Returns 1 if keys don't exist
     * await redis.msetnx("key1", "value1", "key2", "value2");
     *
     * // Returns 0 if any key already exists
     * await redis.msetnx("key1", "newvalue", "key3", "value3");
     * ```
     */
    msetnx(...keyValuePairs: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Count the number of set bits (population counting) in a string
     * @param key The key to count bits in
     * @returns Promise that resolves with the number of bits set to 1
     */
    bitcount(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Returns the bit value at offset in the string value stored at key
     * @param key The key containing the string value
     * @param offset The bit offset (zero-based)
     * @returns Promise that resolves with the bit value (0 or 1) at the specified offset
     */
    getbit(key: RedisClient.KeyLike, offset: number): Promise<number>;

    /**
     * Sets or clears the bit at offset in the string value stored at key
     * @param key The key to modify
     * @param offset The bit offset (zero-based)
     * @param value The bit value to set (0 or 1)
     * @returns Promise that resolves with the original bit value stored at offset
     */
    setbit(key: RedisClient.KeyLike, offset: number, value: 0 | 1): Promise<number>;

    /**
     * Get a substring of the string stored at a key
     * @param key The key to get the substring from
     * @param start The starting offset (can be negative to count from the end)
     * @param end The ending offset (can be negative to count from the end)
     * @returns Promise that resolves with the substring, or an empty string if the key doesn't exist
     */
    getrange(key: RedisClient.KeyLike, start: number, end: number): Promise<string>;

    /**
     * Get a substring of the string stored at a key
     * @param key The key to retrieve from
     * @param start The starting offset
     * @param end The ending offset
     * @returns Promise that resolves with the substring value
     *
     * @deprecated Use {@link getrange} instead. SUBSTR is a deprecated Redis command.
     */
    substr(key: RedisClient.KeyLike, start: number, end: number): Promise<string>;

    /**
     * Overwrite part of a string at key starting at the specified offset
     * @param key The key to modify
     * @param offset The offset at which to start overwriting (zero-based)
     * @param value The string value to write at the offset
     * @returns Promise that resolves with the length of the string after modification
     */
    setrange(key: RedisClient.KeyLike, offset: number, value: RedisClient.KeyLike): Promise<number>;

    /**
     * Return a serialized version of the value stored at the specified key
     * @param key The key to dump
     * @returns Promise that resolves with the serialized value, or null if the
     * key doesn't exist
     */
    dump(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the expiration time of a key as a UNIX timestamp in seconds
     *
     * @param key The key to check
     * @returns Promise that resolves with the timestamp, or -1 if the key has
     * no expiration, or -2 if the key doesn't exist
     */
    expiretime(key: RedisClient.KeyLike): Promise<number>;

    /**
     * Get the value of a key and delete the key
     *
     * @param key The key to get and delete
     * @returns Promise that resolves with the value of the key, or null if the
     * key doesn't exist
     */
    getdel(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the value of a key and optionally set its expiration
     *
     * @param key The key to get
     * @returns Promise that resolves with the value of the key, or null if the
     * key doesn't exist
     */
    getex(key: RedisClient.KeyLike): Promise<string | null>;

    /**
     * Get the value of a key and set its expiration in seconds
     *
     * @param key The key to get
     * @param ex Set the specified expire time, in seconds
     * @param seconds The number of seconds until expiration
     * @returns Promise that resolves with the value of the key, or null if the
     * key doesn't exist
     */
    getex(key: RedisClient.KeyLike, ex: "EX", seconds: number): Promise<string | null>;

    /**
     * Get the value of a key and set its expiration in milliseconds
     * @param key The key to get
     * @param px Set the specified expire time, in milliseconds
     * @param milliseconds The number of milliseconds until expiration
     * @returns Promise that resolves with the value of the key, or null if the key doesn't exist
     */
    getex(key: RedisClient.KeyLike, px: "PX", milliseconds: number): Promise<string | null>;

    /**
     * Get the value of a key and set its expiration at a specific Unix timestamp in seconds
     *
     * @param key The key to get
     * @param exat Set the specified Unix time at which the key will expire, in seconds
     * @param timestampSeconds The Unix timestamp in seconds
     * @returns Promise that resolves with the value of the key, or null if the key doesn't exist
     */
    getex(key: RedisClient.KeyLike, exat: "EXAT", timestampSeconds: number): Promise<string | null>;

    /**
     * Get the value of a key and set its expiration at a specific Unix timestamp in milliseconds
     *
     * @param key The key to get
     * @param pxat Set the specified Unix time at which the key will expire, in milliseconds
     * @param timestampMilliseconds The Unix timestamp in milliseconds
     * @returns Promise that resolves with the value of the key, or null if the key doesn't exist
     */
    getex(key: RedisClient.KeyLike, pxat: "PXAT", timestampMilliseconds: number): Promise<string | null>;

    /**
     * Get the value of a key and remove its expiration
     *
     * @param key The key to get
     * @param persist Remove the expiration from the key
     * @returns Promise that resolves with the value of the key, or null if the key doesn't exist
     */
    getex(key: RedisClient.KeyLike, persist: "PERSIST"): Promise<string | null>;

    /**
     *  Ping the server
     *  @returns Promise that resolves with "PONG" if the server is reachable, or throws an error if the server is not reachable
     */
    ping(): Promise<"PONG">;

    /**
     *  Ping the server with a message
     *
     *  @param message The message to send to the server
     *  @returns Promise that resolves with the message if the server is reachable, or throws an error if the server is not reachable
     */
    ping(message: RedisClient.KeyLike): Promise<string>;

    /**
     * Publish a message to a Redis channel.
     *
     * @param channel The channel to publish to.
     * @param message The message to publish.
     *
     * @returns The number of clients that received the message. Note that in a
     * cluster this returns the total number of clients in the same node.
     */
    publish(channel: string, message: string): Promise<number>;

    /**
     * Subscribe to a Redis channel.
     *
     * Subscribing disables automatic pipelining, so all commands will be
     * received immediately.
     *
     * Subscribing moves the channel to a dedicated subscription state which
     * prevents most other commands from being executed until unsubscribed. Only
     * {@link ping `.ping()`}, {@link subscribe `.subscribe()`}, and
     * {@link unsubscribe `.unsubscribe()`} are legal to invoke in a subscribed
     * upon channel.
     *
     * @param channel The channel to subscribe to.
     * @param listener The listener to call when a message is received on the
     * channel. The listener will receive the message as the first argument and
     * the channel as the second argument.
     *
     * @example
     * ```ts
     * await client.subscribe("my-channel", (message, channel) => {
     *   console.log(`Received message on ${channel}: ${message}`);
     * });
     * ```
     */
    subscribe(channel: string, listener: RedisClient.StringPubSubListener): Promise<number>;

    /**
     * Subscribe to multiple Redis channels.
     *
     * Subscribing disables automatic pipelining, so all commands will be
     * received immediately.
     *
     * Subscribing moves the channels to a dedicated subscription state in which
     * only a limited set of commands can be executed.
     *
     * @param channels An array of channels to subscribe to.
     * @param listener The listener to call when a message is received on any of
     * the subscribed channels. The listener will receive the message as the
     * first argument and the channel as the second argument.
     */
    subscribe(channels: string[], listener: RedisClient.StringPubSubListener): Promise<number>;

    /**
     * Unsubscribe from a singular Redis channel.
     *
     * @param channel The channel to unsubscribe from.
     *
     * If there are no more channels subscribed to, the client automatically
     * re-enables pipelining if it was previously enabled.
     *
     * Unsubscribing moves the channel back to a normal state out of the
     * subscription state if all channels have been unsubscribed from. For
     * further details on the subscription state, see
     * {@link subscribe `.subscribe()`}.
     */
    unsubscribe(channel: string): Promise<void>;

    /**
     * Remove a listener from a given Redis channel.
     *
     * If there are no more channels subscribed to, the client automatically
     * re-enables pipelining if it was previously enabled.
     *
     * Unsubscribing moves the channel back to a normal state out of the
     * subscription state if all channels have been unsubscribed from. For
     * further details on the subscription state, see
     * {@link subscribe `.subscribe()`}.
     *
     * @param channel The channel to unsubscribe from.
     * @param listener The listener to remove. This is tested against
     * referential equality so you must pass the exact same listener instance as
     * when subscribing.
     */
    unsubscribe(channel: string, listener: RedisClient.StringPubSubListener): Promise<void>;

    /**
     * Unsubscribe from all registered Redis channels.
     *
     * The client will automatically re-enable pipelining if it was previously
     * enabled.
     *
     * Unsubscribing moves the channel back to a normal state out of the
     * subscription state if all channels have been unsubscribed from. For
     * further details on the subscription state, see
     * {@link subscribe `.subscribe()`}.
     */
    unsubscribe(): Promise<void>;

    /**
     * Unsubscribe from multiple Redis channels.
     *
     * @param channels An array of channels to unsubscribe from.
     *
     * If there are no more channels subscribed to, the client automatically
     * re-enables pipelining if it was previously enabled.
     *
     * Unsubscribing moves the channel back to a normal state out of the
     * subscription state if all channels have been unsubscribed from. For
     * further details on the subscription state, see
     * {@link subscribe `.subscribe()`}.
     */
    unsubscribe(channels: string[]): Promise<void>;

    /**
     * @brief Create a new RedisClient instance with the same configuration as
     *        the current instance.
     *
     * This will open up a new connection to the Redis server.
     */
    duplicate(): Promise<RedisClient>;

    /**
     * Copy the value stored at the source key to the destination key
     *
     * By default, the destination key is created in the logical database used
     * by the connection. The REPLACE option removes the destination key before
     * copying the value to it.
     *
     * @param source The source key to copy from
     * @param destination The destination key to copy to
     * @returns Promise that resolves with 1 if the key was copied, 0 if not
     *
     * @example
     * ```ts
     * await redis.set("mykey", "Hello");
     * await redis.copy("mykey", "myotherkey");
     * console.log(await redis.get("myotherkey")); // "Hello"
     * ```
     */
    copy(source: RedisClient.KeyLike, destination: RedisClient.KeyLike): Promise<number>;

    /**
     * Copy the value stored at the source key to the destination key, optionally replacing it
     *
     * The REPLACE option removes the destination key before copying the value to it.
     *
     * @param source The source key to copy from
     * @param destination The destination key to copy to
     * @param replace "REPLACE" - Remove the destination key before copying
     * @returns Promise that resolves with 1 if the key was copied, 0 if not
     *
     * @example
     * ```ts
     * await redis.set("mykey", "Hello");
     * await redis.set("myotherkey", "World");
     * await redis.copy("mykey", "myotherkey", "REPLACE");
     * console.log(await redis.get("myotherkey")); // "Hello"
     * ```
     */
    copy(source: RedisClient.KeyLike, destination: RedisClient.KeyLike, replace: "REPLACE"): Promise<number>;

    /**
     * Asynchronously delete one or more keys
     *
     * This command is very similar to DEL: it removes the specified keys.
     * Just like DEL a key is ignored if it does not exist. However, the
     * command performs the actual memory reclaiming in a different thread, so
     * it is not blocking, while DEL is. This is particularly useful when
     * deleting large values or large numbers of keys.
     *
     * @param keys The keys to delete
     * @returns Promise that resolves with the number of keys that were unlinked
     *
     * @example
     * ```ts
     * await redis.set("key1", "Hello");
     * await redis.set("key2", "World");
     * const count = await redis.unlink("key1", "key2", "key3");
     * console.log(count); // 2
     * ```
     */
    unlink(...keys: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Alters the last access time of one or more keys
     *
     * A key is ignored if it does not exist. The command returns the number
     * of keys that were touched.
     *
     * This command is useful in conjunction with maxmemory-policy
     * allkeys-lru / volatile-lru to change the last access time of keys for
     * eviction purposes.
     *
     * @param keys One or more keys to touch
     * @returns Promise that resolves with the number of keys that were touched
     *
     * @example
     * ```ts
     * await redis.set("key1", "Hello");
     * await redis.set("key2", "World");
     * const touched = await redis.touch("key1", "key2", "key3");
     * console.log(touched); // 2 (key3 doesn't exist)
     * ```
     */
    touch(...keys: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Rename a key to a new key
     *
     * Renames key to newkey. If newkey already exists, it is overwritten. If
     * key does not exist, an error is returned.
     *
     * @param key The key to rename
     * @param newkey The new key name
     * @returns Promise that resolves with "OK" on success
     *
     * @example
     * ```ts
     * await redis.set("mykey", "Hello");
     * await redis.rename("mykey", "myotherkey");
     * const value = await redis.get("myotherkey"); // "Hello"
     * const oldValue = await redis.get("mykey"); // null
     * ```
     */
    rename(key: RedisClient.KeyLike, newkey: RedisClient.KeyLike): Promise<"OK">;

    /**
     * Rename a key to a new key only if the new key does not exist
     *
     * Renames key to newkey only if newkey does not yet exist. If key does not
     * exist, an error is returned.
     *
     * @param key The key to rename
     * @param newkey The new key name
     * @returns Promise that resolves with 1 if the key was renamed, 0 if newkey already exists
     *
     * @example
     * ```ts
     * await redis.set("mykey", "Hello");
     * await redis.renamenx("mykey", "myotherkey"); // Returns 1
     * await redis.set("mykey2", "World");
     * await redis.renamenx("mykey2", "myotherkey"); // Returns 0 (myotherkey exists)
     * ```
     */
    renamenx(key: RedisClient.KeyLike, newkey: RedisClient.KeyLike): Promise<number>;

    /**
     * Compute the difference between sorted sets with scores
     *
     * @param numkeys The number of sorted set keys
     * @param keys The sorted set keys followed by "WITHSCORES"
     * @returns Promise that resolves with an array of [member, score] pairs
     *
     * @example
     * ```ts
     * await redis.send("ZADD", ["zset1", "1", "one", "2", "two", "3", "three"]);
     * await redis.send("ZADD", ["zset2", "1", "one", "2", "two"]);
     * const diff = await redis.zdiff(2, "zset1", "zset2", "WITHSCORES");
     * console.log(diff); // ["three", "3"]
     * ```
     */
    zdiff(
      numkeys: number,
      ...args: [...keys: RedisClient.KeyLike[], withscores: "WITHSCORES"]
    ): Promise<[string, number][]>;

    /**
     * Compute the difference between the first sorted set and all successive sorted sets
     *
     * Returns the members of the sorted set resulting from the difference between the first
     * sorted set and all the successive sorted sets. The first key is the only one used to
     * compute the members of the difference.
     *
     * @param numkeys The number of sorted set keys
     * @param keys The sorted set keys to compare
     * @returns Promise that resolves with an array of members
     *
     * @example
     * ```ts
     * await redis.send("ZADD", ["zset1", "1", "one", "2", "two", "3", "three"]);
     * await redis.send("ZADD", ["zset2", "1", "one", "2", "two"]);
     * const diff = await redis.zdiff(2, "zset1", "zset2");
     * console.log(diff); // ["three"]
     * ```
     */
    zdiff(numkeys: number, ...keys: RedisClient.KeyLike[]): Promise<string[]>;

    /**
     * Compute the difference between sorted sets and store the result
     *
     * Computes the difference between the first and all successive sorted sets given by the
     * specified keys and stores the result in destination. Keys that do not exist are
     * considered to be empty sets.
     *
     * @param destination The destination key to store the result
     * @param numkeys The number of input sorted set keys
     * @param keys The sorted set keys to compare
     * @returns Promise that resolves with the number of elements in the resulting sorted set
     *
     * @example
     * ```ts
     * await redis.send("ZADD", ["zset1", "1", "one", "2", "two", "3", "three"]);
     * await redis.send("ZADD", ["zset2", "1", "one"]);
     * const count = await redis.zdiffstore("out", 2, "zset1", "zset2");
     * console.log(count); // 2 (two, three)
     * ```
     */
    zdiffstore(destination: RedisClient.KeyLike, numkeys: number, ...keys: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Compute the intersection of multiple sorted sets
     *
     * Returns the members of the set resulting from the intersection of all the given sorted sets.
     * Keys that do not exist are considered to be empty sets.
     *
     * By default, the resulting score of each member is the sum of its scores in the sorted sets where it exists.
     *
     * Options:
     * - WEIGHTS: Multiply the score of each member in the corresponding sorted set by the given weight before aggregation
     * - AGGREGATE SUM|MIN|MAX: Specify how the scores are aggregated (default: SUM)
     * - WITHSCORES: Return the scores along with the members
     *
     * @param numkeys The number of input keys (sorted sets)
     * @param keys The sorted set keys to intersect
     * @returns Promise that resolves with an array of members (or [member, score] pairs if WITHSCORES)
     *
     * @example
     * ```ts
     * // Set up sorted sets
     * await redis.zadd("zset1", "1", "a", "2", "b", "3", "c");
     * await redis.zadd("zset2", "1", "b", "2", "c", "3", "d");
     *
     * // Basic intersection - returns members that exist in all sets
     * const result1 = await redis.zinter(2, "zset1", "zset2");
     * // Returns: ["b", "c"]
     *
     * // With scores (sum by default)
     * const result2 = await redis.zinter(2, "zset1", "zset2", "WITHSCORES");
     * // Returns: ["b", "3", "c", "5"] (b: 2+1=3, c: 3+2=5)
     *
     * // With weights
     * const result3 = await redis.zinter(2, "zset1", "zset2", "WEIGHTS", "2", "3", "WITHSCORES");
     * // Returns: ["b", "7", "c", "12"] (b: 2*2+1*3=7, c: 3*2+2*3=12)
     *
     * // With MIN aggregation
     * const result4 = await redis.zinter(2, "zset1", "zset2", "AGGREGATE", "MIN", "WITHSCORES");
     * // Returns: ["b", "1", "c", "2"] (minimum scores)
     * ```
     */
    zinter(
      numkeys: number,
      ...args: [...args: (string | number)[], withscores: "WITHSCORES"]
    ): Promise<[string, number][]>;

    /**
     * Compute the intersection of multiple sorted sets
     *
     * Returns the members of the set resulting from the intersection of all the given sorted sets.
     * Keys that do not exist are considered to be empty sets.
     *
     * By default, the resulting score of each member is the sum of its scores in the sorted sets where it exists.
     *
     * Options:
     * - WEIGHTS: Multiply the score of each member in the corresponding sorted set by the given weight before aggregation
     * - AGGREGATE SUM|MIN|MAX: Specify how the scores are aggregated (default: SUM)
     * - WITHSCORES: Return the scores along with the members
     *
     * @param numkeys The number of input keys (sorted sets)
     * @param keys The sorted set keys to intersect
     * @returns Promise that resolves with an array of members (or [member, score] pairs if WITHSCORES)
     *
     * @example
     * ```ts
     * // Set up sorted sets
     * await redis.zadd("zset1", "1", "a", "2", "b", "3", "c");
     * await redis.zadd("zset2", "1", "b", "2", "c", "3", "d");
     *
     * // Basic intersection - returns members that exist in all sets
     * const result1 = await redis.zinter(2, "zset1", "zset2");
     * // Returns: ["b", "c"]
     *
     * // With scores (sum by default)
     * const result2 = await redis.zinter(2, "zset1", "zset2", "WITHSCORES");
     * // Returns: ["b", "3", "c", "5"] (b: 2+1=3, c: 3+2=5)
     *
     * // With weights
     * const result3 = await redis.zinter(2, "zset1", "zset2", "WEIGHTS", "2", "3", "WITHSCORES");
     * // Returns: ["b", "7", "c", "12"] (b: 2*2+1*3=7, c: 3*2+2*3=12)
     *
     * // With MIN aggregation
     * const result4 = await redis.zinter(2, "zset1", "zset2", "AGGREGATE", "MIN", "WITHSCORES");
     * // Returns: ["b", "1", "c", "2"] (minimum scores)
     * ```
     */
    zinter(numkeys: number, ...args: (string | number)[]): Promise<string[]>;

    /**
     * Count the number of members in the intersection of multiple sorted sets
     *
     * Computes the cardinality of the intersection of the sorted sets at the specified keys.
     * The intersection includes only elements that exist in all of the given sorted sets.
     *
     * When a LIMIT is provided, the command stops counting once the limit is reached, which
     * is useful for performance when you only need to know if the cardinality exceeds a
     * certain threshold.
     *
     * @param numkeys The number of sorted set keys
     * @param keys The sorted set keys to intersect
     * @returns Promise that resolves with the number of elements in the intersection
     *
     * @example
     * ```ts
     * await redis.send("ZADD", ["zset1", "1", "one", "2", "two", "3", "three"]);
     * await redis.send("ZADD", ["zset2", "1", "one", "2", "two", "4", "four"]);
     * const count = await redis.zintercard(2, "zset1", "zset2");
     * console.log(count); // 2 (one, two)
     * ```
     */
    zintercard(numkeys: number, ...keys: RedisClient.KeyLike[]): Promise<number>;

    /**
     * Count the number of members in the intersection with a limit
     *
     * @param numkeys The number of sorted set keys
     * @param keys The sorted set keys followed by "LIMIT" and limit value
     * @returns Promise that resolves with the number of elements (up to limit)
     *
     * @example
     * ```ts
     * await redis.send("ZADD", ["zset1", "1", "a", "2", "b", "3", "c"]);
     * await redis.send("ZADD", ["zset2", "1", "a", "2", "b", "3", "c"]);
     * const count = await redis.zintercard(2, "zset1", "zset2", "LIMIT", 2);
     * console.log(count); // 2 (stopped at limit)
     * ```
     */
    zintercard(numkeys: number, ...args: (RedisClient.KeyLike | "LIMIT" | number)[]): Promise<number>;

    /**
     * Compute the intersection of multiple sorted sets and store in destination
     *
     * This command is similar to ZINTER, but instead of returning the result, it stores it in the destination key.
     * If the destination key already exists, it is overwritten.
     *
     * Options:
     * - WEIGHTS: Multiply the score of each member in the corresponding sorted set by the given weight before aggregation
     * - AGGREGATE SUM|MIN|MAX: Specify how the scores are aggregated (default: SUM)
     *
     * @param destination The destination key to store the result
     * @param numkeys The number of input keys (sorted sets)
     * @param keys The sorted set keys to intersect and optional WEIGHTS/AGGREGATE options
     * @returns Promise that resolves with the number of elements in the resulting sorted set
     *
     * @example
     * ```ts
     * // Set up sorted sets
     * await redis.zadd("zset1", "1", "a", "2", "b", "3", "c");
     * await redis.zadd("zset2", "1", "b", "2", "c", "3", "d");
     *
     * // Basic intersection store
     * const count1 = await redis.zinterstore("out", 2, "zset1", "zset2");
     * // Returns: 2 (stored "b" and "c" in "out")
     *
     * // With weights
     * const count2 = await redis.zinterstore("out2", 2, "zset1", "zset2", "WEIGHTS", "2", "3");
     * // Returns: 2
     *
     * // With MAX aggregation
     * const count3 = await redis.zinterstore("out3", 2, "zset1", "zset2", "AGGREGATE", "MAX");
     * // Returns: 2 (stores maximum scores)
     * ```
     */
    zinterstore(destination: RedisClient.KeyLike, numkeys: number, ...args: (string | number)[]): Promise<number>;

    /**
     * Compute the union of multiple sorted sets
     *
     * Returns the union of the sorted sets given by the specified keys.
     * For every element that appears in at least one of the input sorted sets, the output will contain that element.
     *
     * Options:
     * - WEIGHTS: Multiply the score of each member in the corresponding sorted set by the given weight before aggregation
     * - AGGREGATE SUM|MIN|MAX: Specify how the scores are aggregated (default: SUM)
     * - WITHSCORES: Include scores in the result
     *
     * @param numkeys The number of input keys (sorted sets)
     * @param keys The sorted set keys to union and optional WEIGHTS/AGGREGATE/WITHSCORES options
     * @returns Promise that resolves with an array of members (or members with scores if WITHSCORES is used)
     *
     * @example
     * ```ts
     * // Set up sorted sets
     * await redis.zadd("zset1", "1", "a", "2", "b", "3", "c");
     * await redis.zadd("zset2", "4", "b", "5", "c", "6", "d");
     *
     * // Basic union
     * const members1 = await redis.zunion(2, "zset1", "zset2");
     * // Returns: ["a", "b", "c", "d"]
     *
     * // With weights
     * const members2 = await redis.zunion(2, "zset1", "zset2", "WEIGHTS", "2", "3");
     * // Returns: ["a", "b", "c", "d"] with calculated scores
     *
     * // With MIN aggregation
     * const members3 = await redis.zunion(2, "zset1", "zset2", "AGGREGATE", "MIN");
     * // Returns: ["a", "b", "c", "d"] with minimum scores
     *
     * // With scores
     * const withScores = await redis.zunion(2, "zset1", "zset2", "WITHSCORES");
     * // Returns: ["a", "1", "b", "2", "c", "3", "d", "6"] (alternating member and score)
     * ```
     */
    zunion(
      numkeys: number,
      ...args: [...args: (string | number)[], withscores: "WITHSCORES"]
    ): Promise<[string, number][]>;

    /**
     * Compute the union of multiple sorted sets
     *
     * Returns the union of the sorted sets given by the specified keys.
     * For every element that appears in at least one of the input sorted sets, the output will contain that element.
     *
     * Options:
     * - WEIGHTS: Multiply the score of each member in the corresponding sorted set by the given weight before aggregation
     * - AGGREGATE SUM|MIN|MAX: Specify how the scores are aggregated (default: SUM)
     * - WITHSCORES: Include scores in the result
     *
     * @param numkeys The number of input keys (sorted sets)
     * @param keys The sorted set keys to union and optional WEIGHTS/AGGREGATE/WITHSCORES options
     * @returns Promise that resolves with an array of members (or members with scores if WITHSCORES is used)
     *
     * @example
     * ```ts
     * // Set up sorted sets
     * await redis.zadd("zset1", "1", "a", "2", "b", "3", "c");
     * await redis.zadd("zset2", "4", "b", "5", "c", "6", "d");
     *
     * // Basic union
     * const members1 = await redis.zunion(2, "zset1", "zset2");
     * // Returns: ["a", "b", "c", "d"]
     *
     * // With weights
     * const members2 = await redis.zunion(2, "zset1", "zset2", "WEIGHTS", "2", "3");
     * // Returns: ["a", "b", "c", "d"] with calculated scores
     *
     * // With MIN aggregation
     * const members3 = await redis.zunion(2, "zset1", "zset2", "AGGREGATE", "MIN");
     * // Returns: ["a", "b", "c", "d"] with minimum scores
     *
     * // With scores
     * const withScores = await redis.zunion(2, "zset1", "zset2", "WITHSCORES");
     * // Returns: ["a", "1", "b", "2", "c", "3", "d", "6"] (alternating member and score)
     * ```
     */
    zunion(numkeys: number, ...args: (string | number)[]): Promise<string[]>;

    /**
     * Compute the union of multiple sorted sets and store in destination
     *
     * This command is similar to ZUNION, but instead of returning the result, it stores it in the destination key.
     * If the destination key already exists, it is overwritten.
     *
     * Options:
     * - WEIGHTS: Multiply the score of each member in the corresponding sorted set by the given weight before aggregation
     * - AGGREGATE SUM|MIN|MAX: Specify how the scores are aggregated (default: SUM)
     *
     * @param destination The destination key to store the result
     * @param numkeys The number of input keys (sorted sets)
     * @param keys The sorted set keys to union and optional WEIGHTS/AGGREGATE options
     * @returns Promise that resolves with the number of elements in the resulting sorted set
     *
     * @example
     * ```ts
     * // Set up sorted sets
     * await redis.zadd("zset1", "1", "a", "2", "b", "3", "c");
     * await redis.zadd("zset2", "4", "b", "5", "c", "6", "d");
     *
     * // Basic union store
     * const count1 = await redis.zunionstore("out", 2, "zset1", "zset2");
     * // Returns: 4 (stored "a", "b", "c", "d" in "out")
     *
     * // With weights
     * const count2 = await redis.zunionstore("out2", 2, "zset1", "zset2", "WEIGHTS", "2", "3");
     * // Returns: 4
     *
     * // With MAX aggregation
     * const count3 = await redis.zunionstore("out3", 2, "zset1", "zset2", "AGGREGATE", "MAX");
     * // Returns: 4 (stores maximum scores)
     * ```
     */
    zunionstore(destination: RedisClient.KeyLike, numkeys: number, ...args: (string | number)[]): Promise<number>;

    /**
     * Remove and return members with scores from one or more sorted sets.
     * Pops from the first non-empty sorted set.
     *
     * @example
     * ```ts
     * // Pop lowest score from one set
     * const result1 = await redis.zmpop(1, "myzset", "MIN");
     * // Returns: ["myzset", [["member1", 1]]]
     *
     * // Pop highest score from multiple sets
     * const result2 = await redis.zmpop(2, "zset1", "zset2", "MAX");
     * // Returns: ["zset1", [["member5", 5]]] (pops from first non-empty)
     *
     * // Pop multiple members
     * const result3 = await redis.zmpop(1, "myzset", "MIN", "COUNT", 3);
     * // Returns: ["myzset", [["member1", 1], ["member2", 2], ["member3", 3]]]
     *
     * // Empty set returns null
     * const result4 = await redis.zmpop(1, "emptyset", "MIN");
     * // Returns: null
     * ```
     */
    zmpop(numkeys: number, ...args: (string | number)[]): Promise<[string, [string, number][]] | null>;

    /**
     * Blocking version of ZMPOP. Blocks until a member is available or timeout expires.
     *
     * @example
     * ```ts
     * // Block for 5 seconds waiting for a member
     * const result1 = await redis.bzmpop(5, 1, "myzset", "MIN");
     * // Returns: ["myzset", [["member1", 1]]] or null if timeout
     *
     * // Block indefinitely (timeout 0)
     * const result2 = await redis.bzmpop(0, 2, "zset1", "zset2", "MAX");
     * // Returns: ["zset1", [["member5", 5]]]
     *
     * // Block with COUNT option
     * const result3 = await redis.bzmpop(1, 1, "myzset", "MIN", "COUNT", 2);
     * // Returns: ["myzset", [["member1", 1], ["member2", 2]]] or null if timeout
     * ```
     */
    bzmpop(
      timeout: number,
      numkeys: number,
      ...args: (string | number)[]
    ): Promise<[string, [string, number][]] | null>;
  }

  /**
   * Default Redis client
   *
   * Connection information populated from one of, in order of preference:
   * - `process.env.VALKEY_URL`
   * - `process.env.REDIS_URL`
   * - `"valkey://localhost:6379"`
   *
   */
  export const redis: RedisClient;
}
