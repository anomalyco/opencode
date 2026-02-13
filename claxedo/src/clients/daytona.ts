/**
 * Daytona client singleton
 */
import { Daytona } from "@daytonaio/sdk";
import { Config } from "../config/index.ts";

let daytonaClient: Daytona | undefined;

export function getDaytona(): Daytona {
  if (daytonaClient) return daytonaClient;

  const rawApiUrl = Config.DAYTONA_API_URL;
  const apiUrl = rawApiUrl
    ? rawApiUrl.endsWith("/api")
      ? rawApiUrl
      : `${rawApiUrl.replace(/\/+$/, "")}/api`
    : undefined;

  daytonaClient = new Daytona({
    apiKey: Config.DAYTONA_API_KEY,
    apiUrl,
    target: Config.DAYTONA_TARGET,
  });

  return daytonaClient;
}
