{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

{- | Agent type definitions
Mirrors the TypeScript Agent namespace
-}
module Agent.Types (
    Agent (..),
    AgentMode (..),
    PermissionRuleset (..),
    PermissionRule (..),
    PermissionAction (..),
) where

import Data.Aeson
import Data.Map.Strict qualified as Map
import Data.Text (Text)
import GHC.Generics (Generic)

-- | Permission action
data PermissionAction = Allow | Deny | Ask
    deriving (Show, Eq, Generic)

instance ToJSON PermissionAction where
    toJSON Allow = String "allow"
    toJSON Deny = String "deny"
    toJSON Ask = String "ask"

instance FromJSON PermissionAction where
    parseJSON = withText "PermissionAction" $ \case
        "allow" -> pure Allow
        "deny" -> pure Deny
        "ask" -> pure Ask
        _ -> fail "Invalid permission action"

-- | Permission rule
data PermissionRule = PermissionRule
    { prAction :: PermissionAction
    , prGlob :: Maybe Text
    }
    deriving (Show, Eq, Generic)

instance ToJSON PermissionRule where
    toJSON pr =
        object
            [ "action" .= prAction pr
            , "glob" .= prGlob pr
            ]

instance FromJSON PermissionRule where
    parseJSON = withObject "PermissionRule" $ \v ->
        PermissionRule
            <$> v .: "action"
            <*> v .:? "glob"

-- | Permission ruleset
newtype PermissionRuleset = PermissionRuleset
    { unRuleset :: Map.Map Text [PermissionRule]
    }
    deriving (Show, Eq, Generic)

instance ToJSON PermissionRuleset where
    toJSON (PermissionRuleset m) = toJSON m

instance FromJSON PermissionRuleset where
    parseJSON v = PermissionRuleset <$> parseJSON v

-- | Agent mode
data AgentMode = Subagent | Primary | AllModes
    deriving (Show, Eq, Generic)

instance ToJSON AgentMode where
    toJSON Subagent = String "subagent"
    toJSON Primary = String "primary"
    toJSON AllModes = String "all"

instance FromJSON AgentMode where
    parseJSON = withText "AgentMode" $ \case
        "subagent" -> pure Subagent
        "primary" -> pure Primary
        "all" -> pure AllModes
        _ -> fail "Invalid agent mode"

-- | Agent information
data Agent = Agent
    { agentName :: Text
    , agentDescription :: Maybe Text
    , agentMode :: AgentMode
    , agentNative :: Maybe Bool
    , agentHidden :: Maybe Bool
    , agentTopP :: Maybe Double
    , agentTemperature :: Maybe Double
    , agentColor :: Maybe Text
    , agentPermission :: PermissionRuleset
    , agentModel :: Maybe (Text, Text) -- (providerID, modelID)
    , agentVariant :: Maybe Text
    , agentPrompt :: Maybe Text
    , agentOptions :: Map.Map Text Value
    , agentSteps :: Maybe Int
    }
    deriving (Show, Eq, Generic)

instance ToJSON Agent where
    toJSON a =
        object
            [ "name" .= agentName a
            , "description" .= agentDescription a
            , "mode" .= agentMode a
            , "native" .= agentNative a
            , "hidden" .= agentHidden a
            , "topP" .= agentTopP a
            , "temperature" .= agentTemperature a
            , "color" .= agentColor a
            , "permission" .= agentPermission a
            , "model" .= fmap (\(p, m) -> object ["providerID" .= p, "modelID" .= m]) (agentModel a)
            , "variant" .= agentVariant a
            , "prompt" .= agentPrompt a
            , "options" .= agentOptions a
            , "steps" .= agentSteps a
            ]

instance FromJSON Agent where
    parseJSON = withObject "Agent" $ \v ->
        Agent
            <$> v .: "name"
            <*> v .:? "description"
            <*> v .: "mode"
            <*> v .:? "native"
            <*> v .:? "hidden"
            <*> v .:? "topP"
            <*> v .:? "temperature"
            <*> v .:? "color"
            <*> v .:? "permission" .!= PermissionRuleset Map.empty
            <*> v .:? "model"
            <*> v .:? "variant"
            <*> v .:? "prompt"
            <*> v .:? "options" .!= Map.empty
            <*> v .:? "steps"
