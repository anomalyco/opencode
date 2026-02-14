{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Api where

import Data.Aeson
import GHC.Generics
import Servant
import Data.Text (Text)

-- 1. Data Models
data Health = Health
  { healthy :: Bool
  , version :: Text
  } deriving (Eq, Show, Generic)

instance ToJSON Health

data PathInfo = PathInfo
  { home :: Text
  , state :: Text
  , config :: Text
  , worktree :: Text
  , directory :: Text
  } deriving (Eq, Show, Generic)

instance ToJSON PathInfo

data Project = Project
  { id :: Text
  , worktree :: Text
  , name :: Maybe Text
  } deriving (Eq, Show, Generic)

instance ToJSON Project

data ProviderList = ProviderList
  { providers :: [Value]
  , default_ :: Value -- "default" is a keyword
  } deriving (Eq, Show, Generic)

instance ToJSON ProviderList where
  toJSON (ProviderList p d) = object ["providers" .= p, "default" .= d]

data VcsInfo = VcsInfo
  { branch :: Maybe Text
  } deriving (Eq, Show, Generic)

instance ToJSON VcsInfo

-- File Models

data FileType = FileTypeFile | FileTypeDirectory
  deriving (Eq, Show, Generic)

instance ToJSON FileType where
  toJSON FileTypeFile = String "file"
  toJSON FileTypeDirectory = String "directory"

data FileNode = FileNode
  { fnName :: Text
  , fnPath :: Text
  , fnAbsolute :: Text
  , fnType :: FileType
  , fnIgnored :: Bool
  } deriving (Eq, Show, Generic)

instance ToJSON FileNode where
  toJSON fn = object
    [ "name" .= fnName fn
    , "path" .= fnPath fn
    , "absolute" .= fnAbsolute fn
    , "type" .= fnType fn
    , "ignored" .= fnIgnored fn
    ]

data ContentType = ContentTypeText | ContentTypeBinary
  deriving (Eq, Show, Generic)

instance ToJSON ContentType where
  toJSON ContentTypeText = String "text"
  toJSON ContentTypeBinary = String "binary"

data FileContent = FileContent
  { fcType :: ContentType
  , fcContent :: Text
  } deriving (Eq, Show, Generic)

instance ToJSON FileContent where
  toJSON fc = object
    [ "type" .= fcType fc
    , "content" .= fcContent fc
    ]

-- Session Models

data SessionTime = SessionTime
  { stCreated :: Double
  , stUpdated :: Double
  , stArchived :: Maybe Double
  } deriving (Eq, Show, Generic)

instance ToJSON SessionTime where
  toJSON st = object
    [ "created" .= stCreated st
    , "updated" .= stUpdated st
    , "archived" .= stArchived st
    ]

data Session = Session
  { sesId :: Text
  , sesSlug :: Text
  , sesProjectId :: Text
  , sesDirectory :: Text
  , sesTitle :: Text
  , sesVersion :: Text
  , sesTime :: SessionTime
  , sesParentId :: Maybe Text
  } deriving (Eq, Show, Generic)

instance ToJSON Session where
  toJSON s = object
    [ "id" .= sesId s
    , "slug" .= sesSlug s
    , "projectID" .= sesProjectId s
    , "directory" .= sesDirectory s
    , "title" .= sesTitle s
    , "version" .= sesVersion s
    , "time" .= sesTime s
    , "parentID" .= sesParentId s
    ]

data CreateSessionInput = CreateSessionInput
  { csiTitle :: Maybe Text
  , csiParentId :: Maybe Text
  } deriving (Eq, Show, Generic)

instance FromJSON CreateSessionInput where
  parseJSON = withObject "CreateSessionInput" $ \v -> CreateSessionInput
    <$> v .:? "title"
    <*> v .:? "parentID"

-- Message Models

data MessageInfo = MessageInfo
  { msgId :: Text
  , msgSessionId :: Text
  , msgRole :: Text -- "user" or "assistant"
  , msgTime :: SessionTime -- Reusing SessionTime for convenience, or just create a MessageTime
  } deriving (Eq, Show, Generic)

instance ToJSON MessageInfo where
  toJSON m = object
    [ "id" .= msgId m
    , "sessionID" .= msgSessionId m
    , "role" .= msgRole m
    , "time" .= msgTime m
    ]

data Message = Message
  { msgInfo :: MessageInfo
  , msgParts :: [Value]
  } deriving (Eq, Show, Generic)

instance ToJSON Message where
  toJSON m = object
    [ "info" .= msgInfo m
    , "parts" .= msgParts m
    ]

data CreateMessageInput = CreateMessageInput
  { cmiMessageId :: Maybe Text
  , cmiParts :: [Value]
  } deriving (Eq, Show, Generic)

instance FromJSON CreateMessageInput where
  parseJSON = withObject "CreateMessageInput" $ \v -> CreateMessageInput
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

-- /session/message (List)
type SessionMessageListAPI = "session" :> Capture "sessionID" Text :> "message" :> QueryParam "limit" Int :> Get '[JSON] [Message]

-- /session/message (Create)
type SessionMessageCreateAPI = "session" :> Capture "sessionID" Text :> "message" :> ReqBody '[JSON] CreateMessageInput :> Post '[JSON] Message

-- /lsp
type LspAPI = "lsp" :> Get '[JSON] [Value]

-- /vcs
type VcsAPI = "vcs" :> Get '[JSON] VcsInfo

-- /permission
type PermissionAPI = "permission" :> Get '[JSON] [Value]

-- /question
type QuestionAPI = "question" :> Get '[JSON] [Value]

-- /file
type FileListAPI = "file" :> QueryParam "directory" Text :> QueryParam' '[Required] "path" Text :> Get '[JSON] [FileNode]

-- /file/content
type FileReadAPI = "file" :> "content" :> QueryParam "directory" Text :> QueryParam' '[Required] "path" Text :> Get '[JSON] FileContent

-- /global/event
type GlobalEventAPI = "global" :> "event" :> Raw

-- Combined API
type OpencodeAPI = 
       HealthAPI
  :<|> PathAPI
  :<|> GlobalConfigAPI
  :<|> ProjectListAPI
  :<|> ProjectCurrentAPI
  :<|> ProviderListAPI
  :<|> ProviderAuthAPI
  :<|> AgentAPI
  :<|> ConfigAPI
  :<|> CommandAPI
  :<|> SessionStatusAPI
  :<|> SessionListAPI
  :<|> SessionCreateAPI
  :<|> SessionMessageListAPI
  :<|> SessionMessageCreateAPI
  :<|> LspAPI
  :<|> VcsAPI
  :<|> PermissionAPI
  :<|> QuestionAPI
  :<|> FileListAPI
  :<|> FileReadAPI
  :<|> GlobalEventAPI

api :: Proxy OpencodeAPI
api = Proxy
