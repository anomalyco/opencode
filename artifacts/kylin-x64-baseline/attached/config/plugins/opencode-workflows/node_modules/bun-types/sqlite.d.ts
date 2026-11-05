/**
 * Fast SQLite3 driver for Bun.js
 * @since v0.0.83
 *
 * @example
 * ```ts
 * import { Database } from 'bun:sqlite';
 *
 * const db = new Database('app.db');
 * db.query('SELECT * FROM users WHERE name = ?').all('John');
 * // => [{ id: 1, name: 'John' }]
 * ```
 *
 * The following types can be used when binding parameters:
 *
 * | JavaScript type | SQLite type            |
 * | --------------- | ---------------------- |
 * | `string`        | `TEXT`                 |
 * | `number`        | `INTEGER` or `DECIMAL` |
 * | `boolean`       | `INTEGER` (1 or 0)     |
 * | `Uint8Array`    | `BLOB`                 |
 * | `Buffer`        | `BLOB`                 |
 * | `bigint`        | `INTEGER`              |
 * | `null`          | `NULL`                 |
 */
declare module "bun:sqlite" {
  /**
   * Options for {@link Database}
   */
  export interface DatabaseOptions {
    /**
     * Open the database as read-only (no write operations, no create).
     *
     * Equivalent to {@link constants.SQLITE_OPEN_READONLY}
     */
    readonly?: boolean;

    /**
     * Allow creating a new database
     *
     * Equivalent to {@link constants.SQLITE_OPEN_CREATE}
     */
    create?: boolean;

    /**
     * Open the database as read-write
     *
     * Equivalent to {@link constants.SQLITE_OPEN_READWRITE}
     */
    readwrite?: boolean;

    /**
     * When set to `true`, integers are returned as `bigint` types.
     *
     * When set to `false`, integers are returned as `number` types and truncated to 52 bits.
     *
     * @default false
     * @since v1.1.14
     */
    safeIntegers?: boolean;

    /**
     * When set to `false` or `undefined`:
     * - Queries missing bound parameters will NOT throw an error
     * - Bound named parameters in JavaScript need to exactly match the SQL query.
     *
     * @example
     * ```ts
     * const db = new Database(":memory:", { strict: false });
     * db.run("INSERT INTO foo (name) VALUES ($name)", { $name: "foo" });
     * ```
     *
     * When set to `true`:
     * - Queries missing bound parameters will throw an error
     * - Bound named parameters in JavaScript no longer need to be `$`, `:`, or `@`. The SQL query will remain prefixed.
     *
     * @example
     * ```ts
     * const db = new Database(":memory:", { strict: true });
     * db.run("INSERT INTO foo (name) VALUES ($name)", { name: "foo" });
     * ```
     * @since v1.1.14
     */
    strict?: boolean;
  }

  /**
   * A SQLite3 database
   *
   * @example
   * ```ts
   * const db = new Database("mydb.sqlite");
   * db.run("CREATE TABLE foo (bar TEXT)");
   * db.run("INSERT INTO foo VALUES (?)", ["baz"]);
   * console.log(db.query("SELECT * FROM foo").all());
   * ```
   *
   * @example
   *
   * Open an in-memory database
   *
   * ```ts
   * const db = new Database(":memory:");
   * db.run("CREATE TABLE foo (bar TEXT)");
   * db.run("INSERT INTO foo VALUES (?)", ["hiiiiii"]);
   * console.log(db.query("SELECT * FROM foo").all());
   * ```
   *
   * @example
   *
   * Open read-only
   *
   * ```ts
   * const db = new Database("mydb.sqlite", {readonly: true});
   * ```
   */
  export class Database implements Disposable {
    /**
     * Open or create a SQLite3 database
     *
     * @param filename The filename of the database to open. Pass an empty string (`""`) or `":memory:"` or undefined for an in-memory database.
     * @param options defaults to `{readwrite: true, create: true}`. If a number, then it's treated as `SQLITE_OPEN_*` constant flags.
     */
    constructor(filename?: string, options?: number | DatabaseOptions);

    /**
     * Open or create a SQLite3 databases
     *
     * @param filename The filename of the database to open. Pass an empty string (`""`) or `":memory:"` or undefined for an in-memory database.
     * @param options defaults to `{readwrite: true, create: true}`. If a number, then it's treated as `SQLITE_OPEN_*` constant flags.
     *
     * This is an alias of `new Database()`
     *
     * See {@link Database}
     */
    static open(filename: string, options?: number | DatabaseOptions): Database;

    /**
     * Execute a SQL query **without returning any results**.
     *
     * This does not cache the query, so if you want to run a query multiple times, you should use {@link prepare} instead.
     *
     * Under the hood, this calls `sqlite3_prepare_v3` followed by `sqlite3_step` and `sqlite3_finalize`.
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type            |
     * | --------------- | ---------------------- |
     * | `string`        | `TEXT`                 |
     * | `number`        | `INTEGER` or `DECIMAL` |
     * | `boolean`       | `INTEGER` (1 or 0)     |
     * | `Uint8Array`    | `BLOB`                 |
     * | `Buffer`        | `BLOB`                 |
     * | `bigint`        | `INTEGER`              |
     * | `null`          | `NULL`                 |
     *
     * Useful for queries like:
     * - `CREATE TABLE`
     * - `INSERT INTO`
     * - `UPDATE`
     * - `DELETE FROM`
     * - `DROP TABLE`
     * - `PRAGMA`
     * - `ATTACH DATABASE`
     * - `DETACH DATABASE`
     * - `REINDEX`
     * - `VACUUM`
     * - `EXPLAIN ANALYZE`
     * - `CREATE INDEX`
     * - `CREATE TRIGGER`
     * - `CREATE VIEW`
     * - `CREATE VIRTUAL TABLE`
     * - `CREATE TEMPORARY TABLE`
     *
     * @param sql The SQL query to run
     * @param bindings Optional bindings for the query
     * @returns A `Changes` object with `changes` and `lastInsertRowid` properties
     *
     * @example
     * ```ts
     * db.run("CREATE TABLE foo (bar TEXT)");
     * db.run("INSERT INTO foo VALUES (?)", ["baz"]);
     * // => { changes: 1, lastInsertRowid: 1 }
     * ```
     */
    run<ParamsType extends SQLQueryBindings[]>(sql: string, ...bindings: ParamsType[]): Changes;

    /**
     * This is an alias of {@link Database.run}
     *
     * @deprecated Prefer {@link Database.run}
     */
    exec<ParamsType extends SQLQueryBindings[]>(sql: string, ...bindings: ParamsType[]): Changes;

    /**
     * Compile a SQL query and return a {@link Statement} object. This is the
     * same as {@link prepare} except that it caches the compiled query.
     *
     * This **does not execute** the query, but instead prepares it for later
     * execution and caches the compiled query if possible.
     *
     * Under the hood, this calls `sqlite3_prepare_v3`.
     *
     * @example
     * ```ts
     * // compile the query
     * const stmt = db.query("SELECT * FROM foo WHERE bar = ?");
     * // run the query
     * stmt.all("baz");
     *
     * // run the query again
     * stmt.all();
     * ```
     *
     * @param sql The SQL query to compile
     * @returns `Statment` instance
     */
    query<ReturnType, ParamsType extends SQLQueryBindings | SQLQueryBindings[]>(
      sql: string,
    ): Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]>;

    /**
     * Compile a SQL query and return a {@link Statement} object.
     *
     * This does not cache the compiled query and does not execute the query.
     *
     * Under the hood, this calls `sqlite3_prepare_v3`.
     *
     * @example
     * ```ts
     * // compile the query
     * const stmt = db.query("SELECT * FROM foo WHERE bar = ?");
     * // run the query
     * stmt.all("baz");
     * ```
     *
     * @param sql The SQL query to compile
     * @param params Optional bindings for the query
     *
     * @returns A {@link Statement} instance
     */
    prepare<ReturnType, ParamsType extends SQLQueryBindings | SQLQueryBindings[]>(
      sql: string,
      params?: ParamsType,
    ): Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]>;

    /**
     * Is the database in a transaction?
     *
     * @returns `true` if the database is in a transaction, `false` otherwise
     *
     * @example
     * ```ts
     * db.run("CREATE TABLE foo (bar TEXT)");
     * db.run("INSERT INTO foo VALUES (?)", ["baz"]);
     * db.run("BEGIN");
     * db.run("INSERT INTO foo VALUES (?)", ["qux"]);
     * console.log(db.inTransaction());
     * ```
     */
    get inTransaction(): boolean;

    /**
     * Close the database connection.
     *
     * It is safe to call this method multiple times. If the database is already
     * closed, this is a no-op. Running queries after the database has been
     * closed will throw an error.
     *
     * @example
     * ```ts
     * db.close();
     * ```
     * This is called automatically when the database instance is garbage collected.
     *
     * Internally, this calls `sqlite3_close_v2`.
     */
    close(
      /**
       * If `true`, then the database will throw an error if it is in use
       * @default false
       *
       * When true, this calls `sqlite3_close` instead of `sqlite3_close_v2`.
       *
       * Learn more about this in the [sqlite3 documentation](https://www.sqlite.org/c3ref/close.html).
       *
       * Bun will automatically call close by default when the database instance is garbage collected.
       * In The future, Bun may default `throwOnError` to be true but for backwards compatibility, it is false by default.
       */
      throwOnError?: boolean,
    ): void;

    /**
     * The filename passed when `new Database()` was called
     * @example
     * ```ts
     * const db = new Database("mydb.sqlite");
     * console.log(db.filename);
     * // => "mydb.sqlite"
     * ```
     */
    readonly filename: string;

    /**
     * The underlying `sqlite3` database handle
     *
     * In native code, this is not a file descriptor, but an index into an array of database handles
     */
    readonly handle: number;

    /**
     * Load a SQLite3 extension
     *
     * macOS requires a custom SQLite3 library to be linked because the Apple build of SQLite for macOS disables loading extensions. See {@link Database.setCustomSQLite}
     *
     * Bun chooses the Apple build of SQLite on macOS because it brings a ~50% performance improvement.
     *
     * @param extension name/path of the extension to load
     * @param entryPoint optional entry point of the extension
     */
    loadExtension(extension: string, entryPoint?: string): void;

    /**
     * Change the dynamic library path to SQLite
     *
     * @note macOS-only
     *
     * This only works before SQLite is loaded, so
     * that's before you call `new Database()`.
     *
     * It can only be run once because this will load
     * the SQLite library into the process.
     *
     * @param path The path to the SQLite library
     */
    static setCustomSQLite(path: string): boolean;

    /**
     * Closes the database when using the async resource proposal
     *
     * @example
     * ```
     * using db = new Database("myapp.db");
     * doSomethingWithDatabase(db);
     * // Automatically closed when `db` goes out of scope
     * ```
     */
    [Symbol.dispose](): void;

    /**
     * Creates a function that always runs inside a transaction. When the
     * function is invoked, it will begin a new transaction. When the function
     * returns, the transaction will be committed. If an exception is thrown,
     * the transaction will be rolled back (and the exception will propagate as
     * usual).
     *
     * @param insideTransaction The callback which runs inside a transaction
     *
     * @example
     * ```ts
     * // setup
     * import { Database } from "bun:sqlite";
     * const db = Database.open(":memory:");
     * db.exec(
     *   "CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, age INTEGER)"
     * );
     *
     * const insert = db.prepare("INSERT INTO cats (name, age) VALUES ($name, $age)");
     * const insertMany = db.transaction((cats) => {
     *   for (const cat of cats) insert.run(cat);
     * });
     *
     * insertMany([
     *   { $name: "Joey", $age: 2 },
     *   { $name: "Sally", $age: 4 },
     *   { $name: "Junior", $age: 1 },
     * ]);
     * ```
     */
    transaction<A extends any[], T>(
      insideTransaction: (...args: A) => T,
    ): {
      /**
       * Execute the transaction
       */
      (...args: A): T;

      /**
       * Execute the transaction using "BEGIN DEFERRED"
       */
      deferred: (...args: A) => T;

      /**
       * Execute the transaction using "BEGIN IMMEDIATE"
       */
      immediate: (...args: A) => T;

      /**
       * Execute the transaction using "BEGIN EXCLUSIVE"
       */
      exclusive: (...args: A) => T;
    };

    /**
     * Save the database to an in-memory {@link Buffer} object.
     *
     * Internally, this calls `sqlite3_serialize`.
     *
     * @param name Name to save the database as @default "main"
     * @returns Buffer containing the serialized database
     */
    serialize(name?: string): Buffer;

    /**
     * Load a serialized SQLite3 database
     *
     * Internally, this calls `sqlite3_deserialize`.
     *
     * @param serialized Data to load
     * @returns `Database` instance
     *
     * @example
     * ```ts
     * test("supports serialize/deserialize", () => {
     *     const db = Database.open(":memory:");
     *     db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
     *     db.exec('INSERT INTO test (name) VALUES ("Hello")');
     *     db.exec('INSERT INTO test (name) VALUES ("World")');
     *
     *     const input = db.serialize();
     *     const db2 = new Database(input);
     *
     *     const stmt = db2.prepare("SELECT * FROM test");
     *     expect(JSON.stringify(stmt.get())).toBe(
     *       JSON.stringify({
     *         id: 1,
     *         name: "Hello",
     *       }),
     *     );
     *
     *     expect(JSON.stringify(stmt.all())).toBe(
     *       JSON.stringify([
     *         {
     *           id: 1,
     *           name: "Hello",
     *         },
     *         {
     *           id: 2,
     *           name: "World",
     *         },
     *       ]),
     *     );
     *     db2.exec("insert into test (name) values ('foo')");
     *     expect(JSON.stringify(stmt.all())).toBe(
     *       JSON.stringify([
     *         {
     *           id: 1,
     *           name: "Hello",
     *         },
     *         {
     *           id: 2,
     *           name: "World",
     *         },
     *         {
     *           id: 3,
     *           name: "foo",
     *         },
     *       ]),
     *     );
     *
     *     const db3 = Database.deserialize(input, true);
     *     try {
     *       db3.exec("insert into test (name) values ('foo')");
     *       throw new Error("Expected error");
     *     } catch (e) {
     *       expect(e.message).toBe("attempt to write a readonly database");
     *     }
     * });
     * ```
     */
    static deserialize(serialized: NodeJS.TypedArray | ArrayBufferLike, isReadOnly?: boolean): Database;

    /**
     * Load a serialized SQLite3 database. This version enables you to specify
     * additional options such as `strict` to put the database into strict mode.
     *
     * Internally, this calls `sqlite3_deserialize`.
     *
     * @param serialized Data to load
     * @returns `Database` instance
     *
     * @example
     * ```ts
     * test("supports serialize/deserialize", () => {
     *     const db = Database.open(":memory:");
     *     db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
     *     db.exec('INSERT INTO test (name) VALUES ("Hello")');
     *     db.exec('INSERT INTO test (name) VALUES ("World")');
     *
     *     const input = db.serialize();
     *     const db2 = Database.deserialize(input, { strict: true });
     *
     *     const stmt = db2.prepare("SELECT * FROM test");
     *     expect(JSON.stringify(stmt.get())).toBe(
     *       JSON.stringify({
     *         id: 1,
     *         name: "Hello",
     *       }),
     *     );
     *
     *     expect(JSON.stringify(stmt.all())).toBe(
     *       JSON.stringify([
     *         {
     *           id: 1,
     *           name: "Hello",
     *         },
     *         {
     *           id: 2,
     *           name: "World",
     *         },
     *       ]),
     *     );
     *     db2.exec("insert into test (name) values ($foo)", { foo: "baz" });
     *     expect(JSON.stringify(stmt.all())).toBe(
     *       JSON.stringify([
     *         {
     *           id: 1,
     *           name: "Hello",
     *         },
     *         {
     *           id: 2,
     *           name: "World",
     *         },
     *         {
     *           id: 3,
     *           name: "baz",
     *         },
     *       ]),
     *     );
     *
     *     const db3 = Database.deserialize(input, { readonly: true, strict: true });
     *     try {
     *       db3.exec("insert into test (name) values ($foo)", { foo: "baz" });
     *       throw new Error("Expected error");
     *     } catch (e) {
     *       expect(e.message).toBe("attempt to write a readonly database");
     *     }
     * });
     * ```
     */
    static deserialize(
      serialized: NodeJS.TypedArray | ArrayBufferLike,
      options?: { readonly?: boolean; strict?: boolean; safeIntegers?: boolean },
    ): Database;

    /**
     * See `sqlite3_file_control` for more information.
     * @link https://www.sqlite.org/c3ref/file_control.html
     */
    fileControl(op: number, arg?: ArrayBufferView | number): number;
    /**
     * See `sqlite3_file_control` for more information.
     * @link https://www.sqlite.org/c3ref/file_control.html
     */
    fileControl(zDbName: string, op: number, arg?: ArrayBufferView | number): number;
  }

  /**
   * A prepared statement.
   *
   * This is returned by {@link Database.prepare} and {@link Database.query}.
   *
   * @category Database
   *
   * @example
   * ```ts
   * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
   * stmt.all("baz");
   * // => [{bar: "baz"}]
   * ```
   *
   * @example
   * ```ts
   * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
   * stmt.get("baz");
   * // => {bar: "baz"}
   * ```
   *
   * @example
   * ```ts
   * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
   * stmt.run("baz");
   * // => undefined
   * ```
   */
  export class Statement<ReturnType = unknown, ParamsType extends SQLQueryBindings[] = any[]> implements Disposable {
    /**
     * Creates a new prepared statement from native code.
     *
     * This is used internally by the {@link Database} class. Probably you don't need to call this yourself.
     */
    constructor(nativeHandle: any);

    /**
     * Execute the prepared statement and return all results as objects.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     *
     * stmt.all("baz");
     * // => [{bar: "baz"}]
     *
     * stmt.all();
     * // => []
     *
     * stmt.all("foo");
     * // => [{bar: "foo"}]
     * ```
     */
    all(...params: ParamsType): ReturnType[];

    /**
     * Execute the prepared statement and return **the first** result.
     *
     * If no result is returned, this returns `null`.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     *
     * stmt.get("baz");
     * // => {bar: "baz"}
     *
     * stmt.get();
     * // => null
     *
     * stmt.get("foo");
     * // => {bar: "foo"}
     * ```
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type            |
     * | --------------- | ---------------------- |
     * | `string`        | `TEXT`                 |
     * | `number`        | `INTEGER` or `DECIMAL` |
     * | `boolean`       | `INTEGER` (1 or 0)     |
     * | `Uint8Array`    | `BLOB`                 |
     * | `Buffer`        | `BLOB`                 |
     * | `bigint`        | `INTEGER`              |
     * | `null`          | `NULL`                 |
     */
    get(...params: ParamsType): ReturnType | null;

    /**
     * Execute the prepared statement and return an
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     *
     */
    iterate(...params: ParamsType): IterableIterator<ReturnType>;
    [Symbol.iterator](): IterableIterator<ReturnType>;

    /**
     * Execute the prepared statement.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     * @returns A `Changes` object with `changes` and `lastInsertRowid` properties
     *
     * @example
     * ```ts
     * const insert = db.prepare("INSERT INTO users (name) VALUES (?)");
     * insert.run("Alice");
     * // => { changes: 1, lastInsertRowid: 1 }
     * insert.run("Bob");
     * // => { changes: 1, lastInsertRowid: 2 }
     *
     * const update = db.prepare("UPDATE users SET name = ? WHERE id = ?");
     * update.run("Charlie", 1);
     * // => { changes: 1, lastInsertRowid: 2 }
     * ```
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type            |
     * | --------------- | ---------------------- |
     * | `string`        | `TEXT`                 |
     * | `number`        | `INTEGER` or `DECIMAL` |
     * | `boolean`       | `INTEGER` (1 or 0)     |
     * | `Uint8Array`    | `BLOB`                 |
     * | `Buffer`        | `BLOB`                 |
     * | `bigint`        | `INTEGER`              |
     * | `null`          | `NULL`                 |
     */
    run(...params: ParamsType): Changes;

    /**
     * Execute the prepared statement and return the results as an array of arrays.
     *
     * In Bun v0.6.7 and earlier, this method returned `null` if there were no
     * results instead of `[]`. This was changed in v0.6.8 to align
     * more with what people expect.
     *
     * @param params optional values to bind to the statement. If omitted, the statement is run with the last bound values or no parameters if there are none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     *
     * stmt.values("baz");
     * // => [['baz']]
     *
     * stmt.values();
     * // => [['baz']]
     *
     * stmt.values("foo");
     * // => [['foo']]
     *
     * stmt.values("not-found");
     * // => []
     * ```
     *
     * The following types can be used when binding parameters:
     *
     * | JavaScript type | SQLite type            |
     * | --------------- | ---------------------- |
     * | `string`        | `TEXT`                 |
     * | `number`        | `INTEGER` or `DECIMAL` |
     * | `boolean`       | `INTEGER` (1 or 0)     |
     * | `Uint8Array`    | `BLOB`                 |
     * | `Buffer`        | `BLOB`                 |
     * | `bigint`        | `INTEGER`              |
     * | `null`          | `NULL`                 |
     */
    values(...params: ParamsType): Array<Array<string | bigint | number | boolean | Uint8Array>>;

    /**
     * Execute the prepared statement and return all results as arrays of
     * `Uint8Array`s.
     *
     * This is similar to `values()` but returns all values as Uint8Array
     * objects, regardless of their original SQLite type.
     *
     * @param params optional values to bind to the statement. If omitted, the
     * statement is run with the last bound values or no parameters if there are
     * none.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     *
     * stmt.raw("baz");
     * // => [[Uint8Array(24)]]
     *
     * stmt.raw();
     * // => [[Uint8Array(24)]]
     * ```
     */
    raw(...params: ParamsType): Array<Array<Uint8Array | null>>;

    /**
     * The names of the columns returned by the prepared statement.
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT bar FROM foo WHERE bar = ?");
     *
     * console.log(stmt.columnNames);
     * // => ["bar"]
     * ```
     */
    readonly columnNames: string[];

    /**
     * The number of parameters expected in the prepared statement.
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");
     * console.log(stmt.paramsCount);
     * // => 1
     * ```
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ? AND baz = ?");
     * console.log(stmt.paramsCount);
     * // => 2
     * ```
     */
    readonly paramsCount: number;

    /**
     * The actual SQLite column types from the first row of the result set.
     * Useful for expressions and computed columns, which are not covered by `declaredTypes`
     *
     * Returns an array of SQLite type constants as uppercase strings:
     * - `"INTEGER"` for integer values
     * - `"FLOAT"` for floating-point values
     * - `"TEXT"` for text values
     * - `"BLOB"` for binary data
     * - `"NULL"` for null values
     * - `null` for unknown/unsupported types
     *
     * **Requirements:**
     * - Only available for read-only statements (SELECT queries)
     * - For non-read-only statements, throws an error
     *
     * **Behavior:**
     * - Uses `sqlite3_column_type()` to get actual data types from the first row
     * - Returns `null` for columns with unknown SQLite type constants
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT id, name, age FROM users WHERE id = 1");
     *
     * console.log(stmt.columnTypes);
     * // => ["INTEGER", "TEXT", "INTEGER"]
     *
     * // For expressions:
     * const exprStmt = db.prepare("SELECT length('bun') AS str_length");
     * console.log(exprStmt.columnTypes);
     * // => ["INTEGER"]
     * ```
     *
     * @throws Error if statement is not read-only (INSERT, UPDATE, DELETE, etc.)
     * @since Bun v1.2.13
     */
    readonly columnTypes: Array<"INTEGER" | "FLOAT" | "TEXT" | "BLOB" | "NULL" | null>;

    /**
     * The declared column types from the table schema.
     *
     * Returns an array of declared type strings from `sqlite3_column_decltype()`:
     * - Raw type strings as declared in the CREATE TABLE statement
     * - `null` for columns without declared types (e.g., expressions, computed columns)
     *
     * **Requirements:**
     * - Statement must be executed at least once before accessing this property
     * - Available for both read-only and read-write statements
     *
     * **Behavior:**
     * - Uses `sqlite3_column_decltype()` to get schema-declared types
     * - Returns the exact type string from the table definition
     *
     * @example
     * ```ts
     * // For table columns:
     * const stmt = db.prepare("SELECT id, name, weight FROM products");
     * stmt.get();
     * console.log(stmt.declaredTypes);
     * // => ["INTEGER", "TEXT", "REAL"]
     *
     * // For expressions (no declared types):
     * const exprStmt = db.prepare("SELECT length('bun') AS str_length");
     * exprStmt.get();
     * console.log(exprStmt.declaredTypes);
     * // => [null]
     * ```
     *
     * @throws Error if statement hasn't been executed
     * @since Bun v1.2.13
     */
    readonly declaredTypes: Array<string | null>;

    /**
     * Finalize the prepared statement, freeing the resources used by the
     * statement and preventing it from being executed again.
     *
     * This is called automatically when the prepared statement is garbage collected.
     *
     * It is safe to call this multiple times. Calling this on a finalized
     * statement has no effect.
     *
     * Internally, this calls `sqlite3_finalize`.
     */
    finalize(): void;

    /**
     * Calls {@link finalize} if it wasn't already called.
     */
    [Symbol.dispose](): void;

    /**
     * Return the expanded SQL string for the prepared statement.
     *
     * Internally, this calls `sqlite3_expanded_sql()` on the underlying `sqlite3_stmt`.
     *
     * @example
     * ```ts
     * const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?", "baz");
     * console.log(stmt.toString());
     * // => "SELECT * FROM foo WHERE bar = 'baz'"
     * console.log(stmt);
     * // => "SELECT * FROM foo WHERE bar = 'baz'"
     * ```
     */
    toString(): string;

    /**
     *
     * Make {@link get} and {@link all} return an instance of the provided
     * `Class` instead of the default `Object`.
     *
     * @param Class A class to use
     * @returns The same statement instance, modified to return an instance of `Class`
     *
     * This lets you attach methods, getters, and setters to the returned
     * objects.
     *
     * For performance reasons, constructors for classes are not called, which means
     * initializers will not be called and private fields will not be
     * accessible.
     *
     * @example
     *
     * ## Custom class
     * ```ts
     * class User {
     *    rawBirthdate: string;
     *    get birthdate() {
     *      return new Date(this.rawBirthdate);
     *    }
     * }
     *
     * const db = new Database(":memory:");
     * db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, rawBirthdate TEXT)");
     * db.run("INSERT INTO users (rawBirthdate) VALUES ('1995-12-19')");
     * const query = db.query("SELECT * FROM users");
     * query.as(User);
     * const user = query.get();
     * console.log(user.birthdate);
     * // => Date(1995, 12, 19)
     * ```
     */
    as<T = unknown>(Class: new (...args: any[]) => T): Statement<T, ParamsType>;

    /**
     * Native object representing the underlying `sqlite3_stmt`
     *
     * This is left untyped because the ABI of the native bindings may change at any time.
     *
     * For stable, typed access to statement metadata, use the typed properties on the Statement class:
     * - {@link columnNames} for column names
     * - {@link paramsCount} for parameter count
     * - {@link columnTypes} for actual data types from the first row
     * - {@link declaredTypes} for schema-declared column types
     */
    readonly native: any;
  }

  /**
   * Constants from `sqlite3.h`
   *
   * This list isn't exhaustive, but some of the ones which are relevant
   */
  export namespace constants {
    /**
     * Open the database as read-only (no write operations, no create).
     * @constant 0x00000001
     */
    const SQLITE_OPEN_READONLY: number;
    /**
     * Open the database for reading and writing
     * @constant 0x00000002
     */
    const SQLITE_OPEN_READWRITE: number;
    /**
     * Allow creating a new database
     * @constant 0x00000004
     */
    const SQLITE_OPEN_CREATE: number;
    /**
     * @constant 0x00000008
     */
    const SQLITE_OPEN_DELETEONCLOSE: number;
    /**
     * @constant 0x00000010
     */
    const SQLITE_OPEN_EXCLUSIVE: number;
    /**
     * @constant 0x00000020
     */
    const SQLITE_OPEN_AUTOPROXY: number;
    /**
     * @constant 0x00000040
     */
    const SQLITE_OPEN_URI: number;
    /**
     * @constant 0x00000080
     */
    const SQLITE_OPEN_MEMORY: number;
    /**
     * @constant 0x00000100
     */
    const SQLITE_OPEN_MAIN_DB: number;
    /**
     * @constant 0x00000200
     */
    const SQLITE_OPEN_TEMP_DB: number;
    /**
     * @constant 0x00000400
     */
    const SQLITE_OPEN_TRANSIENT_DB: number;
    /**
     * @constant 0x00000800
     */
    const SQLITE_OPEN_MAIN_JOURNAL: number;
    /**
     * @constant 0x00001000
     */
    const SQLITE_OPEN_TEMP_JOURNAL: number;
    /**
     * @constant 0x00002000
     */
    const SQLITE_OPEN_SUBJOURNAL: number;
    /**
     * @constant 0x00004000
     */
    const SQLITE_OPEN_SUPER_JOURNAL: number;
    /**
     * @constant 0x00008000
     */
    const SQLITE_OPEN_NOMUTEX: number;
    /**
     * @constant 0x00010000
     */
    const SQLITE_OPEN_FULLMUTEX: number;
    /**
     * @constant 0x00020000
     */
    const SQLITE_OPEN_SHAREDCACHE: number;
    /**
     * @constant 0x00040000
     */
    const SQLITE_OPEN_PRIVATECACHE: number;
    /**
     * @constant 0x00080000
     */
    const SQLITE_OPEN_WAL: number;
    /**
     * @constant 0x01000000
     */
    const SQLITE_OPEN_NOFOLLOW: number;
    /**
     * @constant 0x02000000
     */
    const SQLITE_OPEN_EXRESCODE: number;
    /**
     * @constant 0x01
     */
    const SQLITE_PREPARE_PERSISTENT: number;
    /**
     * @constant 0x02
     */
    const SQLITE_PREPARE_NORMALIZE: number;
    /**
     * @constant 0x04
     */
    const SQLITE_PREPARE_NO_VTAB: number;
    /**
     * @constant 1
     */
    const SQLITE_FCNTL_LOCKSTATE: number;
    /**
     * @constant 2
     */
    const SQLITE_FCNTL_GET_LOCKPROXYFILE: number;
    /**
     * @constant 3
     */
    const SQLITE_FCNTL_SET_LOCKPROXYFILE: number;
    /**
     * @constant 4
     */
    const SQLITE_FCNTL_LAST_ERRNO: number;
    /**
     * @constant 5
     */
    const SQLITE_FCNTL_SIZE_HINT: number;
    /**
     * @constant 6
     */
    const SQLITE_FCNTL_CHUNK_SIZE: number;
    /**
     * @constant 7
     */
    const SQLITE_FCNTL_FILE_POINTER: number;
    /**
     * @constant 8
     */
    const SQLITE_FCNTL_SYNC_OMITTED: number;
    /**
     * @constant 9
     */
    const SQLITE_FCNTL_WIN32_AV_RETRY: number;
    /**
     * @constant 10
     *
     * Control whether or not the WAL is persisted
     * Some versions of macOS configure WAL to be persistent by default.
     *
     * You can change this with code like the below:
     * ```ts
     * import { Database, constants } from "bun:sqlite";
     *
     * const db = Database.open("mydb.sqlite");
     * db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
     * // enable WAL
     * db.exec("PRAGMA journal_mode = WAL");
     * // .. do some work
     * db.close();
     * ```
     *
     */
    const SQLITE_FCNTL_PERSIST_WAL: number;
    /**
     * @constant 11
     */
    const SQLITE_FCNTL_OVERWRITE: number;
    /**
     * @constant 12
     */
    const SQLITE_FCNTL_VFSNAME: number;
    /**
     * @constant 13
     */
    const SQLITE_FCNTL_POWERSAFE_OVERWRITE: number;
    /**
     * @constant 14
     */
    const SQLITE_FCNTL_PRAGMA: number;
    /**
     * @constant 15
     */
    const SQLITE_FCNTL_BUSYHANDLER: number;
    /**
     * @constant 16
     */
    const SQLITE_FCNTL_TEMPFILENAME: number;
    /**
     * @constant 18
     */
    const SQLITE_FCNTL_MMAP_SIZE: number;
    /**
     * @constant 19
     */
    const SQLITE_FCNTL_TRACE: number;
    /**
     * @constant 20
     */
    const SQLITE_FCNTL_HAS_MOVED: number;
    /**
     * @constant 21
     */
    const SQLITE_FCNTL_SYNC: number;
    /**
     * @constant 22
     */
    const SQLITE_FCNTL_COMMIT_PHASETWO: number;
    /**
     * @constant 23
     */
    const SQLITE_FCNTL_WIN32_SET_HANDLE: number;
    /**
     * @constant 24
     */
    const SQLITE_FCNTL_WAL_BLOCK: number;
    /**
     * @constant 25
     */
    const SQLITE_FCNTL_ZIPVFS: number;
    /**
     * @constant 26
     */
    const SQLITE_FCNTL_RBU: number;
    /**
     * @constant 27
     */
    const SQLITE_FCNTL_VFS_POINTER: number;
    /**
     * @constant 28
     */
    const SQLITE_FCNTL_JOURNAL_POINTER: number;
    /**
     * @constant 29
     */
    const SQLITE_FCNTL_WIN32_GET_HANDLE: number;
    /**
     * @constant 30
     */
    const SQLITE_FCNTL_PDB: number;
    /**
     * @constant 31
     */
    const SQLITE_FCNTL_BEGIN_ATOMIC_WRITE: number;
    /**
     * @constant 32
     */
    const SQLITE_FCNTL_COMMIT_ATOMIC_WRITE: number;
    /**
     * @constant 33
     */
    const SQLITE_FCNTL_ROLLBACK_ATOMIC_WRITE: number;
    /**
     * @constant 34
     */
    const SQLITE_FCNTL_LOCK_TIMEOUT: number;
    /**
     * @constant 35
     */
    const SQLITE_FCNTL_DATA_VERSION: number;
    /**
     * @constant 36
     */
    const SQLITE_FCNTL_SIZE_LIMIT: number;
    /**
     * @constant 37
     */
    const SQLITE_FCNTL_CKPT_DONE: number;
    /**
     * @constant 38
     */
    const SQLITE_FCNTL_RESERVE_BYTES: number;
    /**
     * @constant 39
     */
    const SQLITE_FCNTL_CKPT_START: number;
    /**
     * @constant 40
     */
    const SQLITE_FCNTL_EXTERNAL_READER: number;
    /**
     * @constant 41
     */
    const SQLITE_FCNTL_CKSM_FILE: number;
    /**
     * @constant 42
     */
    const SQLITE_FCNTL_RESET_CACHE: number;
  }

  /**
   * The native module implementing the sqlite3 C bindings
   *
   * It is lazily-initialized, so this will return `undefined` until the first
   * call to new Database().
   *
   * The native module makes no gurantees about ABI stability, so it is left
   * untyped
   *
   * If you need to use it directly for some reason, please let us know because
   * that probably points to a deficiency in this API.
   */
  export var native: any;

  export type SQLQueryBindings =
    | string
    | bigint
    | NodeJS.TypedArray
    | number
    | boolean
    | null
    | Record<string, string | bigint | NodeJS.TypedArray | number | boolean | null>;

  export default Database;

  /**
   * Errors from SQLite have a name `SQLiteError`.
   *
   */
  export class SQLiteError extends Error {
    readonly name: "SQLiteError";

    /**
     * The SQLite3 extended error code
     *
     * This corresponds to `sqlite3_extended_errcode`.
     *
     * @since v1.0.21
     */
    errno: number;

    /**
     * The name of the SQLite3 error code
     *
     * @example
     * "SQLITE_CONSTRAINT_UNIQUE"
     *
     * @since v1.0.21
     */
    code?: string;

    /**
     * The UTF-8 byte offset of the sqlite3 query that failed, if known
     *
     * This corresponds to `sqlite3_error_offset`.
     *
     * @since v1.0.21
     */
    readonly byteOffset: number;
  }

  /**
   * An object representing the changes made to the database since the last `run` or `exec` call.
   *
   * @since Bun v1.1.14
   */
  export interface Changes {
    /**
     * The number of rows changed by the last `run` or `exec` call.
     */
    changes: number;

    /**
     * If `safeIntegers` is `true`, this is a `bigint`. Otherwise, it is a `number`.
     */
    lastInsertRowid: number | bigint;
  }
}
