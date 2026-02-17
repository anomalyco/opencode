{-# LANGUAGE OverloadedStrings #-}

{- | Bus event definitions
Mirrors the TypeScript BusEvent module
-}
module Bus.Event (
    Event (..),
    EventType (..),
    toJSON,
) where

import Data.Aeson (ToJSON (..), Value, object, (.=))
import Data.Text (Text)
import GHC.Generics (Generic)

-- | Event types that can be published on the bus
data EventType
    = ServerConnected
    | ServerHeartbeat
    | ServerInstanceDisposed
    | SessionCreated
    | SessionUpdated
    | SessionDeleted
    | SessionDiff
    | SessionError
    | SessionStatus
    | SessionIdle
    | SessionCompacted
    | MessageUpdated
    | MessageRemoved
    | MessagePartUpdated
    | MessagePartRemoved
    | PermissionAsked
    | PermissionReplied
    | QuestionAsked
    | QuestionReplied
    | QuestionRejected
    | TodoUpdated
    | FileEdited
    | FileWatcherUpdated
    | VcsBranchUpdated
    | LspUpdated
    | LspClientDiagnostics
    | ProjectUpdated
    | InstallationUpdated
    | InstallationUpdateAvailable
    | CommandExecuted
    | PtyCreated
    | PtyUpdated
    | PtyExited
    | PtyDeleted
    | WorktreeReady
    | WorktreeFailed
    | GlobalDisposed
    deriving (Show, Eq, Generic)

instance ToJSON EventType where
    toJSON ServerConnected = "server.connected"
    toJSON ServerHeartbeat = "server.heartbeat"
    toJSON ServerInstanceDisposed = "server.instance.disposed"
    toJSON SessionCreated = "session.created"
    toJSON SessionUpdated = "session.updated"
    toJSON SessionDeleted = "session.deleted"
    toJSON SessionDiff = "session.diff"
    toJSON SessionError = "session.error"
    toJSON SessionStatus = "session.status"
    toJSON SessionIdle = "session.idle"
    toJSON SessionCompacted = "session.compacted"
    toJSON MessageUpdated = "message.updated"
    toJSON MessageRemoved = "message.removed"
    toJSON MessagePartUpdated = "message.part.updated"
    toJSON MessagePartRemoved = "message.part.removed"
    toJSON PermissionAsked = "permission.asked"
    toJSON PermissionReplied = "permission.replied"
    toJSON QuestionAsked = "question.asked"
    toJSON QuestionReplied = "question.replied"
    toJSON QuestionRejected = "question.rejected"
    toJSON TodoUpdated = "todo.updated"
    toJSON FileEdited = "file.edited"
    toJSON FileWatcherUpdated = "file.watcher.updated"
    toJSON VcsBranchUpdated = "vcs.branch.updated"
    toJSON LspUpdated = "lsp.updated"
    toJSON LspClientDiagnostics = "lsp.client.diagnostics"
    toJSON ProjectUpdated = "project.updated"
    toJSON InstallationUpdated = "installation.updated"
    toJSON InstallationUpdateAvailable = "installation.update-available"
    toJSON CommandExecuted = "command.executed"
    toJSON PtyCreated = "pty.created"
    toJSON PtyUpdated = "pty.updated"
    toJSON PtyExited = "pty.exited"
    toJSON PtyDeleted = "pty.deleted"
    toJSON WorktreeReady = "worktree.ready"
    toJSON WorktreeFailed = "worktree.failed"
    toJSON GlobalDisposed = "global.disposed"

-- | A bus event with type and properties
data Event = Event
    { eventType :: Text
    , eventProperties :: Value
    }
    deriving (Show, Eq, Generic)

instance ToJSON Event where
    toJSON e =
        object
            [ "type" .= eventType e
            , "properties" .= eventProperties e
            ]
