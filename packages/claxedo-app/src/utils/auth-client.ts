import { createSignal, createEffect, onCleanup } from "solid-js";

/**
 * Clerk client instance for Claxedo cloud mode.
 * Lazily initialized only when auth is enabled.
 */
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

// Lazy Clerk instance - only created when needed
let clerkInstance: any = null;
let clerkLoadPromise: Promise<void> | null = null;
let clerkLoaded = false;

// SolidJS Signals for auth state
const [session, setSession] = createSignal<any>(null);
const [user, setUser] = createSignal<any>(null);
// Start as false - will be set to true only when Clerk initialization starts
const [loading, setLoading] = createSignal(false);

/**
 * Initialize Clerk lazily. Only call this when auth is enabled.
 */
export function initializeClerk(): Promise<void> {
  if (clerkLoadPromise) return clerkLoadPromise;

  if (!clerkPubKey) {
    console.warn("[claxedo] Missing VITE_CLERK_PUBLISHABLE_KEY");
    return Promise.resolve();
  }

  setLoading(true);
  clerkLoadPromise = import("@clerk/clerk-js")
    .then(({ Clerk }) => {
      clerkInstance = new Clerk(clerkPubKey);
      return clerkInstance.load();
    })
    .then(() => {
      clerkLoaded = true;
      setSession(clerkInstance!.session);
      setUser(clerkInstance!.user);
      setLoading(false);

      // Listen for auth state changes
      clerkInstance!.addListener((resources: any) => {
        setSession(resources.session);
        setUser(resources.user);
      });
    });

  return clerkLoadPromise;
}

/**
 * Get the Clerk instance. Returns null if not initialized.
 */
export const clerk = {
  get instance() {
    return clerkInstance;
  },
  get session() {
    return clerkInstance?.session ?? null;
  },
  get user() {
    return clerkInstance?.user ?? null;
  },
  get organization() {
    return clerkInstance?.organization ?? null;
  },
  addListener(callback: (resources: any) => void) {
    return clerkInstance?.addListener(callback) ?? (() => {});
  },
  mountSignIn(node: HTMLDivElement, props?: any) {
    if (!clerkInstance) return;
    clerkInstance.mountSignIn(node, props);
  },
  unmountSignIn(node: HTMLDivElement) {
    if (!clerkInstance) return;
    clerkInstance.unmountSignIn(node);
  },
  openSignIn(options?: any) {
    return clerkInstance?.openSignIn(options);
  },
  openSignUp(options?: any) {
    return clerkInstance?.openSignUp(options);
  },
  async signOut() {
    return clerkInstance?.signOut();
  },
};

/**
 * Wait for Clerk to be fully loaded.
 * Returns immediately if Clerk is not initialized (auth disabled).
 */
export async function waitForClerk(): Promise<void> {
  if (clerkLoadPromise) {
    await clerkLoadPromise;
  }
}

/**
 * Get the current auth token for Convex.
 * Returns null if not authenticated or auth is disabled.
 */
export async function getAuthToken(): Promise<string | null> {
  if (!clerkLoadPromise) return null;
  await clerkLoadPromise;
  if (!clerkInstance?.session) return null;

  // Use default session token which includes organization context (o.id, o.rol, o.slg)
  const token = await clerkInstance.session.getToken();
  return token;
}

/**
 * Auth hook for SolidJS components.
 * Provides reactive session state and auth methods.
 * Works safely even when auth is disabled (returns no-op functions).
 */
export function useAuth() {
  const clear = () => {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (!key.startsWith("opencode.")) continue;
      localStorage.removeItem(key);
    }
  };

  return {
    /** Clerk instance */
    clerk,
    /** Reactive session accessor */
    session,
    /** Reactive user accessor */
    user,
    /** Loading state accessor */
    loading,
    /** Whether user is authenticated */
    isSignedIn: () => !!user(),
    /** Sign in - opens Clerk sign-in UI */
    signIn: async (options?: { redirectUrl?: string }) => {
      if (!clerkLoadPromise) return;
      await clerkLoadPromise;
      clerk.openSignIn({
        redirectUrl: options?.redirectUrl ?? window.location.origin,
      });
    },
    /** Sign out and clear session */
    signOut: async () => {
      if (!clerkLoadPromise) return;
      await clerkLoadPromise;
      await clerk.signOut();
      setSession(null);
      setUser(null);
      clear();
      window.location.assign("/login");
    },
    /** Sign up - opens Clerk sign-up UI */
    signUp: async (options?: { redirectUrl?: string }) => {
      if (!clerkLoadPromise) return;
      await clerkLoadPromise;
      clerk.openSignUp({
        redirectUrl: options?.redirectUrl ?? window.location.origin,
      });
    },
    /** Get auth token for Convex */
    getToken: getAuthToken,
    /** Refresh session */
    refreshSession: async () => {
      if (!clerkLoadPromise) return;
      await clerkLoadPromise;
      setSession(clerk.session);
      setUser(clerk.user);
    },
    /** Organization management (Clerk orgs) */
    organization: clerk.organization,
  };
}

/**
 * Hook to get Clerk token for Convex provider.
 * Used by ConvexProviderWithClerk equivalent.
 */
export function useClerkConvexToken() {
  const [token, setToken] = createSignal<string | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);

  createEffect(() => {
    let mounted = true;

    const updateToken = async () => {
      const newToken = await getAuthToken();
      if (mounted) {
        setToken(newToken);
        setIsLoading(false);
      }
    };

    // Initial token fetch
    updateToken();

    // Re-fetch token when session changes
    const unsubscribe = clerk.addListener(() => {
      updateToken();
    });

    onCleanup(() => {
      mounted = false;
      unsubscribe();
    });
  });

  return { token, isLoading };
}

// Re-export for convenience
export { clerk as authClient };
