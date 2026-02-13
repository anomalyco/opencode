/**
 * Sandbox Orchestrator for Claxedo
 *
 * Manages Cloud Sandbox lifecycle using provider-agnostic abstraction.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { type CloudSandbox } from "../sandboxes/index.ts";
import { DaytonaSandbox } from "../sandboxes/providers/daytona.ts";
import {
  withSpan,
  SpanKind,
  workspaceCreationDuration,
  sandboxCreationDuration,
  sandboxCreationsTotal,
  activeSandboxes,
  convexQueryDuration,
  credentialSyncDuration,
  credentialSyncTotal,
  startTimer,
} from "../observability/index.ts";

export interface SandboxConfig {
  daytonaApiKey: string;
  daytonaApiUrl?: string; // Optional custom URL
  daytonaTarget?: string;
  encryptionKey: string;
  convexUrl: string;
}

export interface CreateSandboxRequest {
  projectId?: string;
  projectExternalId?: string;
  projectName?: string;
  workspaceName?: string;
  organizationId: string;
  userId: string;
  repoUrl?: string;
  branch?: string;
}

export interface SandboxInfo {
  workspaceId?: string;
  sandboxId: string;
  url: string;
  status: "running" | "stopped" | "deleted";
  directory?: string;
  createdAt: number;
  projectId?: string;
  projectExternalId?: string;
}

// Encryption utilities (AES-256-GCM)
export async function encrypt(plaintext: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key.padEnd(32, "0").slice(0, 32));

  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoder.encode(plaintext)),
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(encryptedData: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key.padEnd(32, "0").slice(0, 32));
  
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "AES-GCM" }, false, ["decrypt"]);
  const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
  return new TextDecoder().decode(decrypted);
}

export const SANDBOX_AUTO_STOP_MS = 30 * 60 * 1000;
export const SANDBOX_AUTO_DELETE_MS = 7 * 24 * 60 * 60 * 1000;

function providerToEnvKey(providerId: string): string | null {
  const id = providerId.toLowerCase();
  if (id === "vercel" || id === "ai-gateway" || id === "vercel-ai-gateway") return "AI_GATEWAY_API_KEY";
  if (id === "openai") return "OPENAI_API_KEY";
  if (id === "anthropic") return "ANTHROPIC_API_KEY";
  if (id === "openrouter") return "OPENROUTER_API_KEY";
  if (id === "groq") return "GROQ_API_KEY";
  if (id === "mistral") return "MISTRAL_API_KEY";
  if (id === "together" || id === "togetherai") return "TOGETHERAI_API_KEY";
  if (id === "perplexity") return "PERPLEXITY_API_KEY";
  if (id === "xai") return "XAI_API_KEY";
  if (id === "google" || id === "gemini" || id === "google-generative-ai") return "GOOGLE_GENERATIVE_AI_API_KEY";
  return null;
}

function envKeyToProvider(envKey: string): string | null {
  if (envKey === "AI_GATEWAY_API_KEY") return "vercel";
  if (envKey === "OPENAI_API_KEY") return "openai";
  if (envKey === "ANTHROPIC_API_KEY") return "anthropic";
  if (envKey === "OPENROUTER_API_KEY") return "openrouter";
  if (envKey === "GROQ_API_KEY") return "groq";
  if (envKey === "MISTRAL_API_KEY") return "mistral";
  if (envKey === "TOGETHERAI_API_KEY") return "togetherai";
  if (envKey === "PERPLEXITY_API_KEY") return "perplexity";
  if (envKey === "XAI_API_KEY") return "xai";
  if (envKey === "GOOGLE_GENERATIVE_AI_API_KEY") return "google";
  return null;
}

export class SandboxOrchestrator {
  private config: SandboxConfig;
  private convexClient: ConvexHttpClient | null = null;
  private activeSandboxes = new Map<string, CloudSandbox>(); // Cache active instances

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  private getConvex(): ConvexHttpClient {
    if (!this.convexClient) {
      this.convexClient = new ConvexHttpClient(this.config.convexUrl);
    }
    return this.convexClient;
  }

  // Factory for sandbox instance
  private getSandboxInstance(orgId: string, workspaceId: string): CloudSandbox {
    const key = `${orgId}:${workspaceId}`;
    if (this.activeSandboxes.has(key)) {
      return this.activeSandboxes.get(key)!;
    }
    
    // Default to Daytona for now, could switch based on config
    const sandbox = new DaytonaSandbox({
      orgId,
      sessionId: workspaceId,
      apiKey: this.config.daytonaApiKey,
      apiUrl: this.config.daytonaApiUrl,
      target: this.config.daytonaTarget,
    });
    
    this.activeSandboxes.set(key, sandbox);
    return sandbox;
  }

  async createSandbox(request: CreateSandboxRequest): Promise<SandboxInfo> {
    const workspaceTimer = startTimer();
    console.log(`[Orchestrator] createSandbox called with:`, JSON.stringify(request, null, 2));
    const convex = this.getConvex();

    // Organization ID comes from Clerk JWT (resolved in identity.ts)
    // Clerk handles membership verification, so we trust the organizationId
    const organizationId = request.organizationId;
    console.log(`[Orchestrator] Using organizationId: ${organizationId}`);

    // Ensure a real Convex project exists for this cloud sandbox.
    // The UI may pass a Convex projectId directly, or a projectExternalId (starts with "proj-").
    let existingProject: any = null;
    let projectExternalId: string;

    // First, try to find existing project by Convex ID if provided
    if (request.projectId && !request.projectId.startsWith("proj-")) {
      // Looks like a Convex ID, try to fetch directly
      existingProject = await convex
        .query(api.projects.getById, { id: request.projectId as any })
        .catch(() => null);
      if (existingProject) {
        projectExternalId = (existingProject as any).externalId ?? `proj-${Date.now()}`;
      } else if (request.projectId) {
        // projectId was provided but not found - this is an error, don't create a new project
        throw new Error(`Project not found: ${request.projectId}`);
      } else {
        projectExternalId = `proj-${Date.now()}`;
      }
    } else if (request.projectId && request.projectId.startsWith("proj-")) {
      // projectId looks like an external ID (proj-xxx)
      projectExternalId = request.projectId;
      existingProject = await convex
        .query(api.projects.getByExternalId, { externalId: projectExternalId })
        .catch(() => null);

      // If projectId was explicitly provided but not found, that's an error
      if (!existingProject) {
        throw new Error(`Project not found with externalId: ${projectExternalId}`);
      }
    } else {
      // No projectId provided - create a new project
      projectExternalId =
        request.projectExternalId ??
        `proj-${Date.now()}`;

      existingProject = await convex
        .query(api.projects.getByExternalId, { externalId: projectExternalId })
        .catch(() => null);
    }

    // Resolve repoUrl and branch from existing project if not explicitly provided
    const repoUrl = request.repoUrl ?? (existingProject as any)?.repoUrl;
    const branch = request.branch ?? (existingProject as any)?.branch;

    const projectName =
      request.projectName ??
      (existingProject as any)?.name ??
      (repoUrl ? repoUrl.split("/").pop()?.replace(/\.git$/, "") : undefined) ??
      "Cloud Project";

    let projectId: string;
    if (existingProject?._id) {
      projectId = existingProject._id as any as string;
    } else {
      try {
        const projectCreateTimer = startTimer();
        projectId = (await convex.mutation(api.projects.create, {
          organizationId,
          name: projectName,
          repoUrl,
          branch,
          externalId: projectExternalId,
        })) as any as string;
        convexQueryDuration.observe({ operation: "projects.create", status: "success" }, projectCreateTimer());
      } catch (err: any) {
        console.error("[Orchestrator] Failed to create project:", err?.message || err?.data || err);
        throw err;
      }
    }

    const safe = (raw: string) =>
      raw
        .toLowerCase()
        .replace(/[^a-z0-9-_.]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "default";

    const workspaceName = request.workspaceName || branch || "main";
    const workspaceDir = `/workspace/${safe(projectExternalId)}/${safe(workspaceName)}`;
    const directory = repoUrl ? `${workspaceDir}/repo` : workspaceDir;

    console.log(`[Orchestrator] Creating workspace: projectId=${projectId}, name=${workspaceName}, directory=${directory}`);
    let workspaceId: string;
    try {
      const workspaceCreateTimer = startTimer();
      workspaceId = (await convex.mutation(api.workspaces.create, {
        projectId,
        name: workspaceName,
        directory,
      })) as any as string;
      convexQueryDuration.observe({ operation: "workspaces.create", status: "success" }, workspaceCreateTimer());
    } catch (err: any) {
      console.error("[Orchestrator] Failed to create workspace:", err?.message || err?.data || err);
      throw err;
    }

    // 3. Fetch AI credentials and inject into the sandbox's OpenCode process.
    // We query both the resolved org ID and the original slug (for dev migration),
    // because earlier versions stored creds under "default" (slug) rather than the Convex _id.
    const credsTimer = startTimer();
    const credsById = await convex
      .query(api.aiCredentials.getByOrg, { organizationId })
      .catch(() => []);
    convexQueryDuration.observe({ operation: "aiCredentials.getByOrg", status: "success" }, credsTimer());

    const credsBySlug =
      request.organizationId && request.organizationId !== organizationId
        ? await convex
            .query(api.aiCredentials.getByOrg, { organizationId: request.organizationId })
            .catch(() => [])
        : [];

    const merged = new Map<string, any>();
    for (const c of [...credsBySlug, ...credsById]) {
      if (c?.provider) merged.set(String(c.provider), c);
    }

    const envFromCreds: Record<string, string> = {};
    console.log(`[Orchestrator] Found ${merged.size} credentials in Convex for org ${organizationId}:`, Array.from(merged.keys()));
    for (const c of merged.values()) {
      const provider = String(c.provider ?? "");
      const envKey = providerToEnvKey(provider);
      console.log(`[Orchestrator] Provider "${provider}" -> envKey "${envKey}"`);
      if (!envKey) continue;
      try {
        const decrypted = await decrypt(String(c.encryptedKey), this.config.encryptionKey);
        envFromCreds[envKey] = decrypted;
        console.log(`[Orchestrator] Decrypted ${envKey}: ${decrypted.substring(0, 10)}...`);
      } catch (err: any) {
        console.warn(`[Orchestrator] Failed to decrypt key for ${provider}: ${err?.message || String(err)}`);
      }
    }
    console.log(`[Orchestrator] Env vars to inject:`, Object.keys(envFromCreds));

    // 4. Initialize Sandbox
    const sandbox = this.getSandboxInstance(organizationId, workspaceId);

    // If the provider supports dynamic env injection, apply it before starting OpenCode.
    const setEnvVars = (sandbox as any).setEnvVars;
    if (typeof setEnvVars === "function" && Object.keys(envFromCreds).length > 0) {
      await setEnvVars.call(sandbox, envFromCreds);
    }

    // 4. Ensure it exists and is running (with metrics)
    const sandboxTimer = startTimer();
    const fromSnapshot = !!process.env.DAYTONA_SNAPSHOT_NAME;
    try {
      await withSpan(
        "sandbox.ensure_running",
        async (span) => {
          span.setAttribute("sandbox.from_snapshot", fromSnapshot);
          span.setAttribute("sandbox.org_id", organizationId);
          await sandbox.ensureRunning();
        },
        { kind: SpanKind.CLIENT }
      );
      const duration = sandboxTimer();
      sandboxCreationDuration.observe(
        { org_id: organizationId, from_snapshot: String(fromSnapshot), status: "success" },
        duration
      );
      sandboxCreationsTotal.inc({ org_id: organizationId, from_snapshot: String(fromSnapshot), status: "success" });
      activeSandboxes.inc({ org_id: organizationId, status: "running" });
    } catch (err) {
      const duration = sandboxTimer();
      sandboxCreationDuration.observe(
        { org_id: organizationId, from_snapshot: String(fromSnapshot), status: "error" },
        duration
      );
      sandboxCreationsTotal.inc({ org_id: organizationId, from_snapshot: String(fromSnapshot), status: "error" });
      throw err;
    }

    // 5. Setup Repo (with tracing)
    const repoDir = directory;
    if (repoUrl) {
      await withSpan(
        "sandbox.repo.clone",
        async (span) => {
          span.setAttribute("repo.url", repoUrl);
          span.setAttribute("repo.dir", repoDir);
          await sandbox.ensureRepo(repoUrl, repoDir);
        },
        { kind: SpanKind.CLIENT }
      );
    }

    // 6. Start OpenCode Server (with tracing)
    const opencodePort = Number.parseInt(process.env.OPENCODE_PORT || "4096", 10);
    // Daytona previews support ports 3000–9999; OpenCode defaults to 4096.
    await withSpan(
      "opencode.server.start",
      async (span) => {
        span.setAttribute("opencode.port", opencodePort);
        span.setAttribute("opencode.cwd", repoUrl ? repoDir : workspaceDir);
        await (sandbox as any).ensureOpencodeServer({
          port: opencodePort,
          cwd: repoUrl ? repoDir : workspaceDir,
        });
      },
      { kind: SpanKind.CLIENT }
    );

    // 7. Inject credentials into the running OpenCode server (with tracing)
    // This ensures credentials are synced even for existing sandboxes
    const injectCredential = (sandbox as any).injectCredential;
    if (typeof injectCredential === "function" && Object.keys(envFromCreds).length > 0) {
      await withSpan(
        "opencode.credentials.inject",
        async (span) => {
          span.setAttribute("credentials.count", Object.keys(envFromCreds).length);
          for (const [envKey, apiKey] of Object.entries(envFromCreds)) {
            // Map env key back to provider ID for the auth endpoint
            const providerID = envKeyToProvider(envKey);
            if (!providerID) continue;
            const credTimer = startTimer();
            try {
              const success = await injectCredential.call(sandbox, opencodePort, providerID, apiKey);
              console.log(`[Orchestrator] Injected ${providerID} credential: ${success ? "ok" : "failed"}`);
              credentialSyncTotal.inc({
                org_id: organizationId,
                provider: providerID,
                status: success ? "success" : "failed",
              });
              credentialSyncDuration.observe({ org_id: organizationId, status: success ? "success" : "failed" }, credTimer());
            } catch (err: any) {
              console.warn(`[Orchestrator] Failed to inject ${providerID}: ${err?.message || String(err)}`);
              credentialSyncTotal.inc({ org_id: organizationId, provider: providerID, status: "error" });
              credentialSyncDuration.observe({ org_id: organizationId, status: "error" }, credTimer());
            }
          }
        },
        { kind: SpanKind.CLIENT }
      );
    }

    const sandboxId = sandbox.id;
    // For URL, we might need a tunneling solution. Daytona handles this via `getPreviewLink` usually,
    // but our abstraction `getServiceUrl` returns internal IP for now.
    // In production, we'd use a Gateway URL.
    const sandboxUrl = await sandbox.getServiceUrl(opencodePort); 

    const updateSandboxTimer = startTimer();
    await convex.mutation(api.workspaces.updateSandbox, {
      id: workspaceId as any,
      sandboxId,
      sandboxUrl,
      sandboxStatus: "running",
    });
    convexQueryDuration.observe({ operation: "workspaces.updateSandbox", status: "success" }, updateSandboxTimer());

    // Record total workspace creation duration
    const totalDuration = workspaceTimer();
    workspaceCreationDuration.observe(
      { org_id: organizationId, has_repo: String(!!repoUrl), status: "success" },
      totalDuration
    );

    return {
      workspaceId,
      sandboxId,
      url: sandboxUrl,
      status: "running",
      directory,
      createdAt: Date.now(),
      projectId,
      projectExternalId,
    };
  }

  async listSandboxes(): Promise<SandboxInfo[]> {
    // Minimal implementation for dev: only list sandboxes created in this process.
    // A fuller implementation would query the provider API (Daytona) for all sandboxes.
    return Array.from(this.activeSandboxes.values()).map((sb) => ({
      sandboxId: sb.id,
      url: "",
      status: "running",
      createdAt: Date.now(),
    }));
  }

  async stopSandbox(sandboxId: string): Promise<void> {
    // Best-effort: if we have a cached instance and it exposes stop, call it.
    for (const [key, sb] of this.activeSandboxes.entries()) {
      if (sb.id !== sandboxId) continue;
      const stop = (sb as any).stop;
      if (typeof stop === "function") await stop.call(sb);
      // Decrement active sandboxes gauge (key format is `${orgId}:${workspaceId}`)
      const orgId = key.split(":")[0] || "unknown";
      activeSandboxes.dec({ org_id: orgId, status: "running" });
      this.activeSandboxes.delete(key);
      return;
    }
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    // Best-effort: if we have a cached instance and it exposes delete, call it.
    for (const [key, sb] of this.activeSandboxes.entries()) {
      if (sb.id !== sandboxId) continue;
      const del = (sb as any).delete;
      if (typeof del === "function") await del.call(sb);
      // Decrement active sandboxes gauge (key format is `${orgId}:${workspaceId}`)
      const orgId = key.split(":")[0] || "unknown";
      activeSandboxes.dec({ org_id: orgId, status: "running" });
      this.activeSandboxes.delete(key);
      return;
    }
  }

  // Helper to access Daytona functionality exposed via `getSandboxInstance`
  // This allows the relay to work
  getSandbox(orgId: string, workspaceId: string): CloudSandbox {
    return this.getSandboxInstance(orgId, workspaceId);
  }

  getSandboxById(sandboxId: string): CloudSandbox | undefined {
    for (const sb of this.activeSandboxes.values()) {
      if (sb.id === sandboxId) return sb;
    }
    return undefined;
  }

  /**
   * Sync a provider credential to all active sandboxes for an organization.
   * This injects the credential via the OpenCode /auth/:provider endpoint.
   */
  async syncCredentialToSandboxes(organizationId: string, providerID: string, apiKey: string): Promise<void> {
    const opencodePort = Number.parseInt(process.env.OPENCODE_PORT || "4096", 10);

    for (const [key, sandbox] of this.activeSandboxes.entries()) {
      // Key format is `${orgId}:${workspaceId}`
      if (!key.startsWith(`${organizationId}:`)) continue;

      const injectCredential = (sandbox as any).injectCredential;
      if (typeof injectCredential !== "function") continue;

      try {
        const success = await injectCredential.call(sandbox, opencodePort, providerID, apiKey);
        console.log(`[Orchestrator] Synced ${providerID} credential to sandbox ${sandbox.id}: ${success ? "ok" : "failed"}`);
      } catch (err: any) {
        console.warn(`[Orchestrator] Failed to sync ${providerID} to sandbox ${sandbox.id}: ${err?.message || String(err)}`);
      }
    }
  }
}

// Singleton Management
let orchestratorInstance: SandboxOrchestrator | null = null;

export function getOrchestrator(): SandboxOrchestrator {
  if (!orchestratorInstance) throw new Error("Orchestrator not initialized");
  return orchestratorInstance;
}

export function initOrchestrator(config: SandboxConfig): SandboxOrchestrator {
  orchestratorInstance = new SandboxOrchestrator(config);
  return orchestratorInstance;
}
