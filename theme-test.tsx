import React, { useState, useEffect, useCallback, useMemo } from "react"
import { ComponentType, FC, ReactNode, JSX } from "react"

// Interface definitions
interface User {
  id: number
  name: string
  email?: string
  readonly createdAt: Date
  active: boolean
}

type Theme = "light" | "dark" | "auto"
type Status = "pending" | "loading" | "success" | "error"

// Generic function with constraints
function createRepository<T extends { id: number }>(items: T[]): Repository<T> {
  return new Repository(items)
}

// Class definition
class Repository<T> {
  private items: T[]
  protected cache: Map<string, T>

  constructor(items: T[] = []) {
    this.items = items
    this.cache = new Map()
  }

  public find(id: number): T | undefined {
    const x = undefined
    type x = { foo: undefined }
    return this.items.find((item) => item.id === id)
  }

  public async findAll(): Promise<T[]> {
    return this.items
  }

  get count(): number {
    return this.items.length
  }
}

// Enum definition
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// Constants
const API_URL = "https://api.example.com"
const MAX_RETRIES = 3
const DEFAULT_TIMEOUT = 5000

// Regular expressions
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
const PHONE_REGEX = /^\+?1?-?\.?\s?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})$/

// Template literals
const greeting = `Hello, ${user.name}!`
const sql = `
  SELECT * FROM users 
  WHERE active = true 
  AND created_at > '${new Date().toISOString()}'
`

// String source examples (CSS-in-JS, GraphQL, etc.)
const styledComponent = css`
  .container {
    display: flex;
    justify-content: center;
    align-items: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 2rem;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 12px rgba(0, 0, 0, 0.15);
    }

    .title {
      font-size: 1.5rem;
      font-weight: bold;
      color: white;
      margin-bottom: 1rem;
    }
  }
`

const graphqlQuery = `
  query GetUserProfile($userId: ID!) {
    user(id: $userId) {
      id
      name
      email
      avatar
      createdAt
      posts {
        id
        title
        content
        publishedAt
        comments {
          id
          author
          content
          createdAt
        }
      }
    }
  }
`

const htmlTemplate = `
  <div class="user-card">
    <img src="${user.avatar}" alt="${user.name}" class="avatar" />
    <div class="user-info">
      <h3>${user.name}</h3>
      <p>${user.email}</p>
      <span class="status ${user.active ? "active" : "inactive"}">
        ${user.active ? "Active" : "Inactive"}
      </span>
    </div>
    <div class="actions">
      <button onclick="editUser(${user.id})">Edit</button>
      <button onclick="deleteUser(${user.id})" class="danger">Delete</button>
    </div>
  </div>
`

// Arrow functions
const debounce = <T extends (...args: any[]) => any>(func: T, wait: number): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout
  return (...args: Parameters<T>) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

// Async function
async function fetchUserData(userId: number): Promise<User> {
  try {
    const response = await fetch(`${API_URL}/users/${userId}`)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    console.error("Failed to fetch user data:", error)
    throw error
  }
}

// React component with various patterns
const ThemeProvider: FC<{ children: ReactNode; theme?: Theme }> = ({ children, theme = "auto" }) => {
  const [currentTheme, setCurrentTheme] = useState<Theme>(theme)
  const [status, setStatus] = useState<Status>("pending")

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = (e: MediaQueryListEvent) => {
      setCurrentTheme(e.matches ? "dark" : "light")
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [])

  const contextValue = useMemo(
    () => ({
      theme: currentTheme,
      setTheme: setCurrentTheme,
      toggleTheme: () => setCurrentTheme((prev) => (prev === "light" ? "dark" : "light")),
    }),
    [currentTheme],
  )

  return (
    <ThemeContext.Provider value={contextValue}>
      <div className={`theme-${currentTheme}`} data-theme={currentTheme}>
        {children}
      </div>
    </ThemeContext.Provider>
  )
}

// Higher-order component
function withLogging<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  return function LoggedComponent(props: P) {
    console.log("Rendering component:", Component.name)
    return <Component {...props} />
  }
}

// Custom hook
function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error)
      return initialValue
    }
  })

  const setValue = useCallback(
    (value: T) => {
      try {
        setStoredValue(value)
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error)
      }
    },
    [key],
  )

  return [storedValue, setValue]
}

// JSX component with various elements
const UserProfile: FC<{ user: User; onUpdate?: (user: User) => void }> = ({ user, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState(user)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validation
    if (!formData.name.trim()) {
      setErrors({ name: "Name is required" })
      return
    }

    if (formData.email && !EMAIL_REGEX.test(formData.email)) {
      setErrors({ email: "Invalid email format" })
      return
    }

    try {
      setStatus("loading")
      await onUpdate?.(formData)
      setStatus("success")
      setIsEditing(false)
    } catch (error) {
      setStatus("error")
      setErrors({ submit: "Failed to update profile" })
    }
  }

  return (
    <div className="user-profile">
      <div className="user-header">
        <h2>{user.name}</h2>
        <span className={`status status-${user.active ? "active" : "inactive"}`}>
          {user.active ? "Active" : "Inactive"}
        </span>
      </div>

      {isEditing ? (
        <form onSubmit={handleSubmit} className="user-form">
          <div className="form-group">
            <label htmlFor="name">Name:</label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={errors.name ? "error" : ""}
              placeholder="Enter your name"
              required
            />
            {errors.name && <span className="error-message">{errors.name}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="email">Email:</label>
            <input
              id="email"
              type="email"
              value={formData.email || ""}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className={errors.email ? "error" : ""}
              placeholder="user@example.com"
            />
            {errors.email && <span className="error-message">{errors.email}</span>}
          </div>

          <div className="form-actions">
            <button type="submit" disabled={status === "loading"}>
              {status === "loading" ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={() => setIsEditing(false)} className="secondary">
              Cancel
            </button>
          </div>

          {errors.submit && <div className="alert alert-error">{errors.submit}</div>}
        </form>
      ) : (
        <div className="user-details">
          <p>
            <strong>ID:</strong> {user.id}
          </p>
          <p>
            <strong>Email:</strong> {user.email || "Not provided"}
          </p>
          <p>
            <strong>Member since:</strong> {user.createdAt.toLocaleDateString()}
          </p>

          <button onClick={() => setIsEditing(true)} className="edit-button">
            Edit Profile
          </button>
        </div>
      )}
    </div>
  )
}

// Export statements
export {
  User,
  Theme,
  Status,
  LogLevel,
  Repository,
  ThemeProvider,
  UserProfile,
  fetchUserData,
  useLocalStorage,
  withLogging,
  debounce,
}

export default ThemeProvider

// Type exports
export type { User as UserType, ComponentType as ReactComponentType }
