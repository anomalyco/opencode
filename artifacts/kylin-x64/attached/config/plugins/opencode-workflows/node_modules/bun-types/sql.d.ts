import type * as BunSQLite from "bun:sqlite";

declare module "bun" {
  /**
   * Represents a reserved connection from the connection pool Extends SQL with
   * additional release functionality
   */
  interface ReservedSQL extends SQL, Disposable {
    /**
     * Releases the client back to the connection pool
     */
    release(): void;
  }

  type ArrayType =
    | "BOOLEAN"
    | "BYTEA"
    | "CHAR"
    | "NAME"
    | "TEXT"
    | "CHAR"
    | "VARCHAR"
    | "SMALLINT"
    | "INT2VECTOR"
    | "INTEGER"
    | "INT"
    | "BIGINT"
    | "REAL"
    | "DOUBLE PRECISION"
    | "NUMERIC"
    | "MONEY"
    | "OID"
    | "TID"
    | "XID"
    | "CID"
    | "JSON"
    | "JSONB"
    | "JSONPATH"
    | "XML"
    | "POINT"
    | "LSEG"
    | "PATH"
    | "BOX"
    | "POLYGON"
    | "LINE"
    | "CIRCLE"
    | "CIDR"
    | "MACADDR"
    | "INET"
    | "MACADDR8"
    | "DATE"
    | "TIME"
    | "TIMESTAMP"
    | "TIMESTAMPTZ"
    | "INTERVAL"
    | "TIMETZ"
    | "BIT"
    | "VARBIT"
    | "ACLITEM"
    | "PG_DATABASE"
    | (string & {});

  /**
   * Represents a SQL array parameter
   */
  interface SQLArrayParameter {
    /**
     * The serialized values of the array parameter
     */
    serializedValues: string;
    /**
     * The type of the array parameter
     */
    arrayType: ArrayType;
  }

  /**
   * Represents a client within a transaction context Extends SQL with savepoint
   * functionality
   */
  interface TransactionSQL extends SQL {
    /**
     * Creates a savepoint within the current transaction
     */
    savepoint<T>(name: string, fn: SQL.SavepointContextCallback<T>): Promise<T>;
    savepoint<T>(fn: SQL.SavepointContextCallback<T>): Promise<T>;

    /**
     * The reserve method pulls out a connection from the pool, and returns a
     * client that wraps the single connection.
     *
     * Using reserve() inside of a transaction will return a brand new
     * connection, not one related to the transaction. This matches the
     * behaviour of the `postgres` package.
     */
    reserve(): Promise<ReservedSQL>;
  }

  namespace SQL {
    class SQLError extends Error {
      constructor(message: string);
    }

    class PostgresError extends SQLError {
      public readonly code: string;
      public readonly errno?: string | undefined;
      public readonly detail?: string | undefined;
      public readonly hint?: string | undefined;
      public readonly severity?: string | undefined;
      public readonly position?: string | undefined;
      public readonly internalPosition?: string | undefined;
      public readonly internalQuery?: string | undefined;
      public readonly where?: string | undefined;
      public readonly schema?: string | undefined;
      public readonly table?: string | undefined;
      public readonly column?: string | undefined;
      public readonly dataType?: string | undefined;
      public readonly constraint?: string | undefined;
      public readonly file?: string | undefined;
      public readonly line?: string | undefined;
      public readonly routine?: string | undefined;

      constructor(
        message: string,
        options: {
          code: string;
          errno?: string | undefined;
          detail?: string;
          hint?: string | undefined;
          severity?: string | undefined;
          position?: string | undefined;
          internalPosition?: string;
          internalQuery?: string;
          where?: string | undefined;
          schema?: string;
          table?: string | undefined;
          column?: string | undefined;
          dataType?: string | undefined;
          constraint?: string;
          file?: string | undefined;
          line?: string | undefined;
          routine?: string | undefined;
        },
      );
    }

    class MySQLError extends SQLError {
      public readonly code: string;
      public readonly errno?: number | undefined;
      public readonly sqlState?: string | undefined;
      constructor(message: string, options: { code: string; errno: number | undefined; sqlState: string | undefined });
    }

    class SQLiteError extends SQLError {
      public readonly code: string;
      public readonly errno: number;
      public readonly byteOffset?: number | undefined;

      constructor(message: string, options: { code: string; errno: number; byteOffset?: number | undefined });
    }

    type AwaitPromisesArray<T extends Array<PromiseLike<any>>> = {
      [K in keyof T]: Awaited<T[K]>;
    };

    type ContextCallbackResult<T> = T extends Array<PromiseLike<any>> ? AwaitPromisesArray<T> : Awaited<T>;
    type ContextCallback<T, SQL> = (sql: SQL) => Bun.MaybePromise<T>;

    interface SQLiteOptions extends BunSQLite.DatabaseOptions {
      adapter?: "sqlite";

      /**
       * Specify the path to the database file
       *
       * Examples:
       *
       * - `sqlite://:memory:`
       * - `sqlite://./path/to/database.db`
       * - `sqlite:///Users/bun/projects/my-app/database.db`
       * - `./dev.db`
       * - `:memory:`
       *
       * @default ":memory:"
       */
      filename?: URL | ":memory:" | (string & {}) | undefined;

      /**
       * Callback executed when a connection attempt completes (SQLite)
       * Receives an Error on failure, or null on success.
       */
      onconnect?: ((err: Error | null) => void) | undefined;

      /**
       * Callback executed when a connection is closed (SQLite)
       * Receives the closing Error or null.
       */
      onclose?: ((err: Error | null) => void) | undefined;
    }

    interface PostgresOrMySQLOptions {
      /**
       * Connection URL (can be string or URL object)
       */
      url?: URL | string | undefined;

      /**
       * Database server hostname
       * @deprecated Prefer {@link hostname}
       * @default "localhost"
       */
      host?: string | undefined;

      /**
       * Database server hostname
       * @default "localhost"
       */
      hostname?: string | undefined;

      /**
       * Database server port number
       * @default 5432
       */
      port?: number | string | undefined;

      /**
       * Database user for authentication
       * @default "postgres"
       */
      username?: string | undefined;

      /**
       * Database user for authentication (alias for username)
       * @deprecated Prefer {@link username}
       * @default "postgres"
       */
      user?: string | undefined;

      /**
       * Database password for authentication
       * @default ""
       */
      password?: string | (() => MaybePromise<string>) | undefined;

      /**
       * Database password for authentication (alias for password)
       * @deprecated Prefer {@link password}
       * @default ""
       */
      pass?: string | (() => MaybePromise<string>) | undefined;

      /**
       * Name of the database to connect to
       * @default The username value
       */
      database?: string | undefined;

      /**
       * Name of the database to connect to (alias for database)
       * @deprecated Prefer {@link database}
       * @default The username value
       */
      db?: string | undefined;

      /**
       * Database adapter/driver to use
       * @default "postgres"
       */
      adapter?: "postgres" | "mysql" | "mariadb";

      /**
       * Maximum time in seconds to wait for connection to become available
       * @default 0 (no timeout)
       */
      idleTimeout?: number | undefined;

      /**
       * Maximum time in seconds to wait for connection to become available (alias for idleTimeout)
       * @deprecated Prefer {@link idleTimeout}
       * @default 0 (no timeout)
       */
      idle_timeout?: number | undefined;

      /**
       * Maximum time in seconds to wait when establishing a connection
       * @default 30
       */
      connectionTimeout?: number | undefined;

      /**
       * Maximum time in seconds to wait when establishing a connection (alias for connectionTimeout)
       * @deprecated Prefer {@link connectionTimeout}
       * @default 30
       */
      connection_timeout?: number | undefined;

      /**
       * Maximum time in seconds to wait when establishing a connection (alias
       * for connectionTimeout)
       * @deprecated Prefer {@link connectionTimeout}
       * @default 30
       */
      connectTimeout?: number | undefined;

      /**
       * Maximum time in seconds to wait when establishing a connection (alias
       * for connectionTimeout)
       * @deprecated Prefer {@link connectionTimeout}
       * @default 30
       */
      connect_timeout?: number | undefined;

      /**
       * Maximum lifetime in seconds of a connection
       * @default 0 (no maximum lifetime)
       */
      maxLifetime?: number | undefined;

      /**
       * Maximum lifetime in seconds of a connection (alias for maxLifetime)
       * @deprecated Prefer {@link maxLifetime}
       * @default 0 (no maximum lifetime)
       */
      max_lifetime?: number | undefined;

      /**
       * Whether to use TLS/SSL for the connection
       * @default false
       */
      tls?: Bun.BunFile | TLSOptions | boolean | undefined;

      /**
       * Whether to use TLS/SSL for the connection (alias for tls)
       * @deprecated Prefer {@link tls}
       * @default false
       */
      ssl?: Bun.BunFile | TLSOptions | boolean | undefined;

      /**
       * Unix domain socket path for connection
       * @default undefined
       */
      path?: string | undefined;

      /**
       * Callback executed when a connection attempt completes
       * Receives an Error on failure, or null on success.
       */
      onconnect?: ((err: Error | null) => void) | undefined;

      /**
       * Callback executed when a connection is closed
       * Receives the closing Error or null.
       */
      onclose?: ((err: Error | null) => void) | undefined;

      /**
       * Postgres client runtime configuration options
       *
       * @see https://www.postgresql.org/docs/current/runtime-config-client.html
       */
      connection?: Record<string, string | boolean | number> | undefined;

      /**
       * Maximum number of connections in the pool
       * @default 10
       */
      max?: number | undefined;

      /**
       * By default values outside i32 range are returned as strings. If this is
       * true, values outside i32 range are returned as BigInts.
       * @default false
       */
      bigint?: boolean | undefined;

      /**
       * Automatic creation of prepared statements
       * @default true
       */
      prepare?: boolean | undefined;
    }

    /**
     * Configuration options for SQL client connection and behavior
     *
     * @example
     * ```ts
     * const config: Bun.SQL.Options = {
     *   host: 'localhost',
     *   port: 5432,
     *   user: 'dbuser',
     *   password: 'secretpass',
     *   database: 'myapp',
     *   idleTimeout: 30,
     *   max: 20,
     *   onconnect: (client) => {
     *     console.log('Connected to database');
     *   }
     * };
     * ```
     */
    type Options = SQLiteOptions | PostgresOrMySQLOptions;

    /**
     * Represents a SQL query that can be executed, with additional control
     * methods Extends Promise to allow for async/await usage
     */
    interface Query<T> extends Promise<T> {
      /**
       * Indicates if the query is currently executing
       */
      active: boolean;

      /**
       * Indicates if the query has been cancelled
       */
      cancelled: boolean;

      /**
       * Cancels the executing query
       */
      cancel(): Query<T>;

      /**
       * Executes the query as a simple query, no parameters are allowed but can
       * execute multiple commands separated by semicolons
       */
      simple(): Query<T>;

      /**
       * Executes the query
       */
      execute(): Query<T>;

      /**
       * Returns the raw query result
       */
      raw(): Query<T>;

      /**
       * Returns only the values from the query result
       */
      values(): Query<T>;
    }

    /**
     * Callback function type for transaction contexts
     * @param sql Function to execute SQL queries within the transaction
     */
    type TransactionContextCallback<T> = ContextCallback<T, TransactionSQL>;

    /**
     * Callback function type for savepoint contexts
     * @param sql Function to execute SQL queries within the savepoint
     */
    type SavepointContextCallback<T> = ContextCallback<T, SavepointSQL>;

    /**
     * SQL.Helper represents a parameter or serializable
     * value inside of a query.
     *
     * @example
     * ```ts
     * const helper = sql(users, 'id');
     * await sql`insert into users ${helper}`;
     * ```
     */
    interface Helper<T> {
      readonly value: T[];
      readonly columns: (keyof T)[];
    }
  }

  interface SQL extends AsyncDisposable {
    /**
     * Executes a SQL query using template literals
     * @example
     * ```ts
     * const [user] = await sql<Users[]>`select * from users where id = ${1}`;
     * ```
     */
    <T = any>(strings: TemplateStringsArray, ...values: unknown[]): SQL.Query<T>;

    /**
     * Execute a SQL query using a string
     *
     * @example
     * ```ts
     * const users = await sql<User[]>`SELECT * FROM users WHERE id = ${1}`;
     * ```
     */
    <T = any>(string: string): SQL.Query<T>;

    /**
     * Helper function for inserting an object into a query
     *
     * @example
     * ```ts
     * // Insert an object
     * const result = await sql`insert into users ${sql(users)} returning *`;
     *
     * // Or pick specific columns
     * const result = await sql`insert into users ${sql(users, "id", "name")} returning *`;
     *
     * // Or a single object
     * const result = await sql`insert into users ${sql(user)} returning *`;
     * ```
     */
    <T extends { [Key in PropertyKey]: unknown }>(obj: T | T[] | readonly T[]): SQL.Helper<T>; // Contributor note: This is the same as the signature below with the exception of the columns and the Pick<T, Keys>

    /**
     * Helper function for inserting an object into a query, supporting specific columns
     *
     * @example
     * ```ts
     * // Insert an object
     * const result = await sql`insert into users ${sql(users)} returning *`;
     *
     * // Or pick specific columns
     * const result = await sql`insert into users ${sql(users, "id", "name")} returning *`;
     *
     * // Or a single object
     * const result = await sql`insert into users ${sql(user)} returning *`;
     * ```
     */
    <T extends { [Key in PropertyKey]: unknown }, Keys extends keyof T = keyof T>(
      obj: T | T[] | readonly T[],
      ...columns: readonly Keys[]
    ): SQL.Helper<Pick<T, Keys>>; // Contributor note: This is the same as the signature above with the exception of this signature tracking keys

    /**
     * Helper function for inserting any serializable value into a query
     *
     * @example
     * ```ts
     * const result = await sql`SELECT * FROM users WHERE id IN ${sql([1, 2, 3])}`;
     * ```
     */
    <T>(value: T): SQL.Helper<T>;
  }

  /**
   * Main SQL client interface providing connection and transaction management
   */
  class SQL {
    /**
     * Creates a new SQL client instance
     *
     * @param connectionString - The connection string for the SQL client
     *
     * @example
     * ```ts
     * const sql = new SQL("postgres://localhost:5432/mydb");
     * const sql = new SQL(new URL("postgres://localhost:5432/mydb"));
     * ```
     */
    constructor(connectionString: string | URL);

    /**
     * Creates a new SQL client instance with options
     *
     * @param connectionString - The connection string for the SQL client
     * @param options - The options for the SQL client
     *
     * @example
     * ```ts
     * const sql = new SQL("postgres://localhost:5432/mydb", { idleTimeout: 1000 });
     * ```
     */
    constructor(
      connectionString: string | URL,
      options: Bun.__internal.DistributedOmit<SQL.Options, "url" | "filename">,
    );

    /**
     * Creates a new SQL client instance with options
     *
     * @param options - The options for the SQL client
     *
     * @example
     * ```ts
     * const sql = new SQL({ url: "postgres://localhost:5432/mydb", idleTimeout: 1000 });
     * ```
     */
    constructor(options?: SQL.Options);

    /**
     * Current client options
     */
    options: Bun.__internal.DistributedMerge<SQL.Options>;

    /**
     * Commits a distributed transaction also know as prepared transaction in postgres or XA transaction in MySQL
     *
     * @param name - The name of the distributed transaction
     *
     * @throws {Error} If the adapter does not support distributed transactions (e.g., SQLite)
     *
     * @example
     * ```ts
     * await sql.commitDistributed("my_distributed_transaction");
     * ```
     */
    commitDistributed(name: string): Promise<void>;

    /**
     * Rolls back a distributed transaction also know as prepared transaction in postgres or XA transaction in MySQL
     *
     * @param name - The name of the distributed transaction
     *
     * @throws {Error} If the adapter does not support distributed transactions (e.g., SQLite)
     *
     * @example
     * ```ts
     * await sql.rollbackDistributed("my_distributed_transaction");
     * ```
     */
    rollbackDistributed(name: string): Promise<void>;

    /** Waits for the database connection to be established
     *
     * @example
     * ```ts
     * await sql.connect();
     * ```
     */
    connect(): Promise<SQL>;

    /**
     * Closes the database connection with optional timeout in seconds. If timeout is 0, it will close immediately, if is not provided it will wait for all queries to finish before closing.
     *
     * @param options - The options for the close
     *
     * @example
     * ```ts
     * await sql.close({ timeout: 1 });
     * ```
     */
    close(options?: { timeout?: number }): Promise<void>;

    /**
     * Closes the database connection with optional timeout in seconds. If timeout is 0, it will close immediately, if is not provided it will wait for all queries to finish before closing.
     * This is an alias of {@link SQL.close}
     *
     * @param options - The options for the close
     *
     * @example
     * ```ts
     * await sql.end({ timeout: 1 });
     * ```
     */
    end(options?: { timeout?: number }): Promise<void>;

    /**
     * Flushes any pending operations
     *
     * @throws {Error} If the adapter does not support flushing (e.g., SQLite)
     *
     * @example
     * ```ts
     * sql.flush();
     * ```
     */
    flush(): void;

    /**
     * The reserve method pulls out a connection from the pool, and returns a client that wraps the single connection.
     *
     * This can be used for running queries on an isolated connection.
     * Calling reserve in a reserved Sql will return a new reserved connection,  not the same connection (behavior matches postgres package).
     *
     * @throws {Error} If the adapter does not support connection pooling (e.g., SQLite)s
     *
     * @example
     * ```ts
     * const reserved = await sql.reserve();
     * await reserved`select * from users`;
     * await reserved.release();
     * // with in a production scenario would be something more like
     * const reserved = await sql.reserve();
     * try {
     *   // ... queries
     * } finally {
     *   await reserved.release();
     * }
     *
     * // Bun supports Symbol.dispose and Symbol.asyncDispose
     * // always release after context (safer)
     * using reserved = await sql.reserve()
     * await reserved`select * from users`
     * ```
     */
    reserve(): Promise<ReservedSQL>;

    /**
     * Creates a new SQL array parameter
     * @param values - The values to create the array parameter from
     * @param typeNameOrTypeID - The type name or type ID to create the array parameter from, if omitted it will default to JSON
     * @returns A new SQL array parameter
     *
     * @example
     * ```ts
     * const array = sql.array([1, 2, 3], "INT");
     * await sql`CREATE TABLE users_posts (user_id INT, posts_id INT[])`;
     * await sql`INSERT INTO users_posts (user_id, posts_id) VALUES (${user.id}, ${array})`;
     * ```
     */
    array(values: any[], typeNameOrTypeID?: number | ArrayType): SQLArrayParameter;

    /**
     * Begins a new transaction.
     *
     * Will reserve a connection for the transaction and supply a scoped sql instance for all transaction uses in the callback function. sql.begin will resolve with the returned value from the callback function.
     * BEGIN is automatically sent with the optional options, and if anything fails ROLLBACK will be called so the connection can be released and execution can continue.
     * @example
     * const [user, account] = await sql.begin(async sql => {
     *   const [user] = await sql`
     *     insert into users (
     *       name
     *     ) values (
     *       'Murray'
     *     )
     *     returning *
     *   `
     *   const [account] = await sql`
     *     insert into accounts (
     *       user_id
     *     ) values (
     *       ${ user.user_id }
     *     )
     *     returning *
     *   `
     *   return [user, account]
     * })
     */
    begin<const T>(fn: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>;

    /**
     * Begins a new transaction with options.
     *
     * Will reserve a connection for the transaction and supply a scoped sql instance for all transaction uses in the callback function. sql.begin will resolve with the returned value from the callback function.
     * BEGIN is automatically sent with the optional options, and if anything fails ROLLBACK will be called so the connection can be released and execution can continue.
     * @example
     * const [user, account] = await sql.begin("read write", async sql => {
     *   const [user] = await sql`
     *     insert into users (
     *       name
     *     ) values (
     *       'Murray'
     *     )
     *     returning *
     *   `
     *   const [account] = await sql`
     *     insert into accounts (
     *       user_id
     *     ) values (
     *       ${ user.user_id }
     *     )
     *     returning *
     *   `
     *   return [user, account]
     * })
     */
    begin<const T>(options: string, fn: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>;

    /**
     * Alternative method to begin a transaction.
     *
     * Will reserve a connection for the transaction and supply a scoped sql instance for all transaction uses in the callback function. sql.transaction will resolve with the returned value from the callback function.
     * BEGIN is automatically sent with the optional options, and if anything fails ROLLBACK will be called so the connection can be released and execution can continue.
     * @alias begin
     * @example
     * const [user, account] = await sql.transaction(async sql => {
     *   const [user] = await sql`
     *     insert into users (
     *       name
     *     ) values (
     *       'Murray'
     *     )
     *     returning *
     *   `
     *   const [account] = await sql`
     *     insert into accounts (
     *       user_id
     *     ) values (
     *       ${ user.user_id }
     *     )
     *     returning *
     *   `
     *   return [user, account]
     * })
     */
    transaction<const T>(fn: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>;

    /**
     * Alternative method to begin a transaction with options
     * Will reserve a connection for the transaction and supply a scoped sql instance for all transaction uses in the callback function. sql.transaction will resolve with the returned value from the callback function.
     * BEGIN is automatically sent with the optional options, and if anything fails ROLLBACK will be called so the connection can be released and execution can continue.
     *
     * @alias {@link begin}
     *
     * @example
     * const [user, account] = await sql.transaction("read write", async sql => {
     *   const [user] = await sql`
     *     insert into users (
     *       name
     *     ) values (
     *       'Murray'
     *     )
     *     returning *
     *   `
     *   const [account] = await sql`
     *     insert into accounts (
     *       user_id
     *     ) values (
     *       ${ user.user_id }
     *     )
     *     returning *
     *   `
     *   return [user, account]
     * });
     */
    transaction<const T>(options: string, fn: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>;

    /**
     * Begins a distributed transaction
     * Also know as Two-Phase Commit, in a distributed transaction, Phase 1 involves the coordinator preparing nodes by ensuring data is written and ready to commit, while Phase 2 finalizes with nodes committing or rolling back based on the coordinator's decision, ensuring durability and releasing locks.
     * In PostgreSQL and MySQL distributed transactions persist beyond the original session, allowing privileged users or coordinators to commit/rollback them, ensuring support for distributed transactions, recovery, and administrative tasks.
     * beginDistributed will automatic rollback if any exception are not caught, and you can commit and rollback later if everything goes well.
     * PostgreSQL natively supports distributed transactions using PREPARE TRANSACTION, while MySQL uses XA Transactions, and MSSQL also supports distributed/XA transactions. However, in MSSQL, distributed transactions are tied to the original session, the DTC coordinator, and the specific connection.
     * These transactions are automatically committed or rolled back following the same rules as regular transactions, with no option for manual intervention from other sessions, in MSSQL distributed transactions are used to coordinate transactions using Linked Servers.
     *
     * @throws {Error} If the adapter does not support distributed transactions (e.g., SQLite)
     *
     * @example
     * await sql.beginDistributed("numbers", async sql => {
     *   await sql`create table if not exists numbers (a int)`;
     *   await sql`insert into numbers values(1)`;
     * });
     * // later you can call
     * await sql.commitDistributed("numbers");
     * // or await sql.rollbackDistributed("numbers");
     */
    beginDistributed<const T>(
      name: string,
      fn: SQL.TransactionContextCallback<T>,
    ): Promise<SQL.ContextCallbackResult<T>>;

    /** Alternative method to begin a distributed transaction
     * @alias {@link beginDistributed}
     */
    distributed<const T>(name: string, fn: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>;

    /**If you know what you're doing, you can use unsafe to pass any string you'd like.
     * Please note that this can lead to SQL injection if you're not careful.
     * You can also nest sql.unsafe within a safe sql expression. This is useful if only part of your fraction has unsafe elements.
     * @example
     * const result = await sql.unsafe(`select ${danger} from users where id = ${dragons}`)
     */
    unsafe<T = any>(string: string, values?: any[]): SQL.Query<T>;

    /**
     * Reads a file and uses the contents as a query.
     * Optional parameters can be used if the file includes $1, $2, etc
     * @example
     * const result = await sql.file("query.sql", [1, 2, 3]);
     */
    file<T = any>(filename: string, values?: any[]): SQL.Query<T>;
  }

  /**
   * SQL client
   */
  const sql: SQL;

  /**
   * SQL client for PostgreSQL
   *
   * @deprecated Prefer {@link Bun.sql}
   */
  const postgres: SQL;

  /**
   * Represents a savepoint within a transaction
   */
  interface SavepointSQL extends SQL {}
}
