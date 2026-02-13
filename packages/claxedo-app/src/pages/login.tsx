import { createSignal, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { clerk, waitForClerk, useAuth } from "../utils/auth-client";

export interface LoginPageProps {
  /** App branding name (defaults to "Claxedo") */
  appName?: string;
  /** App tagline (defaults to "Cloud-first development environment") */
  tagline?: string;
  /** Success redirect URL (defaults to /) */
  redirectUrl?: string;
  /** Custom terms of service URL */
  termsUrl?: string;
  /** Custom privacy policy URL */
  privacyUrl?: string;
}

/**
 * LoginPage component for Claxedo cloud authentication.
 * Uses Clerk for authentication.
 */
export default function LoginPage(props: LoginPageProps = {}) {
  const navigate = useNavigate();
  const { isSignedIn, loading } = useAuth();
  const [clerkReady, setClerkReady] = createSignal(false);
  let signInDiv: HTMLDivElement | undefined;

  const appName = () => props.appName ?? "Claxedo";
  const tagline = () => props.tagline ?? "Cloud-first development environment";
  const redirectUrl = () => props.redirectUrl ?? "/";

  // Redirect if already signed in
  onMount(async () => {
    await waitForClerk();
    setClerkReady(true);

    if (clerk.user) {
      navigate(redirectUrl(), { replace: true });
      return;
    }

    // Mount Clerk sign-in component
    if (signInDiv) {
      clerk.mountSignIn(signInDiv, {
        signUpUrl: "/login", // Same page for sign up
        afterSignInUrl: redirectUrl(),
        afterSignUpUrl: redirectUrl(),
        appearance: {
          variables: {
            colorPrimary: "#6366f1",
            colorBackground: "#171717",
            colorText: "#ffffff",
            colorTextSecondary: "#a3a3a3",
            colorInputBackground: "#262626",
            colorInputText: "#ffffff",
            borderRadius: "0.75rem",
          },
          elements: {
            rootBox: { width: "100%" },
            card: {
              backgroundColor: "#171717",
              border: "1px solid #262626",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
            },
            headerTitle: { color: "#ffffff" },
            headerSubtitle: { color: "#a3a3a3" },
            socialButtonsBlockButton: {
              backgroundColor: "#ffffff",
              border: "1px solid #d4d4d4",
              color: "#171717",
            },
            socialButtonsBlockButtonText: {
              color: "#171717",
              fontWeight: "500",
            },
            socialButtonsBlockButtonArrow: { color: "#525252" },
            dividerLine: { backgroundColor: "#404040" },
            dividerText: { color: "#737373" },
            formFieldLabel: { color: "#d4d4d4" },
            formFieldInput: {
              backgroundColor: "#262626",
              border: "1px solid #404040",
              color: "#ffffff",
            },
            formButtonPrimary: {
              backgroundColor: "#4f46e5",
              color: "#ffffff",
            },
            footerActionLink: { color: "#818cf8" },
            identityPreviewText: { color: "#ffffff" },
            identityPreviewEditButton: { color: "#818cf8" },
          },
        },
      });
    }
  });

  // If signed in, redirect
  if (!loading() && isSignedIn()) {
    navigate(redirectUrl(), { replace: true });
    return null;
  }

  return (
    <div class="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-white p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500 mb-2">
            {appName()}
          </h1>
          <p class="text-neutral-400 text-sm">{tagline()}</p>
        </div>

        {/* Fix Clerk social button hover - inline CSS since Tailwind doesn't apply to Clerk components */}
        <style>{`
          .cl-socialButtonsBlockButton:hover {
            background-color: #f5f5f5 !important;
            border-color: #a3a3a3 !important;
          }
          .cl-socialButtonsBlockButton:hover .cl-socialButtonsBlockButtonText {
            color: #171717 !important;
          }
        `}</style>

        <Show
          when={clerkReady()}
          fallback={
            <div class="flex items-center justify-center p-8">
              <span class="animate-spin h-8 w-8 border-2 border-white/20 border-t-white rounded-full" />
            </div>
          }
        >
          {/* Clerk Sign-In component will be mounted here */}
          <div ref={signInDiv} class="clerk-sign-in" />
        </Show>

        <div class="mt-8 text-center text-xs text-neutral-500">
          By continuing, you agree to {appName()}'s{" "}
          <a
            href={props.termsUrl ?? "#"}
            class="text-blue-400 hover:underline"
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href={props.privacyUrl ?? "#"}
            class="text-blue-400 hover:underline"
          >
            Privacy Policy
          </a>
          .
        </div>
      </div>
    </div>
  );
}
