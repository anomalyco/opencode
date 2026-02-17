{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Formatter.Status (
    FormatterStatus (..),
    statusFor,
    statusForConfig,
    baseFormatters,
    formattersFor,
) where

import Config.Config qualified as Config
import Config.Types qualified as CT
import Data.Aeson (ToJSON (..), object, (.=))
import Data.Map.Strict qualified as Map
import Data.Maybe (fromMaybe)
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
statusFor dir = do
    cfg <- Config.get dir
    statusForConfig dir cfg

statusForConfig :: FilePath -> CT.Config -> IO [FormatterStatus]
statusForConfig dir cfg = mapM (toStatus dir) (formattersFor cfg)

toStatus :: FilePath -> FormatterInfo -> IO FormatterStatus
toStatus dir info = do
    enabled <- fiEnabled info dir
    pure $
        FormatterStatus
            { fsName = fiName info
            , fsExtensions = fiExtensions info
            , fsEnabled = enabled
            }

formattersFor :: CT.Config -> [FormatterInfo]
formattersFor cfg = case CT.cfgFormatter cfg of
    Just CT.FormatterDisabled -> []
    Just (CT.FormatterConfig entries) -> Map.elems (applyEntries entries baseMap)
    Nothing -> baseFormatters
  where
    baseMap = Map.fromList (map (\info -> (fiName info, info)) baseFormatters)
    applyEntries entries base = foldl applyEntry base (Map.toList entries)
    applyEntry acc (name, entry)
        | CT.feDisabled entry == Just True = Map.delete name acc
        | otherwise = case Map.lookup name acc of
            Just info ->
                let updated =
                        info
                            { fiExtensions = fromMaybe (fiExtensions info) (CT.feExtensions entry)
                            , fiEnabled = if hasCommand entry then const (pure True) else fiEnabled info
                            }
                 in Map.insert name updated acc
            Nothing -> case CT.feCommand entry of
                Just cmd
                    | not (null cmd) ->
                        let info =
                                FormatterInfo
                                    { fiName = name
                                    , fiExtensions = fromMaybe [] (CT.feExtensions entry)
                                    , fiEnabled = const (pure True)
                                    }
                         in Map.insert name info acc
                _ -> acc
    hasCommand entry = case CT.feCommand entry of
        Just cmd -> not (null cmd)
        Nothing -> False

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
