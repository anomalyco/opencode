import { WorkOS, type User } from "@workos-inc/node";

export const WORKOS_SESSION_COOKIE_NAME = "wos-session";

export interface WorkosClientConfig {
	apiKey: string;
	clientId: string;
}

export interface ValidateWorkosSessionInput {
	workos: WorkOS;
	sessionData: string;
	cookiePassword: string;
}

export type ValidateWorkosSessionResult =
	| {
			ok: true;
			user: User;
			refreshedSessionData?: string;
	  }
	| {
			ok: false;
			reason: string;
	  };

export function requireNonEmpty(value: string | undefined, name: string): string {
	const trimmed = value?.trim();
	if (!trimmed) {
		throw new Error(`${name} is missing`);
	}
	return trimmed;
}

export function requireCookiePassword(value: string | undefined): string {
	const password = requireNonEmpty(value, "COOKIE_PASSWORD");
	if (password.length < 32) {
		throw new Error("COOKIE_PASSWORD must be at least 32 characters");
	}
	return password;
}

export function createWorkOSClient(config: WorkosClientConfig): WorkOS {
	return new WorkOS(config.apiKey, { clientId: config.clientId });
}

export async function validateWorkosSession(input: ValidateWorkosSessionInput): Promise<ValidateWorkosSessionResult> {
	const { workos, sessionData, cookiePassword } = input;

	const session = await workos.userManagement.loadSealedSession({
		sessionData,
		cookiePassword,
	});
	const auth = await session.authenticate();
	if (auth.authenticated && auth.user) {
		return { ok: true, user: auth.user };
	}

	if ("reason" in auth && (auth.reason === "invalid_jwt" || auth.reason === "invalid_session_cookie")) {
		const refresh = await session.refresh();
		if (refresh.authenticated && refresh.user) {
			return {
				ok: true,
				user: refresh.user,
				refreshedSessionData: refresh.sealedSession ?? undefined,
			};
		}
	}

	return { ok: false, reason: "Invalid WorkOS session" };
}
