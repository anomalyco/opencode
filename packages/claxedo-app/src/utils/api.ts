/**
 * Authenticated API client using Clerk tokens
 */
import { getAuthToken } from "./auth-client";

function normalized(url: string | undefined): string | undefined {
  const trimmed = url?.trim()
  if (!trimmed) return
  return trimmed.replace(/\/+$/, "")
}

/**
 * Get the default base URL for cloud operations.
 */
export function getDefaultBaseUrl(): string {
  const backendUrl = normalized(import.meta.env.VITE_OPENCODE_BACKEND_URL as string | undefined)
  if (backendUrl) return backendUrl

  return normalized(window.location.origin) ?? window.location.origin
}

/**
 * Make an authenticated fetch request with Clerk JWT token.
 * Supports both (url, options) and (Request) calling conventions.
 */
export async function authFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const token = await getAuthToken();

  // Handle Request object (SDK passes Request objects directly)
  if (input instanceof Request) {
    const existingHeaders = new Headers(input.headers);
    if (token) {
      existingHeaders.set("Authorization", `Bearer ${token}`);
    }
    // Create a new Request with updated headers
    return fetch(new Request(input, { headers: existingHeaders }));
  }

  // Handle (url, options) style
  const headers = new Headers(init?.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Ensure Content-Type is set for JSON requests
  if (init?.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(input, {
    ...init,
    headers,
  });
}

/**
 * API client with common methods
 */
export const api = {
  /**
   * GET request with auth
   */
  async get<T = any>(url: string): Promise<T> {
    const res = await authFetch(url);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `Request failed: ${res.status}`);
    }
    return res.json();
  },

  /**
   * POST request with auth
   */
  async post<T = any>(url: string, body?: any): Promise<T> {
    const res = await authFetch(url, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `Request failed: ${res.status}`);
    }
    return res.json();
  },

  /**
   * PUT request with auth
   */
  async put<T = any>(url: string, body?: any): Promise<T> {
    const res = await authFetch(url, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `Request failed: ${res.status}`);
    }
    return res.json();
  },

  /**
   * DELETE request with auth
   */
  async delete<T = any>(url: string): Promise<T> {
    const res = await authFetch(url, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `Request failed: ${res.status}`);
    }
    return res.json();
  },
};
