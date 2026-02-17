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
) where

import Data.Aeson
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

-- | Full config
data Config = Config
    { cfgKeybinds :: Maybe KeybindsConfig
    , cfgServer :: Maybe ServerConfig
    , cfgLayout :: Maybe LayoutConfig
    , cfgProvider :: Maybe (Map.Map Text ProviderConfig)
    , cfgAgent :: Maybe (Map.Map Text AgentConfig)
    , cfgPermission :: Maybe PermissionConfig
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
            <*> v .:? "model"
            <*> v .:? "share"
            <*> v .:? "theme"
            <*> v .:? "instructions"
            <*> v .:? "plugin"
