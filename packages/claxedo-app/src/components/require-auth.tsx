import { ParentProps, Show, createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "../utils/auth-client";

export interface RequireAuthProps extends ParentProps {
  /**
   * Whether cloud mode is currently active.
   * If true, authentication is required; if false, children render without auth.
   */
  isCloudMode?: boolean;
  /** Optional fallback component while loading */
  loadingFallback?: any;
  /** Optional redirect path (defaults to /login) */
  loginPath?: string;
}

/**
 * RequireAuth component for cloud mode.
 * Redirects unauthenticated users to the login page when in cloud mode.
 * In local mode, children render without authentication checks.
 */
export function RequireAuth(props: RequireAuthProps) {
  const { user, loading, isSignedIn } = useAuth();
  const navigate = useNavigate();

  const isCloudMode = () => props.isCloudMode ?? true;
  const loginPath = () => props.loginPath ?? "/login";

  createEffect(() => {
    if (!loading() && !isSignedIn() && isCloudMode()) {
      navigate(loginPath());
    }
  });

  const defaultLoading = (
    <div class="size-full flex items-center justify-center">Loading...</div>
  );

  return (
    <Show when={!loading()} fallback={props.loadingFallback ?? defaultLoading}>
      <Show when={!isCloudMode() || isSignedIn()}>
        {props.children}
      </Show>
    </Show>
  );
}
