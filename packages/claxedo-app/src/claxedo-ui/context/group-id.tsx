/**
 * GroupIdContext
 *
 * Provides the current group ID to components that need it above
 * SessionParamsProvider (which sits below DirectoryScope).
 *
 * This is placed above DirectoryScope in GroupContentRenderer so that
 * directoryProviders (like ClaxedoDirectoryProvider / TerminalContentWrapperInner)
 * can access the group ID to use group-specific tab actions instead of
 * the focus-tracking topTabs.
 */

import { createContext, useContext, type JSX } from "solid-js"

const GroupIdContext = createContext<string>()

export function GroupIdProvider(props: { groupId: string; children: JSX.Element }) {
  return <GroupIdContext.Provider value={props.groupId}>{props.children}</GroupIdContext.Provider>
}

/** Returns the group ID if inside a GroupIdProvider, or undefined (route-level). */
export function useGroupId(): string | undefined {
  return useContext(GroupIdContext)
}
