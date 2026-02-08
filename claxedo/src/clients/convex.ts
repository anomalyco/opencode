/**
 * Convex client singleton
 */
import { ConvexHttpClient } from "convex/browser";
import { requireConvexUrl } from "../config/index.ts";

let convexClient: ConvexHttpClient | undefined;

export function getConvex(): ConvexHttpClient {
  const convexUrl = requireConvexUrl();
  if (!convexClient) {
    convexClient = new ConvexHttpClient(convexUrl);
  }
  return convexClient;
}
