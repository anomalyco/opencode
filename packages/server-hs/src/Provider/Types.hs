{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

{- | Provider type definitions
Mirrors the TypeScript Provider namespace
-}
module Provider.Types (
    Provider (..),
    Model (..),
    ModelCost (..),
    ProviderAuth (..),
    AuthMethod (..),
)
where

import Data.Aeson
import Data.Map.Strict qualified as Map
import Data.Text (Text)
import GHC.Generics (Generic)

-- | Model cost information
data ModelCost = ModelCost
    { mcInput :: Double -- Cost per million input tokens
    , mcOutput :: Double -- Cost per million output tokens
    , mcCacheRead :: Maybe Double
    , mcCacheWrite :: Maybe Double
    }
    deriving (Show, Eq, Generic)

instance ToJSON ModelCost where
    toJSON mc =
        object
            [ "input" .= mcInput mc
            , "output" .= mcOutput mc
            , "cacheRead" .= mcCacheRead mc
            , "cacheWrite" .= mcCacheWrite mc
            ]

instance FromJSON ModelCost where
    parseJSON = withObject "ModelCost" $ \v ->
        ModelCost
            <$> v .: "input"
            <*> v .: "output"
            <*> v .:? "cacheRead"
            <*> v .:? "cacheWrite"

-- | Model information
data Model = Model
    { modelId :: Text
    , modelName :: Text
    , modelProviderID :: Text
    , modelContextLength :: Maybe Int
    , modelMaxOutput :: Maybe Int
    , modelCost :: ModelCost
    , modelCapabilities :: Map.Map Text Bool
    , modelAttachment :: Maybe [Text] -- Supported attachment types
    , modelOptions :: Maybe (Map.Map Text Value)
    }
    deriving (Show, Eq, Generic)

instance ToJSON Model where
    toJSON m =
        object
            [ "id" .= modelId m
            , "name" .= modelName m
            , "providerID" .= modelProviderID m
            , "contextLength" .= modelContextLength m
            , "maxOutput" .= modelMaxOutput m
            , "cost" .= modelCost m
            , "capabilities" .= modelCapabilities m
            , "attachment" .= modelAttachment m
            , "options" .= modelOptions m
            ]

instance FromJSON Model where
    parseJSON = withObject "Model" $ \v ->
        Model
            <$> v .: "id"
            <*> v .: "name"
            <*> v .: "providerID"
            <*> v .:? "contextLength"
            <*> v .:? "maxOutput"
            <*> v .: "cost"
            <*> v .:? "capabilities" .!= Map.empty
            <*> v .:? "attachment"
            <*> v .:? "options"

-- | Auth method for a provider
data AuthMethod = AuthMethod
    { amType :: Text -- "api_key" | "oauth"
    , amEnvVars :: [Text]
    , amUrl :: Maybe Text
    }
    deriving (Show, Eq, Generic)

instance ToJSON AuthMethod where
    toJSON am =
        object
            [ "type" .= amType am
            , "envVars" .= amEnvVars am
            , "url" .= amUrl am
            ]

instance FromJSON AuthMethod where
    parseJSON = withObject "AuthMethod" $ \v ->
        AuthMethod
            <$> v .: "type"
            <*> v .:? "envVars" .!= []
            <*> v .:? "url"

-- | Provider information
data Provider = Provider
    { providerId :: Text
    , providerName :: Text
    , providerIcon :: Maybe Text
    , providerModels :: Map.Map Text Model
    , providerAuth :: [AuthMethod]
    , providerEnv :: [Text]
    , providerOptions :: Maybe (Map.Map Text Value)
    }
    deriving (Show, Eq, Generic)

instance ToJSON Provider where
    toJSON p =
        object
            [ "id" .= providerId p
            , "name" .= providerName p
            , "icon" .= providerIcon p
            , "models" .= providerModels p
            , "auth" .= providerAuth p
            , "env" .= providerEnv p
            , "options" .= providerOptions p
            ]

instance FromJSON Provider where
    parseJSON = withObject "Provider" $ \v ->
        Provider
            <$> v .: "id"
            <*> v .: "name"
            <*> v .:? "icon"
            <*> v .:? "models" .!= Map.empty
            <*> v .:? "auth" .!= []
            <*> v .:? "env" .!= []
            <*> v .:? "options"

-- | Provider auth status
data ProviderAuth = ProviderAuth
    { paProviderID :: Text
    , paAuthenticated :: Bool
    , paMethod :: Maybe Text
    }
    deriving (Show, Eq, Generic)

instance ToJSON ProviderAuth where
    toJSON pa =
        object
            [ "providerID" .= paProviderID pa
            , "authenticated" .= paAuthenticated pa
            , "method" .= paMethod pa
            ]

instance FromJSON ProviderAuth where
    parseJSON = withObject "ProviderAuth" $ \v ->
        ProviderAuth
            <$> v .: "providerID"
            <*> v .: "authenticated"
            <*> v .:? "method"
