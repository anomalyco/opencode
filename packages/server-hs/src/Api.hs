{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Api where

import Data.Aeson
import Data.Text (Text)
import GHC.Generics
import Servant

-- 1. Data Models
data Health = Health
  { healthy :: Bool,
    version :: Text
  }
  deriving (Eq, Show, Generic)

instance ToJSON Health

instance FromJSON Health

data PathInfo = PathInfo
  { home :: Text,
    state :: Text,
    config :: Text,
    worktree :: Text,
    directory :: Text
  }
  deriving (Eq, Show, Generic)

instance ToJSON PathInfo

instance FromJSON PathInfo

data Project = Project
  { id :: Text,
    worktree :: Text,
    name :: Maybe Text
  }
  deriving (Eq, Show, Generic)

instance ToJSON Project

instance FromJSON Project

data ProviderList = ProviderList
  { providers :: [Value],
    default_ :: Value -- "default" is a keyword
  }
  deriving (Eq, Show, Generic)

instance ToJSON ProviderList where
  toJSON (ProviderList p d) = object ["providers" .= p, "default" .= d]

instance FromJSON ProviderList where
  parseJSON = withObject "ProviderList" $ \v ->
    ProviderList
      <$> v .: "providers"
      <*> v .: "default"

data VcsInfo = VcsInfo
  { branch :: Maybe Text
  }
  deriving (Eq, Show, Generic)

instance ToJSON VcsInfo

instance FromJSON VcsInfo where
  parseJSON = withObject "VcsInfo" $ \v ->
    VcsInfo
      <$> v .:? "branch"

-- File Models

data FileType = FileTypeFile | FileTypeDirectory
  deriving (Eq, Show, Generic)

instance ToJSON FileType where
  toJSON FileTypeFile = String "file"
  toJSON FileTypeDirectory = String "directory"

instance FromJSON FileType where
  parseJSON = withText "FileType" $ \case
    "file" -> pure FileTypeFile
    "directory" -> pure FileTypeDirectory
    _ -> fail "Invalid file type"

data FileNode = FileNode
  { fnName :: Text,
    fnPath :: Text,
    fnAbsolute :: Text,
    fnType :: FileType,
    fnIgnored :: Bool
  }
  deriving (Eq, Show, Generic)

instance ToJSON FileNode where
  toJSON fn =
    object
      [ "name" .= fnName fn,
        "path" .= fnPath fn,
        "absolute" .= fnAbsolute fn,
        "type" .= fnType fn,
        "ignored" .= fnIgnored fn
      ]

instance FromJSON FileNode where
  parseJSON = withObject "FileNode" $ \v ->
    FileNode
      <$> v .: "name"
      <*> v .: "path"
      <*> v .: "absolute"
      <*> v .: "type"
      <*> v .: "ignored"

data ContentType = ContentTypeText | ContentTypeBinary
  deriving (Eq, Show, Generic)

instance ToJSON ContentType where
  toJSON ContentTypeText = String "text"
  toJSON ContentTypeBinary = String "binary"

instance FromJSON ContentType where
  parseJSON = withText "ContentType" $ \case
    "text" -> pure ContentTypeText
    "binary" -> pure ContentTypeBinary
    _ -> fail "Invalid content type"

data FileContent = FileContent
  { fcType :: ContentType,
    fcContent :: Text
  }
  deriving (Eq, Show, Generic)

instance ToJSON FileContent where
  toJSON fc =
    object
      [ "type" .= fcType fc,
        "content" .= fcContent fc
      ]

instance FromJSON FileContent where
  parseJSON = withObject "FileContent" $ \v ->
    FileContent
      <$> v .: "type"
      <*> v .: "content"

-- Session Models

data SessionTime = SessionTime
  { stCreated :: Double,
    stUpdated :: Double,
    stArchived :: Maybe Double
  }
  deriving (Eq, Show, Generic)

instance ToJSON SessionTime where
  toJSON st =
    object
      [ "created" .= stCreated st,
        "updated" .= stUpdated st,
        "archived" .= stArchived st
      ]

instance FromJSON SessionTime where
  parseJSON = withObject "SessionTime" $ \v ->
    SessionTime
      <$> v .: "created"
      <*> v .: "updated"
      <*> v .:? "archived"

data SessionSummary = SessionSummary
  { ssAdditions :: Int,
    ssDeletions :: Int,
    ssFiles :: Maybe Int
  }
  deriving (Eq, Show, Generic)

instance ToJSON SessionSummary where
  toJSON ss =
    object
      [ "additions" .= ssAdditions ss,
        "deletions" .= ssDeletions ss,
        "files" .= ssFiles ss
      ]

instance FromJSON SessionSummary where
  parseJSON = withObject "SessionSummary" $ \v ->
    SessionSummary
      <$> v .: "additions"
      <*> v .: "deletions"
      <*> v .:? "files"

newtype SessionShare = SessionShare
  { shareUrl :: Text
  }
  deriving (Eq, Show, Generic)

instance ToJSON SessionShare where
  toJSON ss = object ["url" .= shareUrl ss]

instance FromJSON SessionShare where
  parseJSON = withObject "SessionShare" $ \v ->
    SessionShare
      <$> v .: "url"

data SessionRevert = SessionRevert
  { srMessageId :: Text,
    srPartId :: Maybe Text,
    srSnapshot :: Maybe Text,
    srDiff :: Maybe Text
  }
  deriving (Eq, Show, Generic)

instance ToJSON SessionRevert where
  toJSON sr =
    object
      [ "messageID" .= srMessageId sr,
        "partID" .= srPartId sr,
        "snapshot" .= srSnapshot sr,
        "diff" .= srDiff sr
      ]

instance FromJSON SessionRevert where
  parseJSON = withObject "SessionRevert" $ \v ->
    SessionRevert
      <$> v .: "messageID"
      <*> v .:? "partID"
      <*> v .:? "snapshot"
      <*> v .:? "diff"

data Session = Session
  { sesId :: Text,
    sesSlug :: Text,
    sesProjectId :: Text,
    sesDirectory :: Text,
    sesTitle :: Text,
    sesVersion :: Text,
    sesTime :: SessionTime,
    sesParentId :: Maybe Text,
    sesSummary :: Maybe SessionSummary,
    sesShare :: Maybe SessionShare,
    sesRevert :: Maybe SessionRevert
  }
  deriving (Eq, Show, Generic)

instance ToJSON Session where
  toJSON s =
    object
      [ "id" .= sesId s,
        "slug" .= sesSlug s,
        "projectID" .= sesProjectId s,
        "directory" .= sesDirectory s,
        "title" .= sesTitle s,
        "version" .= sesVersion s,
        "time" .= sesTime s,
        "parentID" .= sesParentId s,
        "summary" .= sesSummary s,
        "share" .= sesShare s,
        "revert" .= sesRevert s
      ]

instance FromJSON Session where
  parseJSON = withObject "Session" $ \v ->
    Session
      <$> v .: "id"
      <*> v .: "slug"
      <*> v .: "projectID"
      <*> v .: "directory"
      <*> v .: "title"
      <*> v .: "version"
      <*> v .: "time"
      <*> v .:? "parentID"
      <*> v .:? "summary"
      <*> v .:? "share"
      <*> v .:? "revert"

data UpdateSessionInput = UpdateSessionInput
  { usiTitle :: Maybe Text,
    usiSummary :: Maybe SessionSummary,
    usiShare :: Maybe SessionShare,
    usiRevert :: Maybe SessionRevert
  }
  deriving (Eq, Show, Generic)

instance FromJSON UpdateSessionInput where
  parseJSON = withObject "UpdateSessionInput" $ \v ->
    UpdateSessionInput
      <$> v .:? "title"
      <*> v .:? "summary"
      <*> v .:? "share"
      <*> v .:? "revert"

instance ToJSON UpdateSessionInput where
  toJSON usi =
    object
      [ "title" .= usiTitle usi,
        "summary" .= usiSummary usi,
        "share" .= usiShare usi,
        "revert" .= usiRevert usi
      ]

data CreateSessionInput = CreateSessionInput
  { csiTitle :: Maybe Text,
    csiParentId :: Maybe Text
  }
  deriving (Eq, Show, Generic)

instance FromJSON CreateSessionInput where
  parseJSON = withObject "CreateSessionInput" $ \v ->
    CreateSessionInput
      <$> v .:? "title"
      <*> v .:? "parentID"

instance ToJSON CreateSessionInput where
  toJSON csi =
    object
      [ "title" .= csiTitle csi,
        "parentID" .= csiParentId csi
      ]

-- Message Models

data MessageInfo = MessageInfo
  { msgId :: Text,
    msgSessionId :: Text,
    msgRole :: Text, -- "user" or "assistant"
    msgTime :: SessionTime -- Reusing SessionTime for convenience, or just create a MessageTime
  }
  deriving (Eq, Show, Generic)

instance ToJSON MessageInfo where
  toJSON m =
    object
      [ "id" .= msgId m,
        "sessionID" .= msgSessionId m,
        "role" .= msgRole m,
        "time" .= msgTime m
      ]

instance FromJSON MessageInfo where
  parseJSON = withObject "MessageInfo" $ \v ->
    MessageInfo
      <$> v .: "id"
      <*> v .: "sessionID"
      <*> v .: "role"
      <*> v .: "time"

data Message = Message
  { msgInfo :: MessageInfo,
    msgParts :: [Value]
  }
  deriving (Eq, Show, Generic)

instance ToJSON Message where
  toJSON m =
    object
      [ "info" .= msgInfo m,
        "parts" .= msgParts m
      ]

instance FromJSON Message where
  parseJSON = withObject "Message" $ \v ->
    Message
      <$> v .: "info"
      <*> v .: "parts"

data CreateMessageInput = CreateMessageInput
  { cmiMessageId :: Maybe Text,
    cmiParts :: [Value]
  }
  deriving (Eq, Show, Generic)

instance FromJSON CreateMessageInput where
  parseJSON = withObject "CreateMessageInput" $ \v ->
    CreateMessageInput
      <$> v .:? "messageID"
      <*> v .: "parts"

-- 2. API Definition

-- /global/health
type HealthAPI = "global" :> "health" :> Get '[JSON] Health

-- /path
type PathAPI = "path" :> Get '[JSON] PathInfo

-- /global/config
type GlobalConfigAPI = "global" :> "config" :> Get '[JSON] Value

-- /project
type ProjectListAPI = "project" :> Get '[JSON] [Project]

-- /project/current
type ProjectCurrentAPI = "project" :> "current" :> QueryParam "directory" Text :> Get '[JSON] Project

-- /config/providers
type ProviderListAPI = "config" :> "providers" :> Get '[JSON] ProviderList

-- /provider/auth
type ProviderAuthAPI = "provider" :> "auth" :> Get '[JSON] Value

-- /agent
type AgentAPI = "agent" :> Get '[JSON] [Value]

-- /config
type ConfigAPI = "config" :> Get '[JSON] Value

-- /command
type CommandAPI = "command" :> Get '[JSON] [Value]

-- /session/status
type SessionStatusAPI = "session" :> "status" :> Get '[JSON] Value

-- /session (List)
type SessionListAPI = "session" :> QueryParam "directory" Text :> QueryParam "roots" Bool :> QueryParam "limit" Int :> Get '[JSON] [Session]

-- /session (Create)
type SessionCreateAPI = "session" :> QueryParam "directory" Text :> ReqBody '[JSON] CreateSessionInput :> Post '[JSON] Session

-- /session/:sessionID (Get)
type SessionGetAPI = "session" :> Capture "sessionID" Text :> Get '[JSON] Session

-- /session/:sessionID (Delete)
type SessionDeleteAPI = "session" :> Capture "sessionID" Text :> Delete '[JSON] Bool

-- /session/:sessionID (Patch)
type SessionUpdateAPI = "session" :> Capture "sessionID" Text :> ReqBody '[JSON] UpdateSessionInput :> Patch '[JSON] Session

-- /session/:sessionID/children
type SessionChildrenAPI = "session" :> Capture "sessionID" Text :> "children" :> Get '[JSON] [Session]

-- /session/:sessionID/todo
type SessionTodoAPI = "session" :> Capture "sessionID" Text :> "todo" :> Get '[JSON] [Value]

-- /session/:sessionID/init
type SessionInitAPI = "session" :> Capture "sessionID" Text :> "init" :> Post '[JSON] Value

-- /session/:sessionID/fork
type SessionForkAPI = "session" :> Capture "sessionID" Text :> "fork" :> Post '[JSON] Session

-- /session/:sessionID/abort
type SessionAbortAPI = "session" :> Capture "sessionID" Text :> "abort" :> Post '[JSON] Value

-- /session/:sessionID/share
type SessionShareCreateAPI = "session" :> Capture "sessionID" Text :> "share" :> Post '[JSON] SessionShare

type SessionShareDeleteAPI = "session" :> Capture "sessionID" Text :> "share" :> Delete '[JSON] Bool

-- /session/:sessionID/diff
type SessionDiffAPI = "session" :> Capture "sessionID" Text :> "diff" :> Get '[JSON] Value

-- /session/:sessionID/summarize
type SessionSummarizeAPI = "session" :> Capture "sessionID" Text :> "summarize" :> Post '[JSON] SessionSummary

-- /session/:sessionID/command
type SessionCommandAPI = "session" :> Capture "sessionID" Text :> "command" :> ReqBody '[JSON] Value :> Post '[JSON] Value

-- /session/:sessionID/shell
type SessionShellAPI = "session" :> Capture "sessionID" Text :> "shell" :> ReqBody '[JSON] Value :> Post '[JSON] Value

-- /session/:sessionID/revert
type SessionRevertAPI = "session" :> Capture "sessionID" Text :> "revert" :> ReqBody '[JSON] SessionRevert :> Post '[JSON] SessionRevert

-- /session/:sessionID/unrevert
type SessionUnrevertAPI = "session" :> Capture "sessionID" Text :> "unrevert" :> Post '[JSON] Bool

-- /session/:sessionID/permissions/:permissionID
type SessionPermissionAPI = "session" :> Capture "sessionID" Text :> "permissions" :> Capture "permissionID" Text :> ReqBody '[JSON] Value :> Post '[JSON] Value

-- /session/message (List)
type SessionMessageListAPI = "session" :> Capture "sessionID" Text :> "message" :> QueryParam "limit" Int :> Get '[JSON] [Message]

-- /session/message (Create)
type SessionMessageCreateAPI = "session" :> Capture "sessionID" Text :> "message" :> ReqBody '[JSON] CreateMessageInput :> Post '[JSON] Message

-- /session/message (Get)
type SessionMessageGetAPI = "session" :> Capture "sessionID" Text :> "message" :> Capture "messageID" Text :> Get '[JSON] Message

-- /session/message/part (Delete)
type SessionMessagePartDeleteAPI =
  "session" :> Capture "sessionID" Text :> "message" :> Capture "messageID" Text :> "part" :> Capture "partID" Text :> Delete '[JSON] Bool

-- /session/message/part (Patch)
type SessionMessagePartUpdateAPI =
  "session" :> Capture "sessionID" Text :> "message" :> Capture "messageID" Text :> "part" :> Capture "partID" Text :> ReqBody '[JSON] Value :> Patch '[JSON] Value

-- /session/prompt_async
type SessionPromptAsyncAPI =
  "session" :> Capture "sessionID" Text :> "prompt_async" :> ReqBody '[JSON] CreateMessageInput :> Post '[JSON] Value

-- /lsp
type LspAPI = "lsp" :> Get '[JSON] [Value]

-- /vcs
type VcsAPI = "vcs" :> Get '[JSON] VcsInfo

-- /permission
type PermissionAPI = "permission" :> Get '[JSON] [Value]

-- /question
type QuestionAPI = "question" :> Get '[JSON] [Value]

-- /question/:requestID/reply
type QuestionReplyAPI = "question" :> Capture "requestID" Text :> "reply" :> ReqBody '[JSON] Value :> Post '[JSON] Value

-- /question/:requestID/reject
type QuestionRejectAPI = "question" :> Capture "requestID" Text :> "reject" :> ReqBody '[JSON] Value :> Post '[JSON] Value

-- /permission/:requestID/reply
type PermissionReplyAPI = "permission" :> Capture "requestID" Text :> "reply" :> ReqBody '[JSON] Value :> Post '[JSON] Value

-- /file
type FileListAPI = "file" :> QueryParam "directory" Text :> QueryParam' '[Required] "path" Text :> Get '[JSON] [FileNode]

-- /file/content
type FileReadAPI = "file" :> "content" :> QueryParam "directory" Text :> QueryParam' '[Required] "path" Text :> Get '[JSON] FileContent

-- /file/status
type FileStatusAPI = "file" :> "status" :> QueryParam "directory" Text :> QueryParam "path" Text :> Get '[JSON] [Value]

-- /global/event
type GlobalEventAPI = "global" :> "event" :> Raw

-- PTY API (sandboxed terminals)

-- /pty (List)
type PtyListAPI = "pty" :> Get '[JSON] [Value]

-- /pty (Create)
type PtyCreateAPI = "pty" :> ReqBody '[JSON] Value :> Post '[JSON] Value

-- /pty/:ptyID (Get)
type PtyGetAPI = "pty" :> Capture "ptyID" Text :> Get '[JSON] Value

-- /pty/:ptyID (Update)
type PtyUpdateAPI = "pty" :> Capture "ptyID" Text :> ReqBody '[JSON] Value :> Put '[JSON] Value

-- /pty/:ptyID (Delete)
type PtyDeleteAPI = "pty" :> Capture "ptyID" Text :> Delete '[JSON] Bool

-- /pty/:ptyID/connect (WebSocket) - handled separately as Raw
type PtyConnectAPI = "pty" :> Capture "ptyID" Text :> "connect" :> Raw

-- /pty/:ptyID/commit (Commit sandbox changes to real filesystem)
type PtyCommitAPI = "pty" :> Capture "ptyID" Text :> "commit" :> Post '[JSON] Value

-- /pty/:ptyID/changes (Get list of changed files in sandbox)
type PtyChangesAPI = "pty" :> Capture "ptyID" Text :> "changes" :> Get '[JSON] Value

-- /chat (LLM chat completion via OpenRouter)
type ChatAPI = "chat" :> ReqBody '[JSON] ChatInput :> Post '[JSON] Value

-- /auth/:providerID
type AuthCreateAPI = "auth" :> Capture "providerID" Text :> ReqBody '[JSON] Value :> Post '[JSON] Value

type AuthUpdateAPI = "auth" :> Capture "providerID" Text :> ReqBody '[JSON] Value :> Put '[JSON] Value

type AuthDeleteAPI = "auth" :> Capture "providerID" Text :> Delete '[JSON] Value

-- /provider
type ProviderAPI = "provider" :> Get '[JSON] [Value]

type ProviderOauthAuthorizeAPI =
  "provider" :> Capture "providerID" Text :> "oauth" :> "authorize" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type ProviderOauthCallbackAPI =
  "provider" :> Capture "providerID" Text :> "oauth" :> "callback" :> ReqBody '[JSON] Value :> Post '[JSON] Value

-- /project/:projectID
type ProjectGetAPI = "project" :> Capture "projectID" Text :> Get '[JSON] Project

-- /find
type FindAPI = "find" :> QueryParam "query" Text :> QueryParam "pattern" Text :> QueryParam "directory" Text :> Get '[JSON] [Value]

type FindFileAPI = "find" :> "file" :> QueryParam "pattern" Text :> QueryParam "directory" Text :> Get '[JSON] [Value]

type FindSymbolAPI = "find" :> "symbol" :> QueryParam "query" Text :> QueryParam "directory" Text :> Get '[JSON] [Value]

-- /tui/*
type TuiAppendPromptAPI = "tui" :> "append-prompt" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type TuiOpenHelpAPI = "tui" :> "open-help" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type TuiOpenSessionsAPI = "tui" :> "open-sessions" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type TuiOpenThemesAPI = "tui" :> "open-themes" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type TuiOpenModelsAPI = "tui" :> "open-models" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type TuiSubmitPromptAPI = "tui" :> "submit-prompt" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type TuiClearPromptAPI = "tui" :> "clear-prompt" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type TuiExecuteCommandAPI = "tui" :> "execute-command" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type TuiShowToastAPI = "tui" :> "show-toast" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type TuiPublishAPI = "tui" :> "publish" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type TuiSelectSessionAPI = "tui" :> "select-session" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type TuiControlNextAPI = "tui" :> "control" :> "next" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type TuiControlResponseAPI = "tui" :> "control" :> "response" :> ReqBody '[JSON] Value :> Post '[JSON] Value

-- /instance/dispose
type InstanceDisposeAPI = "instance" :> "dispose" :> Post '[JSON] Value

-- /log
type LogAPI = "log" :> ReqBody '[JSON] Value :> Post '[JSON] Value

-- /skill
type SkillAPI = "skill" :> Get '[JSON] [Value]

-- /formatter
type FormatterAPI = "formatter" :> Get '[JSON] Value

-- /experimental/tool/ids
type ExperimentalToolIdsAPI = "experimental" :> "tool" :> "ids" :> Get '[JSON] [Text]

-- /experimental/tool
type ExperimentalToolAPI = "experimental" :> "tool" :> ReqBody '[JSON] Value :> Post '[JSON] Value

-- /experimental/worktree
type ExperimentalWorktreeGetAPI = "experimental" :> "worktree" :> Get '[JSON] Value

type ExperimentalWorktreePostAPI = "experimental" :> "worktree" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type ExperimentalWorktreeResetAPI = "experimental" :> "worktree" :> "reset" :> ReqBody '[JSON] Value :> Post '[JSON] Value

-- Chat input
data ChatInput = ChatInput
  { ciMessage :: Text,
    ciModel :: Maybe Text
  }
  deriving (Eq, Show, Generic)

instance FromJSON ChatInput where
  parseJSON = withObject "ChatInput" $ \v ->
    ChatInput
      <$> v .: "message"
      <*> v .:? "model"

-- Combined API
type OpencodeAPI =
  HealthAPI
    :<|> PathAPI
    :<|> GlobalConfigAPI
    :<|> ProjectListAPI
    :<|> ProjectGetAPI
    :<|> ProjectCurrentAPI
    :<|> ProviderListAPI
    :<|> ProviderAuthAPI
    :<|> ProviderAPI
    :<|> ProviderOauthAuthorizeAPI
    :<|> ProviderOauthCallbackAPI
    :<|> AuthCreateAPI
    :<|> AuthUpdateAPI
    :<|> AuthDeleteAPI
    :<|> AgentAPI
    :<|> ConfigAPI
    :<|> CommandAPI
    :<|> SessionStatusAPI
    :<|> SessionListAPI
    :<|> SessionCreateAPI
    :<|> SessionGetAPI
    :<|> SessionDeleteAPI
    :<|> SessionUpdateAPI
    :<|> SessionChildrenAPI
    :<|> SessionTodoAPI
    :<|> SessionInitAPI
    :<|> SessionForkAPI
    :<|> SessionAbortAPI
    :<|> SessionShareCreateAPI
    :<|> SessionShareDeleteAPI
    :<|> SessionDiffAPI
    :<|> SessionSummarizeAPI
    :<|> SessionCommandAPI
    :<|> SessionShellAPI
    :<|> SessionRevertAPI
    :<|> SessionUnrevertAPI
    :<|> SessionPermissionAPI
    :<|> SessionMessageListAPI
    :<|> SessionMessageCreateAPI
    :<|> SessionMessageGetAPI
    :<|> SessionMessagePartDeleteAPI
    :<|> SessionMessagePartUpdateAPI
    :<|> SessionPromptAsyncAPI
    :<|> LspAPI
    :<|> VcsAPI
    :<|> PermissionAPI
    :<|> PermissionReplyAPI
    :<|> QuestionAPI
    :<|> QuestionReplyAPI
    :<|> QuestionRejectAPI
    :<|> FindAPI
    :<|> FindFileAPI
    :<|> FindSymbolAPI
    :<|> FileListAPI
    :<|> FileReadAPI
    :<|> FileStatusAPI
    :<|> GlobalEventAPI
    -- PTY routes
    :<|> PtyListAPI
    :<|> PtyCreateAPI
    :<|> PtyGetAPI
    :<|> PtyUpdateAPI
    :<|> PtyDeleteAPI
    :<|> PtyConnectAPI
    :<|> PtyCommitAPI
    :<|> PtyChangesAPI
    -- TUI
    :<|> TuiAppendPromptAPI
    :<|> TuiOpenHelpAPI
    :<|> TuiOpenSessionsAPI
    :<|> TuiOpenThemesAPI
    :<|> TuiOpenModelsAPI
    :<|> TuiSubmitPromptAPI
    :<|> TuiClearPromptAPI
    :<|> TuiExecuteCommandAPI
    :<|> TuiShowToastAPI
    :<|> TuiPublishAPI
    :<|> TuiSelectSessionAPI
    :<|> TuiControlNextAPI
    :<|> TuiControlResponseAPI
    :<|> InstanceDisposeAPI
    :<|> LogAPI
    :<|> SkillAPI
    :<|> FormatterAPI
    :<|> ExperimentalToolIdsAPI
    :<|> ExperimentalToolAPI
    :<|> ExperimentalWorktreeGetAPI
    :<|> ExperimentalWorktreePostAPI
    :<|> ExperimentalWorktreeResetAPI
    -- LLM
    :<|> ChatAPI

api :: Proxy OpencodeAPI
api = Proxy
