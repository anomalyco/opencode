import path from "node:path";
import fs from "node:fs";
import url from "node:url";
import type { Context as LambdaContext } from "aws-lambda";

// get first arg
const handler = process.argv[2];
const AWS_LAMBDA_RUNTIME_API =
  `http://` + process.env.AWS_LAMBDA_RUNTIME_API! + "/2018-06-01";
const parsed = path.parse(handler);

const file = [".js", ".jsx", ".mjs", ".cjs"]
  .map((ext) => path.join(parsed.dir, parsed.name + ext))
  .find((file) => {
    return fs.existsSync(file);
  })!;

let fn: any;
let request: any;
let response: any;
let context: LambdaContext;

async function error(ex: any) {
  const body = JSON.stringify({
    errorType: "Error",
    errorMessage: ex.message,
    trace: ex.stack?.split("\n"),
  });
  await fetch(
    AWS_LAMBDA_RUNTIME_API +
      (!context
        ? `/runtime/init/error`
        : `/runtime/invocation/${context.awsRequestId}/error`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    },
  );
}
process.on("unhandledRejection", error);
process.on("uncaughtException", error);
try {
  const { href } = url.pathToFileURL(file);
  const mod = await import(href);
  const handler = parsed.ext.substring(1);
  fn = mod[handler];
  if (!fn) {
    throw new Error(
      `Function "${handler}" not found in "${handler}". Found ${Object.keys(
        mod,
      ).join(", ")}`,
    );
  }
} catch (ex: any) {
  await error(ex);
  process.exit(1);
}

while (true) {
  const timeout = setTimeout(
    () => {
      process.exit(0);
    },
    1000 * 60 * 1,
  );

  try {
    const result = await fetch(
      AWS_LAMBDA_RUNTIME_API + `/runtime/invocation/next`,
    );
    clearTimeout(timeout);
    context = {
      awsRequestId: result.headers.get("lambda-runtime-aws-request-id") || "",
      invokedFunctionArn:
        result.headers.get("lambda-runtime-invoked-function-arn") || "",
      getRemainingTimeInMillis: () =>
        Math.max(
          Number(result.headers.get("lambda-runtime-deadline-ms")) - Date.now(),
          0,
        ),
      // If identity is null, we want to mimic AWS behavior and return undefined
      identity: (() => {
        const header = result.headers.get("lambda-runtime-cognito-identity");
        return header ? JSON.parse(header) : undefined;
      })(),
      /// If clientContext is null, we want to mimic AWS behavior and return undefined
      clientContext: (() => {
        const header = result.headers.get("lambda-runtime-client-context");
        return header ? JSON.parse(header) : undefined;
      })(),
      functionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
      functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION!,
      memoryLimitInMB: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE!,
      logGroupName: result.headers.get("lambda-runtime-log-group-name") || "",
      logStreamName: result.headers.get("lambda-runtime-log-stream-name") || "",
      callbackWaitsForEmptyEventLoop: {
        set value(_value: boolean) {
          throw new Error(
            "`callbackWaitsForEmptyEventLoop` on lambda Context is not implemented by SST Live Lambda Development.",
          );
        },
        get value() {
          return true;
        },
      }.value,
      done() {
        throw new Error(
          "`done` on lambda Context is not implemented by SST Live Lambda Development.",
        );
      },
      fail() {
        throw new Error(
          "`fail` on lambda Context is not implemented by SST Live Lambda Development.",
        );
      },
      succeed() {
        throw new Error(
          "`succeed` on lambda Context is not implemented by SST Live Lambda Development.",
        );
      },
    };
    request = await result.json();
  } catch (ex: any) {
    if (ex.code === "UND_ERR_HEADERS_TIMEOUT") continue;
    await error(ex);
    continue;
  }
  (global as any)[Symbol.for("aws.lambda.runtime.requestId")] =
    context.awsRequestId;

  try {
    response = await fn(request, context);
  } catch (ex: any) {
    await error(ex);
    continue;
  }

  while (true) {
    try {
      await fetch(
        AWS_LAMBDA_RUNTIME_API +
          `/runtime/invocation/${context.awsRequestId}/response`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(response),
        },
      );
      break;
    } catch (ex) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
