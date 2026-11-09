// Previous/Next session commands belong to whichever layout lists the sessions: the tab strip or the Inbox sidebar.
// Both register the same ids, so Settings > Shortcuts names them once and either layout can own the keybind.
export const previousSessionCommand = { id: "session.previous", keybind: "alt+arrowup" }

export const nextSessionCommand = { id: "session.next", keybind: "alt+arrowdown" }
