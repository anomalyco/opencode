import { randomUUID } from "node:crypto"
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs"
import { dirname, join } from "node:path"

import type { ProfileStorage } from "./app-dock"
import type { AppDockManifest, AppDockManifestUpdate } from "../preload/types"

type ProfileStatus = "active" | "deleting" | "deleted"
type Profile = Readonly<{ storageKey: string; status: ProfileStatus }>
type Registry = { version: 1; revision: number; profiles: Record<string, Profile> }

const maxProfiles = 32
const maxTabs = 50
const maxBookmarks = 200
const maxHistory = 1000
const maxURLLength = 2048
const maxNameLength = 128

const profileID = (value: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(value)) throw new Error("Invalid App Dock profile ID")
  return value
}

const registryError = () => new Error("Invalid App Dock profile registry")
const manifestError = () => new Error("Invalid App Dock manifest")

const writeJSON = (path: string, value: unknown) => {
  const directory = dirname(path)
  const temporary = `${path}.${randomUUID()}.tmp`
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, "wx", 0o600)
    writeSync(descriptor, JSON.stringify(value))
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, path)
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    try {
      unlinkSync(temporary)
    } catch {}
    throw error
  }
}

const validName = (value: unknown) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxNameLength &&
  value.trim() === value &&
  !/[\0-\x1f\x7f]/.test(value)

const manifestName = (value: unknown): string => {
  if (!validName(value)) throw manifestError()
  return value as string
}

const manifestURL = (value: unknown) => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxURLLength ||
    value.trim() !== value ||
    /[\0-\x1f\x7f]/.test(value)
  )
    throw manifestError()
  try {
    if (new URL(value).protocol !== "https:") throw manifestError()
  } catch {
    throw manifestError()
  }
  return value
}

const parseManifest = (value: unknown): AppDockManifest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw manifestError()
  const manifest = value as Record<string, unknown>
  if (
    Object.keys(manifest).length !== 7 ||
    manifest.version !== 1 ||
    !Number.isSafeInteger(manifest.revision) ||
    (manifest.revision as number) < 0 ||
    !Array.isArray(manifest.profiles) ||
    typeof manifest.activeProfileID !== "string" ||
    !manifest.tabs ||
    typeof manifest.tabs !== "object" ||
    Array.isArray(manifest.tabs) ||
    !Array.isArray(manifest.bookmarks) ||
    !Array.isArray(manifest.history)
  ) {
    throw manifestError()
  }
  if (
    manifest.profiles.length > maxProfiles ||
    manifest.bookmarks.length > maxBookmarks ||
    manifest.history.length > maxHistory
  ) {
    throw manifestError()
  }
  const profiles = manifest.profiles.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw manifestError()
    const profile = value as Record<string, unknown>
    if (Object.keys(profile).length !== 2 || !Object.hasOwn(profile, "id") || !Object.hasOwn(profile, "name"))
      throw manifestError()
    return { id: profileID(profile.id as string), name: manifestName(profile.name) }
  })
  const ids = new Set(profiles.map((profile) => profile.id))
  if (
    ids.size !== profiles.length ||
    (profiles.length === 0 ? manifest.activeProfileID !== "" : !ids.has(manifest.activeProfileID))
  )
    throw manifestError()
  const tabs = manifest.tabs as Record<string, unknown>
  if (Object.keys(tabs).length !== ids.size || Object.keys(tabs).some((id) => !ids.has(id))) throw manifestError()
  const parsedTabs = Object.fromEntries(
    Object.entries(tabs).map(([id, value]) => {
      if (!Array.isArray(value) || value.length > maxTabs) throw manifestError()
      return [
        id,
        value.map((tab) => {
          if (!tab || typeof tab !== "object" || Array.isArray(tab)) throw manifestError()
          const record = tab as Record<string, unknown>
          if (Object.keys(record).length !== 2 || typeof record.pinned !== "boolean") throw manifestError()
          return { url: manifestURL(record.url), pinned: record.pinned }
        }),
      ]
    }),
  )
  return {
    version: 1,
    revision: manifest.revision as number,
    profiles,
    activeProfileID: manifest.activeProfileID,
    tabs: parsedTabs,
    bookmarks: manifest.bookmarks.map(manifestURL),
    history: manifest.history.map(manifestURL),
  }
}

const parseRegistry = (value: unknown): Registry => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw registryError()
  const registry = value as Record<string, unknown>
  if (
    Object.keys(registry).length !== 3 ||
    registry.version !== 1 ||
    !Number.isSafeInteger(registry.revision) ||
    (registry.revision as number) < 0 ||
    !registry.profiles ||
    typeof registry.profiles !== "object" ||
    Array.isArray(registry.profiles)
  ) {
    throw registryError()
  }
  const profiles = Object.fromEntries(
    Object.entries(registry.profiles as Record<string, unknown>).map(([id, value]) => {
      profileID(id)
      if (!value || typeof value !== "object" || Array.isArray(value)) throw registryError()
      const profile = value as Record<string, unknown>
      if (
        Object.keys(profile).length !== 2 ||
        typeof profile.storageKey !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(profile.storageKey) ||
        (profile.status !== "active" && profile.status !== "deleting" && profile.status !== "deleted")
      ) {
        throw registryError()
      }
      return [id, Object.freeze({ storageKey: profile.storageKey, status: profile.status })]
    }),
  )
  return { version: 1, revision: registry.revision as number, profiles }
}

export class AppDockProfileRegistry {
  #registry: Registry
  #manifest: AppDockManifest

  private constructor(
    private readonly path: string,
    private readonly manifestPath: string,
    registry: Registry,
    manifest: AppDockManifest,
  ) {
    this.#registry = registry
    this.#manifest = manifest
  }

  static load(userData: string) {
    const path = join(userData, "app-dock-profile-registry.json")
    const manifestPath = join(userData, "app-dock-manifest.json")
    try {
      const registry = parseRegistry(JSON.parse(readFileSync(path, "utf8")))
      let manifest: AppDockManifest
      let manifestMissing = false
      try {
        manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          manifestMissing = true
        } else if (error instanceof SyntaxError) {
          manifestMissing = true
        } else if (error instanceof Error && error.message === "Invalid App Dock manifest") {
          manifestMissing = true
        } else {
          throw error
        }
        if (manifestMissing) {
          const active = Object.keys(registry.profiles).filter((id) => registry.profiles[id].status === "active")
          manifest = {
            version: 1,
            revision: 0,
            profiles: active.map((id) => ({ id, name: id })),
            activeProfileID: active[0] ?? "",
            tabs: Object.fromEntries(active.map((id) => [id, []])),
            bookmarks: [],
            history: [],
          }
        }
      }
      const result = new AppDockProfileRegistry(path, manifestPath, registry, manifest!)
      if (manifestMissing) result.writeManifest(manifest!)
      result.reconcileManifest()
      return result
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return new AppDockProfileRegistry(
          path,
          manifestPath,
          { version: 1, revision: 0, profiles: {} },
          {
            version: 1,
            revision: 0,
            profiles: [],
            activeProfileID: "",
            tabs: {},
            bookmarks: [],
            history: [],
          },
        )
      if (error instanceof Error && error.message === "Invalid App Dock profile ID") throw registryError()
      if (error instanceof Error && error.message === "Invalid App Dock profile registry") throw error
      throw registryError()
    }
  }

  ensureActive(id: string): ProfileStorage {
    const profile = this.#registry.profiles[profileID(id)]
    if (profile?.status === "active") {
      if (!this.#manifest.profiles.some((item) => item.id === id)) this.addManifestProfile(id)
      return Object.freeze({ storageKey: profile.storageKey })
    }
    if (profile) throw new Error("App Dock profile is not active")
    if (this.#manifest.profiles.length >= maxProfiles) throw new Error("App Dock profile limit reached")
    const storageKey = randomUUID()
    this.write({ ...this.#registry.profiles, [id]: Object.freeze({ storageKey, status: "active" }) })
    this.addManifestProfile(id)
    return Object.freeze({ storageKey })
  }

  markDeleting(id: string): ProfileStorage {
    const profile = this.#registry.profiles[profileID(id)]
    if (!profile) throw new Error("Unknown App Dock profile")
    if (profile.status === "deleted") throw new Error("App Dock profile is not active")
    if (profile.status === "active")
      this.write({ ...this.#registry.profiles, [id]: { ...profile, status: "deleting" } })
    return Object.freeze({ storageKey: profile.storageKey })
  }

  markDeleted(id: string) {
    const profile = this.#registry.profiles[profileID(id)]
    if (!profile || profile.status !== "deleting") throw new Error("App Dock profile is not deleting")
    this.write({ ...this.#registry.profiles, [id]: { ...profile, status: "deleted" } })
    this.writeManifest({
      ...this.#manifest,
      profiles: this.#manifest.profiles.filter((profile) => profile.id !== id),
      activeProfileID:
        this.#manifest.activeProfileID === id
          ? (this.#manifest.profiles.find((profile) => profile.id !== id)?.id ?? "")
          : this.#manifest.activeProfileID,
      tabs: Object.fromEntries(Object.entries(this.#manifest.tabs).filter(([profileID]) => profileID !== id)),
    })
  }

  manifest() {
    return structuredClone(this.#manifest)
  }

  replaceManifest(expectedRevision: unknown, value: unknown): AppDockManifestUpdate {
    if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw manifestError()
    const revision = expectedRevision
    if (revision !== this.#manifest.revision) return { status: "conflict", manifest: this.manifest() }
    const manifest = parseManifest(value)
    if (manifest.revision !== revision) throw manifestError()
    const active = Object.keys(this.#registry.profiles).filter((id) => this.#registry.profiles[id].status === "active")
    if (manifest.profiles.length !== active.length || manifest.profiles.some((profile) => !active.includes(profile.id)))
      throw manifestError()
    this.writeManifest({ ...manifest, revision: this.#manifest.revision + 1 })
    return { status: "updated", manifest: this.manifest() }
  }

  private write(profiles: Registry["profiles"]) {
    const registry = { version: 1 as const, revision: this.#registry.revision + 1, profiles }
    writeJSON(this.path, registry)
    this.#registry = registry
  }

  private writeManifest(manifest: AppDockManifest) {
    const parsed = parseManifest(manifest)
    writeJSON(this.manifestPath, parsed)
    this.#manifest = parsed
  }

  private addManifestProfile(id: string) {
    if (this.#manifest.profiles.length >= maxProfiles) throw new Error("App Dock profile limit reached")
    this.writeManifest({
      ...this.#manifest,
      profiles: [...this.#manifest.profiles, { id, name: id }],
      activeProfileID: this.#manifest.activeProfileID || id,
      tabs: { ...this.#manifest.tabs, [id]: [] },
    })
  }

  private reconcileManifest() {
    const active = Object.keys(this.#registry.profiles).filter((id) => this.#registry.profiles[id].status === "active")
    if (active.length > maxProfiles) throw registryError()
    if (
      active.length === this.#manifest.profiles.length &&
      active.every((id) => this.#manifest.profiles.some((profile) => profile.id === id))
    ) {
      return
    }
    const profiles = active.map(
      (id) => this.#manifest.profiles.find((profile) => profile.id === id) ?? { id, name: id },
    )
    this.writeManifest({
      ...this.#manifest,
      profiles,
      activeProfileID: profiles.some((profile) => profile.id === this.#manifest.activeProfileID)
        ? this.#manifest.activeProfileID
        : (profiles[0]?.id ?? ""),
      tabs: Object.fromEntries(profiles.map((profile) => [profile.id, this.#manifest.tabs[profile.id] ?? []])),
    })
  }
}
