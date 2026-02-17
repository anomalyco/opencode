{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}

-- | Tool definitions for Anthropic API
module Tool.Defs (
    allTools,
    toolDefinitions,
)
where

import Data.Aeson (Value, object, (.=))
import Data.Text (Text)
import Tool.Types

-- | All available tools
allTools :: [ToolDef]
allTools =
    [ readDef
    , writeDef
    , editDef
    , bashDef
    , globDef
    , grepDef
    ]

-- | Tool definitions as JSON for API
toolDefinitions :: [Value]
toolDefinitions = map toApiDef allTools
  where
    toApiDef ToolDef{..} =
        object
            [ "name" .= tdName
            , "description" .= tdDescription
            , "input_schema" .= tdInputSchema
            ]

readDef :: ToolDef
readDef =
    ToolDef
        { tdName = "read"
        , tdDescription = "Read a file or directory from the local filesystem. Returns contents with line numbers."
        , tdInputSchema =
            object
                [ "type" .= ("object" :: Text)
                , "properties"
                    .= object
                        [ "filePath"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("Absolute path to the file or directory" :: Text)
                                ]
                        , "offset"
                            .= object
                                [ "type" .= ("number" :: Text)
                                , "description" .= ("Line number to start from (1-indexed)" :: Text)
                                ]
                        , "limit"
                            .= object
                                [ "type" .= ("number" :: Text)
                                , "description" .= ("Maximum lines to read (default 2000)" :: Text)
                                ]
                        ]
                , "required" .= (["filePath"] :: [Text])
                ]
        }

writeDef :: ToolDef
writeDef =
    ToolDef
        { tdName = "write"
        , tdDescription = "Write content to a file. Creates the file if it doesn't exist, overwrites if it does."
        , tdInputSchema =
            object
                [ "type" .= ("object" :: Text)
                , "properties"
                    .= object
                        [ "filePath"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("Absolute path to the file to write" :: Text)
                                ]
                        , "content"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("Content to write to the file" :: Text)
                                ]
                        ]
                , "required" .= (["filePath", "content"] :: [Text])
                ]
        }

editDef :: ToolDef
editDef =
    ToolDef
        { tdName = "edit"
        , tdDescription = "Edit a file by replacing oldString with newString. Use replaceAll to replace all occurrences."
        , tdInputSchema =
            object
                [ "type" .= ("object" :: Text)
                , "properties"
                    .= object
                        [ "filePath"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("Absolute path to the file to edit" :: Text)
                                ]
                        , "oldString"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("Text to replace" :: Text)
                                ]
                        , "newString"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("Replacement text" :: Text)
                                ]
                        , "replaceAll"
                            .= object
                                [ "type" .= ("boolean" :: Text)
                                , "description" .= ("Replace all occurrences (default false)" :: Text)
                                ]
                        ]
                , "required" .= (["filePath", "oldString", "newString"] :: [Text])
                ]
        }

bashDef :: ToolDef
bashDef =
    ToolDef
        { tdName = "bash"
        , tdDescription = "Execute a bash command. Returns stdout/stderr and exit code."
        , tdInputSchema =
            object
                [ "type" .= ("object" :: Text)
                , "properties"
                    .= object
                        [ "command"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("The command to execute" :: Text)
                                ]
                        , "description"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("Short description of what this command does" :: Text)
                                ]
                        , "timeout"
                            .= object
                                [ "type" .= ("number" :: Text)
                                , "description" .= ("Timeout in milliseconds" :: Text)
                                ]
                        , "workdir"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("Working directory for command" :: Text)
                                ]
                        ]
                , "required" .= (["command", "description"] :: [Text])
                ]
        }

globDef :: ToolDef
globDef =
    ToolDef
        { tdName = "glob"
        , tdDescription = "Find files matching a glob pattern. Returns file paths sorted by modification time."
        , tdInputSchema =
            object
                [ "type" .= ("object" :: Text)
                , "properties"
                    .= object
                        [ "pattern"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("Glob pattern like **/*.ts or src/**/*.hs" :: Text)
                                ]
                        , "path"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("Directory to search in" :: Text)
                                ]
                        ]
                , "required" .= (["pattern"] :: [Text])
                ]
        }

grepDef :: ToolDef
grepDef =
    ToolDef
        { tdName = "grep"
        , tdDescription = "Search file contents using regex. Returns matching file paths and line numbers."
        , tdInputSchema =
            object
                [ "type" .= ("object" :: Text)
                , "properties"
                    .= object
                        [ "pattern"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("Regex pattern to search for" :: Text)
                                ]
                        , "path"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("Directory to search in" :: Text)
                                ]
                        , "include"
                            .= object
                                [ "type" .= ("string" :: Text)
                                , "description" .= ("File pattern filter like *.ts or *.{ts,tsx}" :: Text)
                                ]
                        ]
                , "required" .= (["pattern"] :: [Text])
                ]
        }
