{-# LANGUAGE OverloadedStrings #-}

{- | Config module - configuration loading and management
Mirrors the TypeScript Config namespace
-}
module Config.Config (
    -- * Types
    Config.Types.Config (..),

    -- * Operations
    get,
    load,
    loadFile,
    globalConfigPath,
    projectConfigPath,

    -- * Defaults
    defaultConfig,

    -- * Merging
    mergeConfig,
)
where

import Config.Types
import Data.Aeson (eitherDecodeFileStrict)
import System.Directory (doesFileExist, getHomeDirectory)
import System.FilePath ((</>))

-- | Default empty config
defaultConfig :: Config
defaultConfig =
    Config
        { cfgKeybinds = Nothing
        , cfgServer = Nothing
        , cfgLayout = Nothing
        , cfgProvider = Nothing
        , cfgAgent = Nothing
        , cfgPermission = Nothing
        , cfgSkills = Nothing
        , cfgFormatter = Nothing
        , cfgModel = Nothing
        , cfgShare = Nothing
        , cfgTheme = Nothing
        , cfgInstructions = Nothing
        , cfgPlugin = Nothing
        }

-- | Get global config path
globalConfigPath :: IO FilePath
globalConfigPath = do
    home <- getHomeDirectory
    pure $ home </> ".config" </> "weapon" </> "weapon.json"

-- | Get project config path
projectConfigPath :: FilePath -> FilePath
projectConfigPath dir = dir </> "weapon.json"

-- | Load config from a file
loadFile :: FilePath -> IO (Maybe Config)
loadFile path = do
    exists <- doesFileExist path
    if not exists
        then pure Nothing
        else do
            result <- eitherDecodeFileStrict path
            case result of
                Left _ -> pure Nothing
                Right cfg -> pure (Just cfg)

-- | Load config (tries global, then project)
load :: FilePath -> IO Config
load projectDir = do
    globalPath <- globalConfigPath
    let projectPath = projectConfigPath projectDir

    globalCfg <- loadFile globalPath
    projectCfg <- loadFile projectPath

    -- Merge configs (project overrides global)
    let base = maybe defaultConfig id globalCfg
    let merged = maybe base (mergeConfig base) projectCfg

    pure merged

-- | Merge two configs (second overrides first)
mergeConfig :: Config -> Config -> Config
mergeConfig base override =
    Config
        { cfgKeybinds = cfgKeybinds override <|> cfgKeybinds base
        , cfgServer = cfgServer override <|> cfgServer base
        , cfgLayout = cfgLayout override <|> cfgLayout base
        , cfgProvider = cfgProvider override <|> cfgProvider base
        , cfgAgent = cfgAgent override <|> cfgAgent base
        , cfgPermission = cfgPermission override <|> cfgPermission base
        , cfgSkills = cfgSkills override <|> cfgSkills base
        , cfgFormatter = cfgFormatter override <|> cfgFormatter base
        , cfgModel = cfgModel override <|> cfgModel base
        , cfgShare = cfgShare override <|> cfgShare base
        , cfgTheme = cfgTheme override <|> cfgTheme base
        , cfgInstructions = cfgInstructions override <|> cfgInstructions base
        , cfgPlugin = cfgPlugin override <|> cfgPlugin base
        }
  where
    (<|>) :: Maybe a -> Maybe a -> Maybe a
    (<|>) (Just x) _ = Just x
    (<|>) Nothing y = y

-- | Get config for current project
get :: FilePath -> IO Config
get = load
