import type { Context, MiddlewareHandler } from "hono"
import { getCookie, setCookie } from "hono/cookie"
import { basicAuth } from "hono/basic-auth"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"

/**
 * AIDEV-NOTE: JupyterHub singleuser 서버용 OAuth2 Authorization Code 흐름의 TypeScript 구현.
 *
 * jupyterhub 5.4.3의 Python 구현을 참고하여 Hono 미들웨어로 포팅했다.
 * - HubOAuth (authorize URL 생성, code->token 교환):
 *   https://github.com/jupyterhub/jupyterhub/blob/652390e/jupyterhub/services/auth.py#L874-L1112
 * - HubAuthenticated (요청에서 사용자 식별, 미인증 시 OAuth 리다이렉트):
 *   https://github.com/jupyterhub/jupyterhub/blob/652390e/jupyterhub/services/auth.py#L1298-L1538
 * - HubOAuthCallbackHandler (state 검증, code 교환, 세션 쿠키 발급):
 *   https://github.com/jupyterhub/jupyterhub/blob/652390e/jupyterhub/services/auth.py#L1547-L1618
 * - Spawner.get_env (singleuser pod에 주입되는 환경변수 목록):
 *   https://github.com/jupyterhub/jupyterhub/blob/652390e/jupyterhub/spawner.py#L1244-L1387
 *
 * 요청 흐름: 브라우저 -> CHP(/user/<name>/) -> pod:8888(opencode web)
 * CHP는 인증 없이 라우팅만 수행하므로, 이 미들웨어에서 Hub OAuth로 사용자를 검증한다.
 */
export namespace HubAuth {
  const log = Log.create({ service: "hub-auth" })

  const COOKIE = "opencode-hub-session"
  const STATE_COOKIE = "opencode-hub-state"
  // AIDEV-NOTE: JupyterHub Python 원본의 cookie_cache_max_age (기본 300초)와 동일.
  // 캐시 만료 시 전체 OAuth 재인증이 아니라 Hub API에 토큰 재검증만 수행한다.
  // https://github.com/jupyterhub/jupyterhub/blob/652390e/jupyterhub/services/auth.py#L430-L441
  const CACHE_TTL = 5 * 60 * 1000
  const COOKIE_MAX_AGE = 24 * 60 * 60

  interface Session {
    user: string
    token: string
    cachedAt: number
  }

  // AIDEV-NOTE: in-memory 세션 캐시. pod 재시작 시 초기화되며, Hub OAuth 재인증이 발생한다.
  const sessions = new Map<string, Session>()

  export function enabled(): boolean {
    return !!(Flag.JUPYTERHUB_API_URL && Flag.JUPYTERHUB_API_TOKEN && Flag.JUPYTERHUB_USER)
  }

  function api(path: string): string {
    return `${Flag.JUPYTERHUB_API_URL!.replace(/\/+$/, "")}${path}`
  }

  // AIDEV-NOTE: Python 원본의 _oauth_states dict와 동일한 server-side state 저장.
  // state ID만 Hub에 전달하고, CSRF 토큰과 next URL은 서버에 보관한다.
  // https://github.com/jupyterhub/jupyterhub/blob/652390e/jupyterhub/services/auth.py#L1547-L1618
  const oauthStates = new Map<string, { csrf: string; next: string }>()

  // AIDEV-NOTE: HubOAuth.login_url 참고. scope는 전달하지 않는다 -- Hub이 client 등록 시점에 이미 보유.
  // https://github.com/jupyterhub/jupyterhub/blob/652390e/jupyterhub/services/auth.py#L878-L887
  function authorizeUrl(callback: string, state: string): string {
    const base = Flag.JUPYTERHUB_BASE_URL?.replace(/\/+$/, "") ?? ""
    const params = new URLSearchParams({
      client_id: Flag.JUPYTERHUB_CLIENT_ID ?? "",
      redirect_uri: callback,
      response_type: "code",
      state,
    })
    return `${base}/hub/api/oauth2/authorize?${params}`
  }

  // AIDEV-NOTE: HubOAuth._token_for_code 참고. form-encoded body로 client_id, client_secret 포함.
  // _api_request가 Authorization 헤더도 자동 추가하므로 동일하게 구현.
  // https://github.com/jupyterhub/jupyterhub/blob/652390e/jupyterhub/services/auth.py#L1078-L1112
  async function exchange(code: string, callback: string): Promise<string | undefined> {
    try {
      const res = await fetch(api("/oauth2/token"), {
        method: "POST",
        headers: {
          "Authorization": `token ${Flag.JUPYTERHUB_API_TOKEN}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: Flag.JUPYTERHUB_CLIENT_ID ?? "",
          client_secret: Flag.JUPYTERHUB_API_TOKEN ?? "",
          grant_type: "authorization_code",
          code,
          redirect_uri: callback,
        }),
      })
      if (!res.ok) {
        log.warn("token exchange failed", { status: res.status })
        return undefined
      }
      return ((await res.json()) as { access_token?: string }).access_token
    } catch (err) {
      log.error("token exchange error", { error: err })
      return undefined
    }
  }

  // AIDEV-NOTE: HubAuth.user_for_token 참고. access token으로 Hub API에서 사용자 정보 조회.
  // https://github.com/jupyterhub/jupyterhub/blob/652390e/jupyterhub/services/auth.py#L686-L722
  async function userinfo(token: string): Promise<string | undefined> {
    try {
      const res = await fetch(api("/user"), {
        headers: { Authorization: `token ${token}` },
      })
      if (!res.ok) {
        log.warn("userinfo failed", { status: res.status })
        return undefined
      }
      return ((await res.json()) as { name?: string }).name
    } catch (err) {
      log.error("userinfo error", { error: err })
      return undefined
    }
  }

  function callbackPath(): string {
    const prefix = Flag.JUPYTERHUB_SERVICE_PREFIX?.replace(/\/+$/, "") ?? ""
    return `${prefix}/oauth_callback`
  }

  // AIDEV-NOTE: JUPYTERHUB_OAUTH_CALLBACK_URL은 KubeSpawner가 /user/<name>/oauth_callback 형태로 주입한다.
  // CHP가 /user/<name>/ -> pod:8888로 라우팅하므로 이 URL이 그대로 opencode web에 도달한다.
  function buildCallbackUrl(c: Context): string {
    if (Flag.JUPYTERHUB_OAUTH_CALLBACK_URL) return Flag.JUPYTERHUB_OAUTH_CALLBACK_URL
    const proto = c.req.header("x-forwarded-proto") ?? "http"
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "localhost"
    return `${proto}://${host}${callbackPath()}`
  }

  function tryTokenAuth(c: Context, username: string, password: string): boolean {
    const token = c.req.query("token")
    if (!token) return false
    const raw = Buffer.from(token, "base64").toString()
    const i = raw.indexOf(":")
    return i !== -1 && raw.slice(0, i) === username && raw.slice(i + 1) === password
  }

  // AIDEV-NOTE: HubOAuthCallbackHandler.get 참고. state 검증 -> code 교환 -> userinfo -> 소유자 비교 -> 세션 쿠키 발급.
  // https://github.com/jupyterhub/jupyterhub/blob/652390e/jupyterhub/services/auth.py#L1547-L1618
  export async function callback(c: Context): Promise<Response> {
    const code = c.req.query("code")
    const stateId = c.req.query("state")
    const csrf = getCookie(c, STATE_COOKIE)

    if (!code || !stateId || !csrf) {
      log.warn("invalid oauth callback", { has_code: !!code, has_state: !!stateId, has_csrf: !!csrf })
      return c.text("Bad request", 400)
    }

    const state = oauthStates.get(stateId)
    if (!state || state.csrf !== csrf) {
      log.warn("state mismatch", { valid: !!state, csrf_match: state?.csrf === csrf })
      return c.text("Bad request", 400)
    }

    oauthStates.delete(stateId)
    setCookie(c, STATE_COOKIE, "", { path: "/", maxAge: 0 })

    const token = await exchange(code, buildCallbackUrl(c))
    if (!token) return c.text("Token exchange failed", 502)

    const name = await userinfo(token)
    if (!name) return c.text("Failed to identify user", 502)

    if (name !== Flag.JUPYTERHUB_USER) {
      log.warn("access denied", { requesting_user: name, owner: Flag.JUPYTERHUB_USER })
      return c.text("Forbidden", 403)
    }

    const sid = crypto.randomUUID()
    sessions.set(sid, { user: name, token, cachedAt: Date.now() })
    setCookie(c, COOKIE, sid, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: c.req.url.startsWith("https"),
      maxAge: COOKIE_MAX_AGE,
    })

    // AIDEV-NOTE: next URL은 state 파라미터에서 디코딩. 상대 경로만 허용하여 open redirect 방지.
    const next = state.next.startsWith("/") ? state.next : "/"
    return c.redirect(next)
  }

  /**
   * AIDEV-NOTE: Hub OAuth와 Basic Auth를 모두 처리하는 통합 인증 미들웨어.
   *
   * Hub 배포 환경 (JUPYTERHUB_API_URL 존재):
   *   - 유효한 세션 쿠키 -> 통과
   *   - Basic Auth 헤더 또는 ?token -> 기존 Basic Auth로 검증
   *   - 둘 다 없음 -> Hub OAuth 리다이렉트 (브라우저 요청)
   *
   * 독립 실행 환경 (JUPYTERHUB_API_URL 미존재):
   *   - OPENCODE_SERVER_PASSWORD 설정됨 -> Basic Auth 검증
   *   - 미설정 -> 인증 없이 통과
   */
  export function auth(): MiddlewareHandler {
    return async (c, next) => {
      if (c.req.method === "OPTIONS") return next()
      if (c.req.path === "/oauth_callback") return next()

      const password = Flag.OPENCODE_SERVER_PASSWORD
      const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"

      // --- Hub OAuth 모드 ---
      if (enabled()) {
        // 1. 세션 쿠키 확인 (캐시 만료 시 Hub API로 토큰 재검증)
        const sid = getCookie(c, COOKIE)
        if (sid) {
          const session = sessions.get(sid)
          if (session) {
            if (Date.now() - session.cachedAt < CACHE_TTL) {
              return next()
            }
            // AIDEV-NOTE: 캐시 만료. Hub API에 토큰 유효성만 재확인한다.
            // Python 원본의 _check_hub_user -> user_for_token 호출과 동일한 패턴.
            const name = await userinfo(session.token)
            if (name === Flag.JUPYTERHUB_USER) {
              sessions.set(sid, { ...session, cachedAt: Date.now() })
              return next()
            }
            log.warn("session revalidation failed", { cached_user: session.user, resolved_user: name })
            sessions.delete(sid)
          }
        }

        // 2. Basic Auth 자격 증명이 있으면 Basic Auth로 처리 (CLI/SDK 요청)
        if (password && tryTokenAuth(c, username, password)) return next()
        if (password) {
          const header = c.req.header("authorization")
          if (header?.startsWith("Basic ")) {
            return basicAuth({ username, password })(c, next)
          }
        }

        // 3. 브라우저 요청 -> Hub OAuth 리다이렉트
        const csrf = crypto.randomUUID()
        const stateId = crypto.randomUUID()
        // AIDEV-NOTE: server.handleRequest 가 basePath 를 strip 한 후의 path 가 c.req.path 이다.
        // 그대로 next 로 저장해 callback 후 c.redirect(next) 하면 prefix 가 빠진 절대 경로로
        // 가서 hub 가 unknown path 로 처리해 404 가 난다. JUPYTERHUB_SERVICE_PREFIX 를 다시
        // prefix 해 hub 가 user-server 로 라우팅할 수 있는 절대 경로로 저장한다.
        const servicePrefix = Flag.JUPYTERHUB_SERVICE_PREFIX?.replace(/\/+$/, "") ?? ""
        oauthStates.set(stateId, { csrf, next: `${servicePrefix}${c.req.path}` })
        setCookie(c, STATE_COOKIE, csrf, {
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
          secure: c.req.url.startsWith("https"),
          maxAge: 300,
        })
        return c.redirect(authorizeUrl(buildCallbackUrl(c), stateId))
      }

      // --- Basic Auth 전용 모드 (Hub 없음) ---
      if (!password) return next()
      if (tryTokenAuth(c, username, password)) return next()
      return basicAuth({ username, password })(c, next)
    }
  }
}
