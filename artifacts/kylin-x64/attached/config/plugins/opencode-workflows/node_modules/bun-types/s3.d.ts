declare module "bun" {
  /**
   * Fast incremental writer for files and pipes.
   *
   * This uses the same interface as {@link ArrayBufferSink}, but writes to a file or pipe.
   */
  interface FileSink {
    /**
     * Write a chunk of data to the file.
     *
     * If the file descriptor is not writable yet, the data is buffered.
     *
     * @param chunk The data to write
     * @returns Number of bytes written or, if the write is pending, a Promise resolving to the number of bytes
     */
    write(chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer): number | Promise<number>;
    /**
     * Flush the internal buffer, committing the data to disk or the pipe.
     *
     * @returns Number of bytes flushed or a Promise resolving to the number of bytes
     */
    flush(): number | Promise<number>;
    /**
     * Close the file descriptor. This also flushes the internal buffer.
     *
     * @param error Optional error to associate with the close operation
     * @returns Number of bytes written or a Promise resolving to the number of bytes
     */
    end(error?: Error): number | Promise<number>;

    /**
     * Start the file sink with provided options.
     *
     * @param options Configuration options for the file sink
     */
    start(options?: {
      /**
       * Preallocate an internal buffer of this size
       * This can significantly improve performance when the chunk size is small
       */
      highWaterMark?: number;
    }): void;

    /**
     * For FIFOs & pipes, this lets you decide whether Bun's process should
     * remain alive until the pipe is closed.
     *
     * By default, it is automatically managed. While the stream is open, the
     * process remains alive and once the other end hangs up or the stream
     * closes, the process exits.
     *
     * If you previously called {@link unref}, you can call this again to re-enable automatic management.
     *
     * Internally, it will reference count the number of times this is called. By default, that number is 1
     *
     * If the file is not a FIFO or pipe, {@link ref} and {@link unref} do
     * nothing. If the pipe is already closed, this does nothing.
     */
    ref(): void;

    /**
     * For FIFOs & pipes, this lets you decide whether Bun's process should
     * remain alive until the pipe is closed.
     *
     * If you want to allow Bun's process to terminate while the stream is open,
     * call this.
     *
     * If the file is not a FIFO or pipe, {@link ref} and {@link unref} do
     * nothing. If the pipe is already closed, this does nothing.
     */
    unref(): void;
  }

  interface NetworkSink extends FileSink {
    /**
     * Write a chunk of data to the network.
     *
     * If the network is not writable yet, the data is buffered.
     *
     * @param chunk The data to write
     * @returns Number of bytes written or, if the write is pending, a Promise resolving to the number of bytes
     */
    write(chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer): number | Promise<number>;
    /**
     * Flush the internal buffer, committing the data to the network.
     *
     * @returns Number of bytes flushed or a Promise resolving to the number of bytes
     */
    flush(): number | Promise<number>;
    /**
     * Finish the upload. This also flushes the internal buffer.
     *
     * @param error Optional error to associate with the end operation
     * @returns Number of bytes written or a Promise resolving to the number of bytes
     */
    end(error?: Error): number | Promise<number>;

    /**
     * Get the stat of the file.
     *
     * @returns Promise resolving to the file stats
     */
    stat(): Promise<import("node:fs").Stats>;
  }

  /**
   * Configuration options for S3 operations
   */
  interface S3Options extends BlobPropertyBag {
    /**
     * The Access Control List (ACL) policy for the file.
     * Controls who can access the file and what permissions they have.
     *
     * @example
     *     // Setting public read access
     *     const file = s3.file("public-file.txt", {
     *       acl: "public-read",
     *       bucket: "my-bucket"
     *     });
     *
     * @example
     *     // Using with presigned URLs
     *     const url = file.presign({
     *       acl: "public-read",
     *       expiresIn: 3600
     *     });
     */
    acl?:
      | "private"
      | "public-read"
      | "public-read-write"
      | "aws-exec-read"
      | "authenticated-read"
      | "bucket-owner-read"
      | "bucket-owner-full-control"
      | "log-delivery-write";

    /**
     * The S3 bucket name. Defaults to `S3_BUCKET` or `AWS_BUCKET` environment variables.
     *
     * @example
     *     // Using explicit bucket
     *     const file = s3.file("my-file.txt", { bucket: "my-bucket" });
     *
     * @example
     *     // Using environment variables
     *     // With S3_BUCKET=my-bucket in .env
     *     const file = s3.file("my-file.txt");
     */
    bucket?: string;

    /**
     * The AWS region. Defaults to `S3_REGION` or `AWS_REGION` environment variables.
     *
     * @example
     *     const file = s3.file("my-file.txt", {
     *       bucket: "my-bucket",
     *       region: "us-west-2"
     *     });
     */
    region?: string;

    /**
     * The access key ID for authentication.
     * Defaults to `S3_ACCESS_KEY_ID` or `AWS_ACCESS_KEY_ID` environment variables.
     */
    accessKeyId?: string;

    /**
     * The secret access key for authentication.
     * Defaults to `S3_SECRET_ACCESS_KEY` or `AWS_SECRET_ACCESS_KEY` environment variables.
     */
    secretAccessKey?: string;

    /**
     * Optional session token for temporary credentials.
     * Defaults to `S3_SESSION_TOKEN` or `AWS_SESSION_TOKEN` environment variables.
     *
     * @example
     *     // Using temporary credentials
     *     const file = s3.file("my-file.txt", {
     *       accessKeyId: tempAccessKey,
     *       secretAccessKey: tempSecretKey,
     *       sessionToken: tempSessionToken
     *     });
     */
    sessionToken?: string;

    /**
     * The S3-compatible service endpoint URL.
     * Defaults to `S3_ENDPOINT` or `AWS_ENDPOINT` environment variables.
     *
     * @example
     *     // AWS S3
     *     const file = s3.file("my-file.txt", {
     *       endpoint: "https://s3.us-east-1.amazonaws.com"
     *     });
     *
     * @example
     *     // Cloudflare R2
     *     const file = s3.file("my-file.txt", {
     *       endpoint: "https://<account-id>.r2.cloudflarestorage.com"
     *     });
     *
     * @example
     *     // DigitalOcean Spaces
     *     const file = s3.file("my-file.txt", {
     *       endpoint: "https://<region>.digitaloceanspaces.com"
     *     });
     *
     * @example
     *     // MinIO (local development)
     *     const file = s3.file("my-file.txt", {
     *       endpoint: "http://localhost:9000"
     *     });
     */
    endpoint?: string;

    /**
     * Use virtual hosted style endpoint. default to false, when true if `endpoint` is informed it will ignore the `bucket`
     *
     * @example
     *     // Using virtual hosted style
     *     const file = s3.file("my-file.txt", {
     *       virtualHostedStyle: true,
     *       endpoint: "https://my-bucket.s3.us-east-1.amazonaws.com"
     *     });
     */
    virtualHostedStyle?: boolean;

    /**
     * The size of each part in multipart uploads (in bytes).
     * - Minimum: 5 MiB
     * - Maximum: 5120 MiB
     * - Default: 5 MiB
     *
     * @example
     *     // Configuring multipart uploads
     *     const file = s3.file("large-file.dat", {
     *       partSize: 10 * 1024 * 1024, // 10 MiB parts
     *       queueSize: 4  // Upload 4 parts in parallel
     *     });
     *
     *     const writer = file.writer();
     *     // ... write large file in chunks
     */
    partSize?: number;

    /**
     * Number of parts to upload in parallel for multipart uploads.
     * - Default: 5
     * - Maximum: 255
     *
     * Increasing this value can improve upload speeds for large files
     * but will use more memory.
     */
    queueSize?: number;

    /**
     * Number of retry attempts for failed uploads.
     * - Default: 3
     * - Maximum: 255
     *
     * @example
     *    // Setting retry attempts
     *     const file = s3.file("my-file.txt", {
     *       retry: 5 // Retry failed uploads up to 5 times
     *     });
     */
    retry?: number;

    /**
     * The Content-Type of the file.
     * Automatically set based on file extension when possible.
     *
     * @example
     *    // Setting explicit content type
     *     const file = s3.file("data.bin", {
     *       type: "application/octet-stream"
     *     });
     */
    type?: string;

    /**
     * The Content-Disposition header value.
     * Controls how the file is presented when downloaded.
     *
     * @example
     *    // Setting attachment disposition with filename
     *     const file = s3.file("report.pdf", {
     *       contentDisposition: "attachment; filename=\"quarterly-report.pdf\""
     *     });
     *
     * @example
     *    // Setting inline disposition
     *     await s3.write("image.png", imageData, {
     *       contentDisposition: "inline"
     *     });
     */
    contentDisposition?: string | undefined;

    /**
     * The Content-Encoding header value.
     * Specifies what content encodings have been applied to the object,
     * for example to indicate that it has been compressed.
     *
     * @example
     *    // Setting gzip encoding
     *     const file = s3.file("data.json.gz", {
     *       contentEncoding: "gzip"
     *     });
     *
     * @example
     *    // Setting encoding when writing
     *     await s3.write("data.json.gz", compressedData, {
     *       contentEncoding: "gzip"
     *     });
     */
    contentEncoding?: string | undefined;

    /**
     * By default, Amazon S3 uses the STANDARD Storage Class to store newly created objects.
     *
     * @example
     *    // Setting explicit Storage class
     *     const file = s3.file("my-file.json", {
     *       storageClass: "STANDARD_IA"
     *     });
     */
    storageClass?:
      | "STANDARD"
      | "DEEP_ARCHIVE"
      | "EXPRESS_ONEZONE"
      | "GLACIER"
      | "GLACIER_IR"
      | "INTELLIGENT_TIERING"
      | "ONEZONE_IA"
      | "OUTPOSTS"
      | "REDUCED_REDUNDANCY"
      | "SNOW"
      | "STANDARD_IA";

    /**
     * When set to `true`, confirms that the requester knows they will be charged
     * for the request and data transfer costs. Required for accessing objects
     * in Requester Pays buckets.
     *
     * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/RequesterPaysBuckets.html
     *
     * @example
     *    // Accessing a file in a Requester Pays bucket
     *     const file = s3.file("data.csv", {
     *       bucket: "requester-pays-bucket",
     *       requestPayer: true
     *     });
     *     const content = await file.text();
     *
     * @example
     *    // Uploading to a Requester Pays bucket
     *     await s3.write("output.json", data, {
     *       bucket: "requester-pays-bucket",
     *       requestPayer: true
     *     });
     */
    requestPayer?: boolean;

    /**
     * @deprecated The size of the internal buffer in bytes. Defaults to 5 MiB. use `partSize` and `queueSize` instead.
     */
    highWaterMark?: number;
  }

  /**
   * Options for generating presigned URLs
   */
  interface S3FilePresignOptions extends S3Options {
    /**
     * Number of seconds until the presigned URL expires.
     * - Default: 86400 (1 day)
     *
     * @example
     *     // Short-lived URL
     *     const url = file.presign({
     *       expiresIn: 3600 // 1 hour
     *     });
     *
     * @example
     *     // Long-lived public URL
     *     const url = file.presign({
     *       expiresIn: 7 * 24 * 60 * 60, // 7 days
     *       acl: "public-read"
     *     });
     */
    expiresIn?: number;

    /**
     * The HTTP method allowed for the presigned URL.
     *
     * @example
     *     // GET URL for downloads
     *     const downloadUrl = file.presign({
     *       method: "GET",
     *       expiresIn: 3600
     *     });
     *
     * @example
     *     // PUT URL for uploads
     *     const uploadUrl = file.presign({
     *       method: "PUT",
     *       expiresIn: 3600,
     *       type: "application/json"
     *     });
     */
    method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  }

  interface S3Stats {
    size: number;
    lastModified: Date;
    etag: string;
    type: string;
  }

  /**
   * Represents a file in an S3-compatible storage service.
   * Extends the Blob interface for compatibility with web APIs.
   *
   * @category Cloud Storage
   */
  interface S3File extends Blob {
    /**
     * The size of the file in bytes.
     * This is a Promise because it requires a network request to determine the size.
     *
     * @example
     *     // Getting file size
     *     const size = await file.size;
     *     console.log(`File size: ${size} bytes`);
     *
     * @example
     *     // Check if file is larger than 1MB
     *     if (await file.size > 1024 * 1024) {
     *       console.log("Large file detected");
     *     }
     */
    /**
     * TODO: figure out how to get the typescript types to not error for this property.
     */
    // size: Promise<number>;

    /**
     * Creates a new S3File representing a slice of the original file.
     * Uses HTTP Range headers for efficient partial downloads.
     *
     * @param begin - Starting byte offset
     * @param end - Ending byte offset (exclusive)
     * @param contentType - Optional MIME type for the slice
     * @returns A new S3File representing the specified range
     *
     * @example
     *  // Reading file header
     *     const header = file.slice(0, 1024);
     *     const headerText = await header.text();
     *
     * @example
     *     // Reading with content type
     *     const jsonSlice = file.slice(1024, 2048, "application/json");
     *     const data = await jsonSlice.json();
     *
     * @example
     *     // Reading from offset to end
     *     const remainder = file.slice(1024);
     *     const content = await remainder.text();
     */
    slice(begin?: number, end?: number, contentType?: string): S3File;
    slice(begin?: number, contentType?: string): S3File;
    slice(contentType?: string): S3File;

    /**
     * Creates a writable stream for uploading data.
     * Suitable for large files as it uses multipart upload.
     *
     * @param options - Configuration for the upload
     * @returns A NetworkSink for writing data
     *
     * @example
     *     // Basic streaming write
     *     const writer = file.writer({
     *       type: "application/json"
     *     });
     *     writer.write('{"hello": ');
     *     writer.write('"world"}');
     *     await writer.end();
     *
     * @example
     *     // Optimized large file upload
     *     const writer = file.writer({
     *       partSize: 10 * 1024 * 1024, // 10MB parts
     *       queueSize: 4, // Upload 4 parts in parallel
     *       retry: 3 // Retry failed parts
     *     });
     *
     *     // Write large chunks of data efficiently
     *     for (const chunk of largeDataChunks) {
     *       writer.write(chunk);
     *     }
     *     await writer.end();
     *
     * @example
     *     // Error handling
     *     const writer = file.writer();
     *     try {
     *       writer.write(data);
     *       await writer.end();
     *     } catch (err) {
     *       console.error('Upload failed:', err);
     *       // Writer will automatically abort multipart upload on error
     *     }
     */
    writer(options?: S3Options): NetworkSink;

    /**
     * Gets a readable stream of the file's content.
     * Useful for processing large files without loading them entirely into memory.
     *
     * @returns A ReadableStream for the file content
     *
     * @example
     *     // Basic streaming read
     *     const stream = file.stream();
     *     for await (const chunk of stream) {
     *       console.log('Received chunk:', chunk);
     *     }
     *
     * @example
     *     // Piping to response
     *     const stream = file.stream();
     *     return new Response(stream, {
     *       headers: { 'Content-Type': file.type }
     *     });
     *
     * @example
     *     // Processing large files
     *     const stream = file.stream();
     *     const textDecoder = new TextDecoder();
     *     for await (const chunk of stream) {
     *       const text = textDecoder.decode(chunk);
     *       // Process text chunk by chunk
     *     }
     */
    readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>;
    stream(): ReadableStream<Uint8Array<ArrayBuffer>>;

    /**
     * The name or path of the file in the bucket.
     *
     * @example
     * const file = s3.file("folder/image.jpg");
     * console.log(file.name); // "folder/image.jpg"
     */
    readonly name?: string;

    /**
     * The bucket name containing the file.
     *
     * @example
     *    const file = s3.file("s3://my-bucket/file.txt");
     *    console.log(file.bucket); // "my-bucket"
     */
    readonly bucket?: string;

    /**
     * Checks if the file exists in S3.
     * Uses HTTP HEAD request to efficiently check existence without downloading.
     *
     * @returns Promise resolving to true if file exists, false otherwise
     *
     * @example
     *     // Basic existence check
     *    if (await file.exists()) {
     *      console.log("File exists in S3");
     *    }
     *
     * @example
     *  // With error handling
     *  try {
     *    const exists = await file.exists();
     *    if (!exists) {
     *      console.log("File not found");
     *    }
     *  } catch (err) {
     *    console.error("Error checking file:", err);
     *  }
     */
    exists(): Promise<boolean>;

    /**
     * Uploads data to S3.
     * Supports various input types and automatically handles large files.
     *
     * @param data - The data to upload
     * @param options - Upload configuration options
     * @returns Promise resolving to number of bytes written
     *
     * @example
     *     // Writing string data
     *     await file.write("Hello World", {
     *       type: "text/plain"
     *     });
     *
     * @example
     *     // Writing JSON
     *     const data = { hello: "world" };
     *     await file.write(JSON.stringify(data), {
     *       type: "application/json"
     *     });
     *
     * @example
     *     // Writing from Response
     *     const response = await fetch("https://example.com/data");
     *     await file.write(response);
     *
     * @example
     *     // Writing with ACL
     *     await file.write(data, {
     *       acl: "public-read",
     *       type: "application/octet-stream"
     *     });
     */
    write(
      data:
        | string
        | ArrayBufferView
        | ArrayBuffer
        | SharedArrayBuffer
        | Request
        | Response
        | BunFile
        | S3File
        | Blob
        | Archive,
      options?: S3Options,
    ): Promise<number>;

    /**
     * Generates a presigned URL for the file.
     * Allows temporary access to the file without exposing credentials.
     *
     * @param options - Configuration for the presigned URL
     * @returns Presigned URL string
     *
     * @example
     *     // Basic download URL
     *     const url = file.presign({
     *       expiresIn: 3600 // 1 hour
     *     });
     *
     * @example
     *     // Upload URL with specific content type
     *     const uploadUrl = file.presign({
     *       method: "PUT",
     *       expiresIn: 3600,
     *       type: "image/jpeg",
     *       acl: "public-read"
     *     });
     *
     * @example
     *     // URL with custom permissions
     *     const url = file.presign({
     *       method: "GET",
     *       expiresIn: 7 * 24 * 60 * 60, // 7 days
     *       acl: "public-read"
     *     });
     */
    presign(options?: S3FilePresignOptions): string;

    /**
     * Deletes the file from S3.
     *
     * @returns Promise that resolves when deletion is complete
     *
     * @example
     *     // Basic deletion
     *     await file.delete();
     *
     * @example
     *     // With error handling
     *     try {
     *       await file.delete();
     *       console.log("File deleted successfully");
     *     } catch (err) {
     *       console.error("Failed to delete file:", err);
     *     }
     */
    delete(): Promise<void>;

    /**
     * Alias for delete() method.
     * Provided for compatibility with Node.js fs API naming.
     *
     * @example
     * await file.unlink();
     */
    unlink: S3File["delete"];

    /**
     * Get the stat of a file in an S3-compatible storage service.
     *
     * @returns Promise resolving to S3Stat
     */
    stat(): Promise<S3Stats>;
  }

  interface S3ListObjectsOptions {
    /** Limits the response to keys that begin with the specified prefix. */
    prefix?: string;
    /** ContinuationToken indicates to S3 that the list is being continued on this bucket with a token. ContinuationToken is obfuscated and is not a real key. You can use this ContinuationToken for pagination of the list results. */
    continuationToken?: string;
    /** A delimiter is a character that you use to group keys. */
    delimiter?: string;
    /** Sets the maximum number of keys returned in the response. By default, the action returns up to 1,000 key names. The response might contain fewer keys but will never contain more. */
    maxKeys?: number;
    /** StartAfter is where you want S3 to start listing from. S3 starts listing after this specified key. StartAfter can be any key in the bucket. */
    startAfter?: string;
    /** Encoding type used by S3 to encode the object keys in the response. Responses are encoded only in UTF-8. An object key can contain any Unicode character. However, the XML 1.0 parser can't parse certain characters, such as characters with an ASCII value from 0 to 10. For characters that aren't supported in XML 1.0, you can add this parameter to request that S3 encode the keys in the response. */
    encodingType?: "url";
    /** If you want to return the owner field with each key in the result, then set the FetchOwner field to true. */
    fetchOwner?: boolean;
  }

  interface S3ListObjectsResponse {
    /** All of the keys (up to 1,000) that share the same prefix are grouped together. When counting the total numbers of returns by this API operation, this group of keys is considered as one item.
     *
     * A response can contain CommonPrefixes only if you specify a delimiter.
     *
     * CommonPrefixes contains all (if there are any) keys between Prefix and the next occurrence of the string specified by a delimiter.
     *
     * CommonPrefixes lists keys that act like subdirectories in the directory specified by Prefix.
     *
     * For example, if the prefix is notes/ and the delimiter is a slash (/) as in notes/summer/july, the common prefix is notes/summer/. All of the keys that roll up into a common prefix count as a single return when calculating the number of returns. */
    commonPrefixes?: { prefix: string }[];
    /** Metadata about each object returned. */
    contents?: {
      /** The algorithm that was used to create a checksum of the object. */
      checksumAlgorithm?: "CRC32" | "CRC32C" | "SHA1" | "SHA256" | "CRC64NVME";
      /** The checksum type that is used to calculate the object's checksum value. */
      checksumType?: "COMPOSITE" | "FULL_OBJECT";
      /**
       * The entity tag is a hash of the object. The ETag reflects changes only to the contents of an object, not its metadata. The ETag may or may not be an MD5 digest of the object data. Whether or not it is depends on how the object was created and how it is encrypted as described below:
       *
       * - Objects created by the PUT Object, POST Object, or Copy operation, or through the AWS Management Console, and are encrypted by SSE-S3 or plaintext, have ETags that are an MD5 digest of their object data.
       * - Objects created by the PUT Object, POST Object, or Copy operation, or through the AWS Management Console, and are encrypted by SSE-C or SSE-KMS, have ETags that are not an MD5 digest of their object data.
       * - If an object is created by either the Multipart Upload or Part Copy operation, the ETag is not an MD5 digest, regardless of the method of encryption. If an object is larger than 16 MB, the AWS Management Console will upload or copy that object as a Multipart Upload, and therefore the ETag will not be an MD5 digest.
       *
       * MD5 is not supported by directory buckets.
       */
      eTag?: string;
      /** The name that you assign to an object. You use the object key to retrieve the object. */
      key: string;
      /** Creation date of the object. */
      lastModified?: string;
      /** The owner of the object */
      owner?: {
        /** The ID of the owner. */
        id?: string;
        /** The display name of the owner. */
        displayName?: string;
      };
      /** Specifies the restoration status of an object. Objects in certain storage classes must be restored before they can be retrieved. */
      restoreStatus?: {
        /** Specifies whether the object is currently being restored. */
        isRestoreInProgress?: boolean;
        /** Indicates when the restored copy will expire. This value is populated only if the object has already been restored. */
        restoreExpiryDate?: string;
      };
      /** Size in bytes of the object */
      size?: number;
      /** The class of storage used to store the object. */
      storageClass?:
        | "STANDARD"
        | "REDUCED_REDUNDANCY"
        | "GLACIER"
        | "STANDARD_IA"
        | "ONEZONE_IA"
        | "INTELLIGENT_TIERING"
        | "DEEP_ARCHIVE"
        | "OUTPOSTS"
        | "GLACIER_IR"
        | "SNOW"
        | "EXPRESS_ONEZONE";
    }[];
    /** If ContinuationToken was sent with the request, it is included in the response. You can use the returned ContinuationToken for pagination of the list response.  */
    continuationToken?: string;
    /** Causes keys that contain the same string between the prefix and the first occurrence of the delimiter to be rolled up into a single result element in the CommonPrefixes collection. These rolled-up keys are not returned elsewhere in the response. Each rolled-up result counts as only one return against the MaxKeys value. */
    delimiter?: string;
    /** Encoding type used by S3 to encode object key names in the XML response. */
    encodingType?: "url";
    /** Set to false if all of the results were returned. Set to true if more keys are available to return. If the number of results exceeds that specified by MaxKeys, all of the results might not be returned. */
    isTruncated?: boolean;
    /** KeyCount is the number of keys returned with this request. KeyCount will always be less than or equal to the MaxKeys field. For example, if you ask for 50 keys, your result will include 50 keys or fewer. */
    keyCount?: number;
    /** Sets the maximum number of keys returned in the response. By default, the action returns up to 1,000 key names. The response might contain fewer keys but will never contain more. */
    maxKeys?: number;
    /** The bucket name. */
    name?: string;
    /** NextContinuationToken is sent when isTruncated is true, which means there are more keys in the bucket that can be listed. The next list requests to S3 can be continued with this NextContinuationToken. NextContinuationToken is obfuscated and is not a real key. */
    nextContinuationToken?: string;
    /** Keys that begin with the indicated prefix. */
    prefix?: string;
    /** If StartAfter was sent with the request, it is included in the response. */
    startAfter?: string;
  }

  /**
   * A configured S3 bucket instance for managing files.
   * The instance is callable to create S3File instances and provides methods
   * for common operations.
   *
   * @example
   *     // Basic bucket setup
   *     const bucket = new S3Client({
   *       bucket: "my-bucket",
   *       accessKeyId: "key",
   *       secretAccessKey: "secret"
   *     });
   *
   *     // Get file instance
   *     const file = bucket.file("image.jpg");
   *
   *     // Common operations
   *     await bucket.write("data.json", JSON.stringify({hello: "world"}));
   *     const url = bucket.presign("file.pdf");
   *     await bucket.unlink("old.txt");
   *
   * @category Cloud Storage
   */
  class S3Client {
    /**
     * Create a new instance of an S3 bucket so that credentials can be managed
     * from a single instance instead of being passed to every method.
     *
     * @param options The default options to use for the S3 client. Can be
     * overriden by passing options to the methods.
     * @returns A new S3Client instance
     *
     * ## Keep S3 credentials in a single instance
     *
     * @example
     *     const bucket = new Bun.S3Client({
     *       accessKeyId: "your-access-key",
     *       secretAccessKey: "your-secret-key",
     *       bucket: "my-bucket",
     *       endpoint: "https://s3.us-east-1.amazonaws.com",
     *       sessionToken: "your-session-token",
     *     });
     *
     *     // S3Client is callable, so you can do this:
     *     const file = bucket.file("my-file.txt");
     *
     *     // or this:
     *     await file.write("Hello Bun!");
     *     await file.text();
     *
     *     // To delete the file:
     *     await bucket.delete("my-file.txt");
     *
     *     // To write a file without returning the instance:
     *     await bucket.write("my-file.txt", "Hello Bun!");
     *
     */
    constructor(options?: S3Options);

    /**
     * Creates an S3File instance for the given path.
     *
     * @param path The path to the file in the bucket
     * @param options Additional S3 options to override defaults
     * @returns An S3File instance
     *
     * @example
     *     const file = bucket.file("image.jpg");
     *     await file.write(imageData);
     *
     *     const configFile = bucket.file("config.json", {
     *       type: "application/json",
     *       acl: "private"
     *     });
     */
    file(path: string, options?: S3Options): S3File;

    /**
     * Creates an S3File instance for the given path.
     *
     * @param path The path to the file in the bucket
     * @param options S3 credentials and configuration options
     * @returns An S3File instance
     *
     * @example
     *     const file = S3Client.file("image.jpg", credentials);
     *     await file.write(imageData);
     *
     *     const configFile = S3Client.file("config.json", {
     *       ...credentials,
     *       type: "application/json",
     *       acl: "private"
     *     });
     */
    static file(path: string, options?: S3Options): S3File;

    /**
     * Writes data directly to a path in the bucket.
     * Supports strings, buffers, streams, and web API types.
     *
     * @param path The path to the file in the bucket
     * @param data The data to write to the file
     * @param options Additional S3 options to override defaults
     * @returns The number of bytes written
     *
     * @example
     *     // Write string
     *     await bucket.write("hello.txt", "Hello World");
     *
     *     // Write JSON with type
     *     await bucket.write(
     *       "data.json",
     *       JSON.stringify({hello: "world"}),
     *       {type: "application/json"}
     *     );
     *
     *     // Write from fetch
     *     const res = await fetch("https://example.com/data");
     *     await bucket.write("data.bin", res);
     *
     *     // Write with ACL
     *     await bucket.write("public.html", html, {
     *       acl: "public-read",
     *       type: "text/html"
     *     });
     */
    write(
      path: string,
      data:
        | string
        | ArrayBufferView
        | ArrayBuffer
        | SharedArrayBuffer
        | Request
        | Response
        | BunFile
        | S3File
        | Blob
        | File
        | Archive,
      options?: S3Options,
    ): Promise<number>;

    /**
     * Writes data directly to a path in the bucket.
     * Supports strings, buffers, streams, and web API types.
     *
     * @param path The path to the file in the bucket
     * @param data The data to write to the file
     * @param options S3 credentials and configuration options
     * @returns The number of bytes written
     *
     * @example
     *     // Write string
     *     await S3Client.write("hello.txt", "Hello World", credentials);
     *
     *     // Write JSON with type
     *     await S3Client.write(
     *       "data.json",
     *       JSON.stringify({hello: "world"}),
     *       {
     *         ...credentials,
     *         type: "application/json"
     *       }
     *     );
     *
     *     // Write from fetch
     *     const res = await fetch("https://example.com/data");
     *     await S3Client.write("data.bin", res, credentials);
     *
     *     // Write with ACL
     *     await S3Client.write("public.html", html, {
     *       ...credentials,
     *       acl: "public-read",
     *       type: "text/html"
     *     });
     */
    static write(
      path: string,
      data:
        | string
        | ArrayBufferView
        | ArrayBuffer
        | SharedArrayBuffer
        | Request
        | Response
        | BunFile
        | S3File
        | Blob
        | File
        | Archive,
      options?: S3Options,
    ): Promise<number>;

    /**
     * Generate a presigned URL for temporary access to a file.
     * Useful for generating upload/download URLs without exposing credentials.
     *
     * @param path The path to the file in the bucket
     * @param options Options for generating the presigned URL
     * @returns A presigned URL string
     *
     * @example
     *     // Download URL
     *     const downloadUrl = bucket.presign("file.pdf", {
     *       expiresIn: 3600 // 1 hour
     *     });
     *
     *     // Upload URL
     *     const uploadUrl = bucket.presign("uploads/image.jpg", {
     *       method: "PUT",
     *       expiresIn: 3600,
     *       type: "image/jpeg",
     *       acl: "public-read"
     *     });
     *
     *     // Long-lived public URL
     *     const publicUrl = bucket.presign("public/doc.pdf", {
     *       expiresIn: 7 * 24 * 60 * 60, // 7 days
     *       acl: "public-read"
     *     });
     */
    presign(path: string, options?: S3FilePresignOptions): string;

    /**
     * Generate a presigned URL for temporary access to a file.
     * Useful for generating upload/download URLs without exposing credentials.
     *
     * @param path The path to the file in the bucket
     * @param options S3 credentials and presigned URL configuration
     * @returns A presigned URL string
     *
     * @example
     *     // Download URL
     *     const downloadUrl = S3Client.presign("file.pdf", {
     *       ...credentials,
     *       expiresIn: 3600 // 1 hour
     *     });
     *
     *     // Upload URL
     *     const uploadUrl = S3Client.presign("uploads/image.jpg", {
     *       ...credentials,
     *       method: "PUT",
     *       expiresIn: 3600,
     *       type: "image/jpeg",
     *       acl: "public-read"
     *     });
     *
     *     // Long-lived public URL
     *     const publicUrl = S3Client.presign("public/doc.pdf", {
     *       ...credentials,
     *       expiresIn: 7 * 24 * 60 * 60, // 7 days
     *       acl: "public-read"
     *     });
     */
    static presign(path: string, options?: S3FilePresignOptions): string;

    /**
     * Delete a file from the bucket.
     *
     * @param path The path to the file in the bucket
     * @param options Additional S3 options to override defaults
     * @returns A promise that resolves when deletion is complete
     *
     * @example
     *     // Simple delete
     *     await bucket.unlink("old-file.txt");
     *
     *     // With error handling
     *     try {
     *       await bucket.unlink("file.dat");
     *       console.log("File deleted");
     *     } catch (err) {
     *       console.error("Delete failed:", err);
     *     }
     */
    unlink(path: string, options?: S3Options): Promise<void>;

    /**
     * Delete a file from the bucket.
     *
     * @param path The path to the file in the bucket
     * @param options S3 credentials and configuration options
     * @returns A promise that resolves when deletion is complete
     *
     * @example
     *     // Simple delete
     *     await S3Client.unlink("old-file.txt", credentials);
     *
     *     // With error handling
     *     try {
     *       await S3Client.unlink("file.dat", credentials);
     *       console.log("File deleted");
     *     } catch (err) {
     *       console.error("Delete failed:", err);
     *     }
     */
    static unlink(path: string, options?: S3Options): Promise<void>;

    /**
     * Delete a file from the bucket.
     * Alias for {@link S3Client.unlink}.
     *
     * @param path The path to the file in the bucket
     * @param options Additional S3 options to override defaults
     * @returns A promise that resolves when deletion is complete
     *
     * @example
     *     // Simple delete
     *     await bucket.delete("old-file.txt");
     *
     *     // With error handling
     *     try {
     *       await bucket.delete("file.dat");
     *       console.log("File deleted");
     *     } catch (err) {
     *       console.error("Delete failed:", err);
     *     }
     */
    delete(path: string, options?: S3Options): Promise<void>;

    /**
     * Delete a file from the bucket.
     * Alias for {@link S3Client.unlink}.
     *
     * @param path The path to the file in the bucket
     * @param options S3 credentials and configuration options
     * @returns A promise that resolves when deletion is complete
     *
     * @example
     *     // Simple delete
     *     await S3Client.delete("old-file.txt", credentials);
     *
     *     // With error handling
     *     try {
     *       await S3Client.delete("file.dat", credentials);
     *       console.log("File deleted");
     *     } catch (err) {
     *       console.error("Delete failed:", err);
     *     }
     */
    static delete(path: string, options?: S3Options): Promise<void>;

    /**
     * Get the size of a file in bytes.
     * Uses HEAD request to efficiently get size.
     *
     * @param path The path to the file in the bucket
     * @param options Additional S3 options to override defaults
     * @returns A promise that resolves to the file size in bytes
     *
     * @example
     *     // Get size
     *     const bytes = await bucket.size("video.mp4");
     *     console.log(`Size: ${bytes} bytes`);
     *
     *     // Check if file is large
     *     if (await bucket.size("data.zip") > 100 * 1024 * 1024) {
     *       console.log("File is larger than 100MB");
     *     }
     */
    size(path: string, options?: S3Options): Promise<number>;

    /**
     * Get the size of a file in bytes.
     * Uses HEAD request to efficiently get size.
     *
     * @param path The path to the file in the bucket
     * @param options S3 credentials and configuration options
     * @returns A promise that resolves to the file size in bytes
     *
     * @example
     *     // Get size
     *     const bytes = await S3Client.size("video.mp4", credentials);
     *     console.log(`Size: ${bytes} bytes`);
     *
     *     // Check if file is large
     *     if (await S3Client.size("data.zip", credentials) > 100 * 1024 * 1024) {
     *       console.log("File is larger than 100MB");
     *     }
     */
    static size(path: string, options?: S3Options): Promise<number>;

    /**
     * Check if a file exists in the bucket.
     * Uses HEAD request to check existence.
     *
     * @param path The path to the file in the bucket
     * @param options Additional S3 options to override defaults
     * @returns A promise that resolves to true if the file exists, false otherwise
     *
     * @example
     *     // Check existence
     *     if (await bucket.exists("config.json")) {
     *       const file = bucket.file("config.json");
     *       const config = await file.json();
     *     }
     *
     *     // With error handling
     *     try {
     *       if (!await bucket.exists("required.txt")) {
     *         throw new Error("Required file missing");
     *       }
     *     } catch (err) {
     *       console.error("Check failed:", err);
     *     }
     */
    exists(path: string, options?: S3Options): Promise<boolean>;

    /**
     * Check if a file exists in the bucket.
     * Uses HEAD request to check existence.
     *
     * @param path The path to the file in the bucket
     * @param options S3 credentials and configuration options
     * @returns A promise that resolves to true if the file exists, false otherwise
     *
     * @example
     *     // Check existence
     *     if (await S3Client.exists("config.json", credentials)) {
     *       const file = bucket.file("config.json");
     *       const config = await file.json();
     *     }
     *
     *     // With error handling
     *     try {
     *       if (!await S3Client.exists("required.txt", credentials)) {
     *         throw new Error("Required file missing");
     *       }
     *     } catch (err) {
     *       console.error("Check failed:", err);
     *     }
     */
    static exists(path: string, options?: S3Options): Promise<boolean>;

    /**
     * Get the stat of a file in an S3-compatible storage service.
     *
     * @param path The path to the file in the bucket
     * @param options Additional S3 options to override defaults
     * @returns A promise that resolves to the file stats
     *
     * @example
     *     const stat = await bucket.stat("my-file.txt");
     */
    stat(path: string, options?: S3Options): Promise<S3Stats>;

    /**
     * Get the stat of a file in an S3-compatible storage service.
     *
     * @param path The path to the file in the bucket
     * @param options S3 credentials and configuration options
     * @returns A promise that resolves to the file stats
     *
     * @example
     *     const stat = await S3Client.stat("my-file.txt", credentials);
     */
    static stat(path: string, options?: S3Options): Promise<S3Stats>;

    /**
     * Returns some or all (up to 1,000) of the objects in a bucket with each request.
     *
     * You can use the request parameters as selection criteria to return a subset of the objects in a bucket.
     *
     * @param input Options for listing objects in the bucket
     * @param options Additional S3 options to override defaults
     * @returns A promise that resolves to the list response
     *
     * @example
     *     // List (up to) 1000 objects in the bucket
     *     const allObjects = await bucket.list();
     *
     *     // List (up to) 500 objects under `uploads/` prefix, with owner field for each object
     *     const uploads = await bucket.list({
     *       prefix: 'uploads/',
     *       maxKeys: 500,
     *       fetchOwner: true,
     *     });
     *
     *     // Check if more results are available
     *     if (uploads.isTruncated) {
     *       // List next batch of objects under `uploads/` prefix
     *       const moreUploads = await bucket.list({
     *         prefix: 'uploads/',
     *         maxKeys: 500,
     *         startAfter: uploads.contents!.at(-1).key
     *         fetchOwner: true,
     *       });
     *     }
     */
    list(
      input?: S3ListObjectsOptions | null,
      options?: Pick<S3Options, "accessKeyId" | "secretAccessKey" | "sessionToken" | "region" | "bucket" | "endpoint">,
    ): Promise<S3ListObjectsResponse>;

    /**
     * Returns some or all (up to 1,000) of the objects in a bucket with each request.
     *
     * You can use the request parameters as selection criteria to return a subset of the objects in a bucket.
     *
     * @param input Options for listing objects in the bucket
     * @param options S3 credentials and configuration options
     * @returns A promise that resolves to the list response
     *
     * @example
     *     // List (up to) 1000 objects in the bucket
     *     const allObjects = await S3Client.list(null, credentials);
     *
     *     // List (up to) 500 objects under `uploads/` prefix, with owner field for each object
     *     const uploads = await S3Client.list({
     *       prefix: 'uploads/',
     *       maxKeys: 500,
     *       fetchOwner: true,
     *     }, credentials);
     *
     *     // Check if more results are available
     *     if (uploads.isTruncated) {
     *       // List next batch of objects under `uploads/` prefix
     *       const moreUploads = await S3Client.list({
     *         prefix: 'uploads/',
     *         maxKeys: 500,
     *         startAfter: uploads.contents!.at(-1).key
     *         fetchOwner: true,
     *       }, credentials);
     *     }
     */
    static list(
      input?: S3ListObjectsOptions | null,
      options?: Pick<S3Options, "accessKeyId" | "secretAccessKey" | "sessionToken" | "region" | "bucket" | "endpoint">,
    ): Promise<S3ListObjectsResponse>;
  }

  /**
   * A default instance of S3Client
   *
   * Pulls credentials from environment variables. Use `new Bun.S3Client()` if you need to explicitly set credentials.
   *
   * @category Cloud Storage
   */
  var s3: S3Client;
}
