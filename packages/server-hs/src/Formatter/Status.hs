{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Formatter.Status (
    FormatterStatus (..),
    statusFor,
    baseFormatters,
) where

import Data.Aeson (ToJSON (..), object, (.=))
import Data.Text (Text)
import GHC.Generics (Generic)
import System.Directory (findExecutable)

data FormatterInfo = FormatterInfo
    { fiName :: Text
    , fiExtensions :: [Text]
    , fiEnabled :: FilePath -> IO Bool
    }

data FormatterStatus = FormatterStatus
    { fsName :: Text
    , fsExtensions :: [Text]
    , fsEnabled :: Bool
    }
    deriving (Show, Eq, Generic)

instance ToJSON FormatterStatus where
    toJSON status =
        object
            [ "name" .= fsName status
            , "extensions" .= fsExtensions status
            , "enabled" .= fsEnabled status
            ]

statusFor :: FilePath -> IO [FormatterStatus]
statusFor dir = mapM (toStatus dir) baseFormatters

toStatus :: FilePath -> FormatterInfo -> IO FormatterStatus
toStatus dir info = do
    enabled <- fiEnabled info dir
    pure $
        FormatterStatus
            { fsName = fiName info
            , fsExtensions = fiExtensions info
            , fsEnabled = enabled
            }

baseFormatters :: [FormatterInfo]
baseFormatters =
    [ FormatterInfo "gofmt" [".go"] (hasExecutable "gofmt")
    , FormatterInfo "mix" [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"] (hasExecutable "mix")
    , FormatterInfo "prettier" prettierExtensions (hasExecutable "prettier")
    , FormatterInfo "oxfmt" [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"] (hasExecutable "oxfmt")
    , FormatterInfo "biome" prettierExtensions (hasExecutable "biome")
    , FormatterInfo "zig" [".zig", ".zon"] (hasExecutable "zig")
    , FormatterInfo "clang-format" clangExtensions (hasExecutable "clang-format")
    , FormatterInfo "ktlint" [".kt", ".kts"] (hasExecutable "ktlint")
    , FormatterInfo "ruff" [".py", ".pyi"] (hasExecutable "ruff")
    ]
  where
    prettierExtensions =
        [ ".js"
        , ".jsx"
        , ".mjs"
        , ".cjs"
        , ".ts"
        , ".tsx"
        , ".mts"
        , ".cts"
        , ".html"
        , ".htm"
        , ".css"
        , ".scss"
        , ".sass"
        , ".less"
        , ".vue"
        , ".svelte"
        , ".json"
        , ".jsonc"
        , ".yaml"
        , ".yml"
        , ".toml"
        , ".xml"
        , ".md"
        , ".mdx"
        , ".graphql"
        , ".gql"
        ]
    clangExtensions =
        [ ".c"
        , ".cc"
        , ".cpp"
        , ".cxx"
        , ".c++"
        , ".h"
        , ".hh"
        , ".hpp"
        , ".hxx"
        , ".h++"
        , ".ino"
        , ".C"
        , ".H"
        ]

hasExecutable :: String -> FilePath -> IO Bool
hasExecutable exe _ = do
    result <- findExecutable exe
    pure $ case result of
        Nothing -> False
        Just _ -> True
