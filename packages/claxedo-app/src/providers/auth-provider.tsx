import { ParentProps, createContext, useContext, createMemo } from "solid-js";
import { useAuth } from "../utils/auth-client";

/**
 * Auth context value type
 */
export interface AuthContextValue {
  /** Reactive session accessor */
  session: () => any;
  /** Reactive user accessor */
  user: () => any;
  /** Loading state accessor */
  loading: () => boolean;
  /** Whether user is authenticated */
  isAuthenticated: () => boolean;
  /** Sign in method */
  signIn: (options?: { redirectUrl?: string }) => Promise<void>;
  /** Sign out method */
  signOut: () => Promise<void>;
  /** Sign up method */
  signUp: (options?: { redirectUrl?: string }) => Promise<void>;
  /** Get auth token for API calls */
  getToken: () => Promise<string | null>;
  /** Refresh session */
  refreshSession: () => Promise<void>;
  /** Organization (Clerk orgs) */
  organization: any;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * AuthProvider wraps the app with Clerk authentication context.
 * Provides reactive auth state and methods to all child components.
 */
export function AuthProvider(props: ParentProps) {
  const auth = useAuth();

  const isAuthenticated = createMemo(() => auth.isSignedIn());
  const user = createMemo(() => auth.user());

  const value: AuthContextValue = {
    session: auth.session,
    user,
    loading: auth.loading,
    isAuthenticated,
    signIn: auth.signIn,
    signOut: auth.signOut,
    signUp: auth.signUp,
    getToken: auth.getToken,
    refreshSession: auth.refreshSession,
    organization: auth.organization,
  };

  return (
    <AuthContext.Provider value={value}>
      {props.children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context.
 * Must be used within an AuthProvider.
 */
export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
