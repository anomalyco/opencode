{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

-- | Tool type definitions
module Tool.Types
  ( -- * Tool info
    ToolDef(..)
  , ToolID(..)
    -- * Tool inputs
  , ReadInput(..)
  , WriteInput(..)
  , EditInput(..)
  , BashInput(..)
  , GlobInput(..)
  , GrepInput(..)
    -- * Tool result
  , ToolOutput(..)
    -- * Context
  , ToolContext(..)
  ) where

import Data.Aeson
import Data.Text (Text)
import GHC.Generics (Generic)

-- | Tool identifiers
data ToolID
  = ReadTool
  | WriteTool
  | EditTool
  | BashTool
  | GlobTool
  | GrepTool
  | TodoWriteTool
  | WebFetchTool
  | QuestionTool
  | TaskTool
  deriving (Eq, Show, Generic)

instance ToJSON ToolID where
  toJSON ReadTool = "read"
  toJSON WriteTool = "write"
  toJSON EditTool = "edit"
  toJSON BashTool = "bash"
  toJSON GlobTool = "glob"
  toJSON GrepTool = "grep"
  toJSON TodoWriteTool = "todowrite"
  toJSON WebFetchTool = "webfetch"
  toJSON QuestionTool = "question"
  toJSON TaskTool = "task"

instance FromJSON ToolID where
  parseJSON = withText "ToolID" $ \case
    "read" -> pure ReadTool
    "write" -> pure WriteTool
    "edit" -> pure EditTool
    "bash" -> pure BashTool
    "glob" -> pure GlobTool
    "grep" -> pure GrepTool
    "todowrite" -> pure TodoWriteTool
    "webfetch" -> pure WebFetchTool
    "question" -> pure QuestionTool
    "task" -> pure TaskTool
    t -> fail $ "Unknown tool: " <> show t

-- | Tool definition for API
data ToolDef = ToolDef
  { tdName        :: Text
  , tdDescription :: Text
  , tdInputSchema :: Value  -- JSON Schema
  } deriving (Eq, Show, Generic)

instance ToJSON ToolDef where
  toJSON ToolDef{..} = object
    [ "name" .= tdName
    , "description" .= tdDescription
    , "input_schema" .= tdInputSchema
    ]

-- | Read tool input
data ReadInput = ReadInput
  { riFilePath :: Text
  , riOffset   :: Maybe Int
  , riLimit    :: Maybe Int
  } deriving (Eq, Show, Generic)

instance FromJSON ReadInput where
  parseJSON = withObject "ReadInput" $ \v -> ReadInput
    <$> v .: "filePath"
    <*> v .:? "offset"
    <*> v .:? "limit"

-- | Write tool input
data WriteInput = WriteInput
  { wiFilePath :: Text
  , wiContent  :: Text
  } deriving (Eq, Show, Generic)

instance FromJSON WriteInput where
  parseJSON = withObject "WriteInput" $ \v -> WriteInput
    <$> v .: "filePath"
    <*> v .: "content"

-- | Edit tool input
data EditInput = EditInput
  { eiFilePath   :: Text
  , eiOldString  :: Text
  , eiNewString  :: Text
  , eiReplaceAll :: Maybe Bool
  } deriving (Eq, Show, Generic)

instance FromJSON EditInput where
  parseJSON = withObject "EditInput" $ \v -> EditInput
    <$> v .: "filePath"
    <*> v .: "oldString"
    <*> v .: "newString"
    <*> v .:? "replaceAll"

-- | Bash tool input
data BashInput = BashInput
  { biCommand     :: Text
  , biDescription :: Text
  , biTimeout     :: Maybe Int
  , biWorkdir     :: Maybe Text
  } deriving (Eq, Show, Generic)

instance FromJSON BashInput where
  parseJSON = withObject "BashInput" $ \v -> BashInput
    <$> v .: "command"
    <*> v .: "description"
    <*> v .:? "timeout"
    <*> v .:? "workdir"

-- | Glob tool input
data GlobInput = GlobInput
  { giPattern :: Text
  , giPath    :: Maybe Text
  } deriving (Eq, Show, Generic)

instance FromJSON GlobInput where
  parseJSON = withObject "GlobInput" $ \v -> GlobInput
    <$> v .: "pattern"
    <*> v .:? "path"

-- | Grep tool input
data GrepInput = GrepInput
  { grPattern :: Text
  , grPath    :: Maybe Text
  , grInclude :: Maybe Text
  } deriving (Eq, Show, Generic)

instance FromJSON GrepInput where
  parseJSON = withObject "GrepInput" $ \v -> GrepInput
    <$> v .: "pattern"
    <*> v .:? "path"
    <*> v .:? "include"

-- | Tool execution output
data ToolOutput = ToolOutput
  { toTitle    :: Text
  , toOutput   :: Text
  , toIsError  :: Bool
  , toMetadata :: Maybe Value
  } deriving (Eq, Show, Generic)

instance ToJSON ToolOutput where
  toJSON ToolOutput{..} = object
    [ "title" .= toTitle
    , "output" .= toOutput
    , "is_error" .= toIsError
    , "metadata" .= toMetadata
    ]

-- | Context for tool execution
data ToolContext = ToolContext
  { tcSessionID :: Text
  , tcMessageID :: Text
  , tcWorkdir   :: FilePath
  } deriving (Eq, Show)
