type NotificationIndexItem = {
  directory?: string
  session?: string
  viewed: boolean
  type: string
}

export function buildNotificationIndex<T extends NotificationIndexItem>(list: T[]) {
  const sessionAll = new Map<string, T[]>()
  const sessionUnseen = new Map<string, T[]>()
  const sessionUnseenCount = new Map<string, number>()
  const sessionUnseenHasError = new Map<string, boolean>()
  const projectAll = new Map<string, T[]>()
  const projectUnseen = new Map<string, T[]>()
  const projectUnseenCount = new Map<string, number>()
  const projectUnseenHasError = new Map<string, boolean>()

  for (const notification of list) {
    const session = notification.session
    if (session) {
      const all = sessionAll.get(session)
      if (all) all.push(notification)
      else sessionAll.set(session, [notification])

      if (!notification.viewed) {
        const unseen = sessionUnseen.get(session)
        if (unseen) unseen.push(notification)
        else sessionUnseen.set(session, [notification])

        sessionUnseenCount.set(session, (sessionUnseenCount.get(session) ?? 0) + 1)
        if (notification.type === "error") sessionUnseenHasError.set(session, true)
      }
    }

    const directory = notification.directory
    if (directory) {
      const all = projectAll.get(directory)
      if (all) all.push(notification)
      else projectAll.set(directory, [notification])

      if (!notification.viewed) {
        const unseen = projectUnseen.get(directory)
        if (unseen) unseen.push(notification)
        else projectUnseen.set(directory, [notification])

        projectUnseenCount.set(directory, (projectUnseenCount.get(directory) ?? 0) + 1)
        if (notification.type === "error") projectUnseenHasError.set(directory, true)
      }
    }
  }

  return {
    session: {
      all: sessionAll,
      unseen: sessionUnseen,
      unseenCount: sessionUnseenCount,
      unseenHasError: sessionUnseenHasError,
    },
    project: {
      all: projectAll,
      unseen: projectUnseen,
      unseenCount: projectUnseenCount,
      unseenHasError: projectUnseenHasError,
    },
  }
}
