import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";

const encoder = new TextEncoder();

async function sign(payload: string, secret: string) {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
	return `${payload}.${btoa(String.fromCharCode(...new Uint8Array(sig)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")}`;
}

async function verify(token: string, secret: string) {
	const idx = token.lastIndexOf(".");
	if (idx === -1) return null;
	const payload = token.slice(0, idx);
	const expected = await sign(payload, secret);
	if (expected !== token) return null;
	return payload;
}

async function createSessionCookie(username: string, secret: string) {
	const payload = JSON.stringify({
		sub: username,
		iat: Math.floor(Date.now() / 1000),
	});
	return sign(payload, secret);
}

async function verifySessionCookie(
	token: string,
	secret: string,
	maxAge = 86400,
) {
	const payload = await verify(token, secret);
	if (!payload) return null;
	const data = JSON.parse(payload) as { sub: string; iat: number };
	if (Math.floor(Date.now() / 1000) > data.iat + maxAge) return null;
	return data.sub;
}

function dualAuth(username: string, password: string) {
	return async (c: Context, next: Next) => {
		if (c.req.method === "OPTIONS") return next();

		const cookie = getCookie(c, "opencode_session");
		if (cookie) {
			const secret = password;
			const sub = await verifySessionCookie(cookie, secret);
			if (sub) {
				c.set("user", sub);
				return next();
			}
		}

		const auth = c.req.header("Authorization");
		if (auth?.startsWith("Basic ")) {
			const decoded = atob(auth.slice(6));
			const colon = decoded.indexOf(":");
			if (colon !== -1) {
				const user = decoded.slice(0, colon);
				const pass = decoded.slice(colon + 1);
				if (user === username && pass === password) return next();
			}
		}

		const accept = c.req.header("Accept") ?? "";
		if (accept.includes("text/html") && !accept.includes("application/json"))
			return c.redirect("/login", 302);

		return c.json({ error: "Unauthorized" }, 401);
	};
}

export { sign, verify, createSessionCookie, verifySessionCookie, dualAuth };
