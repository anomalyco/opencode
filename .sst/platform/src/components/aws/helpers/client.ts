import { StandardRetryStrategy } from "@aws-sdk/middleware-retry";
export type {} from "@smithy/types";

type ClientOptions = {
  region?: string;
  retrableErrors?: string[];
};

class AwsError extends Error {
  requestID?: string;
  statusCode?: number;
}

const printNoInternet = (() => {
  let lastPrinted = 0;
  return () => {
    const now = Date.now();
    if (now - lastPrinted > 5000) {
      console.log("Waiting for internet connection...");
      lastPrinted = now;
    }
  };
})();

export const useClient = <C extends any>(
  client: new (config: any) => C,
  opts?: ClientOptions,
) => {
  return new client({
    region: opts?.region ?? process.env.SST_AWS_REGION,
    credentials: process.env.SST_AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.SST_AWS_ACCESS_KEY_ID,
          sessionToken: process.env.SST_AWS_SESSION_TOKEN,
          secretAccessKey: process.env.SST_AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
    retryStrategy: new StandardRetryStrategy(async () => 10000, {
      retryDecider: (e: any) => {
        // Handle no internet connection => retry
        if (e.code === "ENOTFOUND") {
          printNoInternet();
          return true;
        }

        // Handle throttling errors => retry
        if (
          [
            "ThrottlingException",
            "Throttling",
            "TooManyRequestsException",
            "OperationAbortedException",
            "TimeoutError",
            "NetworkingError",
            ...(opts?.retrableErrors ?? []),
          ].includes(e.name)
        ) {
          return true;
        }

        return false;
      },
      delayDecider: (_, attempts) => {
        return Math.min(1.5 ** attempts * 100, 5000);
      },
      // AWS SDK v3 has an idea of "retry tokens" which are used to
      // prevent multiple retries from happening at the same time.
      // This is a workaround to disable that.
      retryQuota: {
        hasRetryTokens: () => true,
        releaseRetryTokens: () => {},
        retrieveRetryTokens: () => 1,
      },
    }),
  });
};
