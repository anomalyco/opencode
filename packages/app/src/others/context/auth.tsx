import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { createEffect, createMemo, onMount } from "solid-js"
import type { ServerConnection } from "@/context/server"

/**
 * 用户信息
 */
export interface User {
  username: string
  role: string
  enabled: boolean
  space_path: string
  permissions: string[]
  workspace?: string
}

/**
 * 认证状态
 */
export interface AuthState {
  isLoading: boolean
  isAuthenticated: boolean
  user: User | null
  token: string | null
  error: string | null
}

const TOKEN_STORAGE_KEY = "opencode.auth.token"
const USER_STORAGE_KEY = "opencode.auth.user"

function getStorage(key: string): string | null {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function setStorage(key: string, value: string | null): void {
  if (typeof localStorage === "undefined") return
  try {
    if (value !== null) {
      localStorage.setItem(key, value)
    } else {
      localStorage.removeItem(key)
    }
  } catch {}
}

export const { use: useAuth, provider: AuthProvider } = createSimpleContext({
  name: "Auth",
  init: (props: { serverUrl: string }) => {
    const [state, setState] = createStore<AuthState>({
      isLoading: true,
      isAuthenticated: false,
      user: null,
      token: null,
      error: null,
    })

    // 从 localStorage 恢复 token
    const restoreSession = () => {
      const savedToken = getStorage(TOKEN_STORAGE_KEY)
      const savedUser = getStorage(USER_STORAGE_KEY)

      if (savedToken && savedUser) {
        try {
          const user = JSON.parse(savedUser) as User
          setState({
            token: savedToken,
            user,
            isAuthenticated: true,
            isLoading: false,
          })
        } catch {
          setStorage(TOKEN_STORAGE_KEY, null)
          setStorage(USER_STORAGE_KEY, null)
          setState({ isLoading: false })
        }
      } else {
        setState({ isLoading: false })
      }
    }

    // 验证 token 是否仍然有效
    const verifyToken = async (token: string): Promise<User | null> => {
      try {
        const response = await fetch(`${props.serverUrl}/others/auth/verify`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (!response.ok) {
          return null
        }

        const data = await response.json()
        if (data.valid && data.user) {
          return data.user as User
        }
        return null
      } catch {
        return null
      }
    }

    // 初始化时验证 token
    onMount(async () => {
      restoreSession()

      if (state.token) {
        const user = await verifyToken(state.token)
        if (user) {
          setState({
            user,
            isAuthenticated: true,
            isLoading: false,
          })
          setStorage(USER_STORAGE_KEY, JSON.stringify(user))
        } else {
          // Token 无效，清除
          logout()
        }
      } else {
        setState({ isLoading: false })
      }
    })

    // 登录
    const login = async (username: string, password: string): Promise<boolean> => {
      setState({ isLoading: true, error: null })

      try {
        const response = await fetch(`${props.serverUrl}/others/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ username, password }),
        })

        const data = await response.json()

        if (!response.ok || !data.success) {
          setState({
            isLoading: false,
            error: data.message || "Login failed",
          })
          return false
        }

        const user: User = {
          username: data.user.username,
          role: data.user.role,
          enabled: data.user.enabled,
          space_path: data.user.space_path,
          permissions: data.user.permissions,
          workspace: data.user.workspace,
        }

        setState({
          isLoading: false,
          isAuthenticated: true,
          token: data.token,
          user,
          error: null,
        })

        // 保存到 localStorage
        setStorage(TOKEN_STORAGE_KEY, data.token)
        setStorage(USER_STORAGE_KEY, JSON.stringify(user))

        return true
      } catch (error) {
        setState({
          isLoading: false,
          error: error instanceof Error ? error.message : "Network error",
        })
        return false
      }
    }

    // 登出
    const logout = () => {
      setState({
        isAuthenticated: false,
        token: null,
        user: null,
        error: null,
      })
      setStorage(TOKEN_STORAGE_KEY, null)
      setStorage(USER_STORAGE_KEY, null)
    }

    // 检查权限
    const hasPermission = (permission: string): boolean => {
      if (!state.user) return false
      return state.user.permissions.includes(permission) || state.user.permissions.includes("admin")
    }

    // 获取带认证的 headers
    const getAuthHeaders = (): Record<string, string> => {
      if (!state.token) return {}
      return {
        Authorization: `Bearer ${state.token}`,
      }
    }

    return {
      get isLoading() {
        return state.isLoading
      },
      get isAuthenticated() {
        return state.isAuthenticated
      },
      get user() {
        return state.user
      },
      get token() {
        return state.token
      },
      get error() {
        return state.error
      },
      login,
      logout,
      hasPermission,
      getAuthHeaders,
    }
  },
})

/**
 * 创建带认证的 fetch 函数
 */
export function createAuthFetch(auth: ReturnType<typeof useAuth>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers)

    // 添加认证 header
    const authHeaders = auth.getAuthHeaders()
    for (const [key, value] of Object.entries(authHeaders)) {
      headers.set(key, value)
    }

    return fetch(input, {
      ...init,
      headers,
    })
  }
}
