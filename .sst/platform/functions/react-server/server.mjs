// This is a custom Lambda URL handler which imports the React Router server
// build and performs the server rendering.

// Output build will be "server/index.js"
import * as serverBuild from "./server/index.js";

import { createRequestHandler as createReactRouterRequestHandler } from "react-router";

function convertLambdaRequestToNode(event) {
  if (event.headers["x-forwarded-host"]) {
    event.headers.host = event.headers["x-forwarded-host"];
  }

  const search = event.rawQueryString.length ? `?${event.rawQueryString}` : "";
  const url = new URL(event.rawPath + search, `https://${event.headers.host}`);
  const isFormData = event.headers["content-type"]?.includes(
    "multipart/form-data",
  );

  // Build headers
  const headers = new Headers();
  for (let [header, value] of Object.entries(event.headers)) {
    if (value) {
      headers.append(header, value);
    }
  }

  return new Request(url.href, {
    method: event.requestContext.http.method,
    headers,
    body:
      event.body && event.isBase64Encoded
        ? isFormData
          ? Buffer.from(event.body, "base64")
          : Buffer.from(event.body, "base64").toString()
        : event.body,
  });
}

const createLambdaHandler = (build) => {
  const requestHandler = createReactRouterRequestHandler(build, "production");

  return awslambda.streamifyResponse(async (event, responseStream, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    const request = convertLambdaRequestToNode(event);
    const response = await requestHandler(request);
    const writer = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: response.status,
      headers: {
        ...Object.fromEntries(response.headers.entries()),
        "Transfer-Encoding": "chunked",
      },
      cookies: response.headers.getSetCookie(),
    });

    if (response.body) {
      const reader = response.body.getReader();
      let readResult = await reader.read();
      while (!readResult.done) {
        writer.write(readResult.value);
        readResult = await reader.read();
      }
    } else {
      writer.write(" ");
    }
    writer.end();
  });
};

export const handler = createLambdaHandler(serverBuild);
