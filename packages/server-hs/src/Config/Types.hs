{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

{- | Config type definitions
Mirrors the TypeScript Config namespace
-}
module Config.Types (
    Config (..),
    KeybindsConfig (..),
    ServerConfig (..),
    LayoutConfig (..),
    ProviderConfig (..),
    AgentConfig (..),
    PermissionConfig (..),
    SkillsConfig (..),
    FormatterEntry (..),
    FormatterConfig (..),
) where

import Data.Aeson
import Data.Aeson.Key qualified as Key
import Data.Aeson.KeyMap qualified as KM
import Data.Map.Strict qualified as Map
import Data.Text (Text)
import GHC.Generics (Generic)

-- | Keybinds configuration
data KeybindsConfig = KeybindsConfig
    { kbSubmit :: Maybe Text
    , kbCancel :: Maybe Text
    }
    deriving (Show, Eq, Generic)

instance ToJSON KeybindsConfig where
    toJSON kb =
        object
            [ "submit" .= kbSubmit kb
            , "cancel" .= kbCancel kb
            ]

instance FromJSON KeybindsConfig where
    parseJSON = withObject "KeybindsConfig" $ \v ->
        KeybindsConfig
            <$> v .:? "submit"
            <*> v .:? "cancel"

-- | Server configuration
data ServerConfig = ServerConfig
    { scHostname :: Maybe Text
    , scPort :: Maybe Int
    }
    deriving (Show, Eq, Generic)

instance ToJSON ServerConfig where
    toJSON sc =
        object
            [ "hostname" .= scHostname sc
            , "port" .= scPort sc
            ]

instance FromJSON ServerConfig where
    parseJSON = withObject "ServerConfig" $ \v ->
        ServerConfig
            <$> v .:? "hostname"
            <*> v .:? "port"

-- | Layout configuration
data LayoutConfig = LayoutConfig
    { lcTerminalRatio :: Maybe Double
    , lcSidebarVisible :: Maybe Bool
    }
    deriving (Show, Eq, Generic)

instance ToJSON LayoutConfig where
    toJSON lc =
        object
            [ "terminalRatio" .= lcTerminalRatio lc
            , "sidebarVisible" .= lcSidebarVisible lc
            ]

instance FromJSON LayoutConfig where
    parseJSON = withObject "LayoutConfig" $ \v ->
        LayoutConfig
            <$> v .:? "terminalRatio"
            <*> v .:? "sidebarVisible"

-- | Provider configuration
data ProviderConfig = ProviderConfig
    { pcDisabled :: Maybe Bool
    , pcOptions :: Maybe (Map.Map Text Value)
    }
    deriving (Show, Eq, Generic)

instance ToJSON ProviderConfig where
    toJSON pc =
        object
            [ "disabled" .= pcDisabled pc
            , "options" .= pcOptions pc
            ]

instance FromJSON ProviderConfig where
    parseJSON = withObject "ProviderConfig" $ \v ->
        ProviderConfig
            <$> v .:? "disabled"
            <*> v .:? "options"

-- | Agent configuration
data AgentConfig = AgentConfig
    { acModel :: Maybe Text
    , acPrompt :: Maybe Text
    , acPermission :: Maybe (Map.Map Text Value)
    }
    deriving (Show, Eq, Generic)

instance ToJSON AgentConfig where
    toJSON ac =
        object
            [ "model" .= acModel ac
            , "prompt" .= acPrompt ac
            , "permission" .= acPermission ac
            ]

instance FromJSON AgentConfig where
    parseJSON = withObject "AgentConfig" $ \v ->
        AgentConfig
            <$> v .:? "model"
            <*> v .:? "prompt"
            <*> v .:? "permission"

-- | Permission configuration
data PermissionConfig = PermissionConfig
    { permRules :: Map.Map Text Value
    }
    deriving (Show, Eq, Generic)

instance ToJSON PermissionConfig where
    toJSON pc = toJSON (permRules pc)

instance FromJSON PermissionConfig where
    parseJSON v = PermissionConfig <$> parseJSON v

-- | Skills configuration
data SkillsConfig = SkillsConfig
    { scPaths :: Maybe [Text]
    , scUrls :: Maybe [Text]
    }
    deriving (Show, Eq, Generic)

instance ToJSON SkillsConfig where
    toJSON sc =
        object
            [ "paths" .= scPaths sc
            , "urls" .= scUrls sc
            ]

instance FromJSON SkillsConfig where
    parseJSON = withObject "SkillsConfig" $ \v ->
        SkillsConfig
            <$> v .:? "paths"
            <*> v .:? "urls"

data FormatterEntry = FormatterEntry
    { feDisabled :: Maybe Bool
    , feCommand :: Maybe [Text]
    , feEnvironment :: Maybe (Map.Map Text Text)
    , feExtensions :: Maybe [Text]
    }
    deriving (Show, Eq, Generic)

instance ToJSON FormatterEntry where
    toJSON fe =
        object
            [ "disabled" .= feDisabled fe
            , "command" .= feCommand fe
            , "environment" .= feEnvironment fe
            , "extensions" .= feExtensions fe
            ]

instance FromJSON FormatterEntry where
    parseJSON = withObject "FormatterEntry" $ \v ->
        FormatterEntry
            <$> v .:? "disabled"
            <*> v .:? "command"
            <*> v .:? "environment"
            <*> v .:? "extensions"

data FormatterConfig
    = FormatterDisabled
    | FormatterConfig (Map.Map Text FormatterEntry)
    deriving (Show, Eq, Generic)

instance ToJSON FormatterConfig where
    toJSON FormatterDisabled = Bool False
    toJSON (FormatterConfig entries) = toJSON entries

instance FromJSON FormatterConfig where
    parseJSON v = case v of
        Bool False -> pure FormatterDisabled
        Object obj -> FormatterConfig <$> parseFormatterEntries obj
        _ -> fail "invalid formatter config"
      where
        parseFormatterEntries obj =
            Map.fromList
                <$> traverse
                    ( \(k, val) -> do
                        entry <- parseJSON val
                        pure (Key.toText k, entry)
                    )
                    (KM.toList obj)

-- | Full config
data Config = Config
    { cfgKeybinds :: Maybe KeybindsConfig
    , cfgServer :: Maybe ServerConfig
    , cfgLayout :: Maybe LayoutConfig
    , cfgProvider :: Maybe (Map.Map Text ProviderConfig)
    , cfgAgent :: Maybe (Map.Map Text AgentConfig)
    , cfgPermission :: Maybe PermissionConfig
    , cfgSkills :: Maybe SkillsConfig
    , cfgFormatter :: Maybe FormatterConfig
    , cfgModel :: Maybe Text
    , cfgShare :: Maybe Text -- "auto" | "manual" | "disabled"
    , cfgTheme :: Maybe Text
    , cfgInstructions :: Maybe [Text]
    , cfgPlugin :: Maybe [Text]
    }
    deriving (Show, Eq, Generic)

instance ToJSON Config where
    toJSON c =
        object
            [ "keybinds" .= cfgKeybinds c
            , "server" .= cfgServer c
            , "layout" .= cfgLayout c
            , "provider" .= cfgProvider c
            , "agent" .= cfgAgent c
            , "permission" .= cfgPermission c
            , "skills" .= cfgSkills c
            , "formatter" .= cfgFormatter c
            , "model" .= cfgModel c
            , "share" .= cfgShare c
            , "theme" .= cfgTheme c
            , "instructions" .= cfgInstructions c
            , "plugin" .= cfgPlugin c
            ]

instance FromJSON Config where
    parseJSON = withObject "Config" $ \v ->
        Config
            <$> v .:? "keybinds"
            <*> v .:? "server"
            <*> v .:? "layout"
            <*> v .:? "provider"
            <*> v .:? "agent"
            <*> v .:? "permission"
            <*> v .:? "skills"
            <*> v .:? "formatter"
            <*> v .:? "model"
            <*> v .:? "share"
            <*> v .:? "theme"
            <*> v .:? "instructions"
            <*> v .:? "plugin"
