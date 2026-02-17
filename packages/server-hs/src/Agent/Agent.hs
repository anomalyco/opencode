{-# LANGUAGE OverloadedStrings #-}

{- | Agent module - agent management
Mirrors the TypeScript Agent namespace
-}
module Agent.Agent (
    -- * Types
    Agent.Types.Agent (..),
    Agent.Types.AgentMode (..),
    Agent.Types.PermissionRuleset (..),
    Agent.Types.PermissionAction (..),

    -- * Operations
    list,
    get,

    -- * Built-in agents
    builtinAgents,
) where

import Data.Map.Strict qualified as Map
import Data.Text (Text)

import Agent.Types

-- | Built-in agent definitions
builtinAgents :: [Agent]
builtinAgents =
    [ Agent
        { agentName = "armed"
        , agentDescription = Just "The default agent. Executes tools based on configured permissions."
        , agentMode = Primary
        , agentNative = Just True
        , agentHidden = Nothing
        , agentTopP = Nothing
        , agentTemperature = Nothing
        , agentColor = Nothing
        , agentPermission =
            PermissionRuleset $
                Map.fromList
                    [ ("*", [PermissionRule Allow Nothing])
                    , ("doom_loop", [PermissionRule Ask Nothing])
                    , ("question", [PermissionRule Allow Nothing])
                    , ("plan_enter", [PermissionRule Allow Nothing])
                    ]
        , agentModel = Nothing
        , agentVariant = Nothing
        , agentPrompt = Nothing
        , agentOptions = Map.empty
        , agentSteps = Nothing
        }
    , Agent
        { agentName = "locked"
        , agentDescription = Just "Locked mode. Disallows all edit tools."
        , agentMode = Primary
        , agentNative = Just True
        , agentHidden = Nothing
        , agentTopP = Nothing
        , agentTemperature = Nothing
        , agentColor = Nothing
        , agentPermission =
            PermissionRuleset $
                Map.fromList
                    [ ("*", [PermissionRule Allow Nothing])
                    , ("edit", [PermissionRule Deny Nothing])
                    , ("write", [PermissionRule Deny Nothing])
                    , ("question", [PermissionRule Allow Nothing])
                    , ("plan_exit", [PermissionRule Allow Nothing])
                    ]
        , agentModel = Nothing
        , agentVariant = Nothing
        , agentPrompt = Nothing
        , agentOptions = Map.empty
        , agentSteps = Nothing
        }
    , Agent
        { agentName = "general"
        , agentDescription = Just "General-purpose agent for researching complex questions and executing multi-step tasks."
        , agentMode = Subagent
        , agentNative = Just True
        , agentHidden = Nothing
        , agentTopP = Nothing
        , agentTemperature = Nothing
        , agentColor = Nothing
        , agentPermission =
            PermissionRuleset $
                Map.fromList
                    [ ("*", [PermissionRule Allow Nothing])
                    , ("todoread", [PermissionRule Deny Nothing])
                    , ("todowrite", [PermissionRule Deny Nothing])
                    ]
        , agentModel = Nothing
        , agentVariant = Nothing
        , agentPrompt = Nothing
        , agentOptions = Map.empty
        , agentSteps = Nothing
        }
    , Agent
        { agentName = "explore"
        , agentDescription = Just "Fast agent specialized for exploring codebases."
        , agentMode = Subagent
        , agentNative = Just True
        , agentHidden = Nothing
        , agentTopP = Nothing
        , agentTemperature = Nothing
        , agentColor = Nothing
        , agentPermission =
            PermissionRuleset $
                Map.fromList
                    [ ("*", [PermissionRule Deny Nothing])
                    , ("grep", [PermissionRule Allow Nothing])
                    , ("glob", [PermissionRule Allow Nothing])
                    , ("read", [PermissionRule Allow Nothing])
                    , ("bash", [PermissionRule Allow Nothing])
                    , ("webfetch", [PermissionRule Allow Nothing])
                    ]
        , agentModel = Nothing
        , agentVariant = Nothing
        , agentPrompt = Just "You are an explore agent. Your job is to quickly search and analyze codebases."
        , agentOptions = Map.empty
        , agentSteps = Nothing
        }
    , Agent
        { agentName = "compaction"
        , agentDescription = Nothing
        , agentMode = Primary
        , agentNative = Just True
        , agentHidden = Just True
        , agentTopP = Nothing
        , agentTemperature = Nothing
        , agentColor = Nothing
        , agentPermission = PermissionRuleset $ Map.singleton "*" [PermissionRule Deny Nothing]
        , agentModel = Nothing
        , agentVariant = Nothing
        , agentPrompt = Just "You are a compaction agent. Summarize the conversation concisely."
        , agentOptions = Map.empty
        , agentSteps = Nothing
        }
    , Agent
        { agentName = "title"
        , agentDescription = Nothing
        , agentMode = Primary
        , agentNative = Just True
        , agentHidden = Just True
        , agentTopP = Nothing
        , agentTemperature = Just 0.5
        , agentColor = Nothing
        , agentPermission = PermissionRuleset $ Map.singleton "*" [PermissionRule Deny Nothing]
        , agentModel = Nothing
        , agentVariant = Nothing
        , agentPrompt = Just "Generate a concise title for this conversation."
        , agentOptions = Map.empty
        , agentSteps = Nothing
        }
    , Agent
        { agentName = "summary"
        , agentDescription = Nothing
        , agentMode = Primary
        , agentNative = Just True
        , agentHidden = Just True
        , agentTopP = Nothing
        , agentTemperature = Nothing
        , agentColor = Nothing
        , agentPermission = PermissionRuleset $ Map.singleton "*" [PermissionRule Deny Nothing]
        , agentModel = Nothing
        , agentVariant = Nothing
        , agentPrompt = Just "Summarize this session."
        , agentOptions = Map.empty
        , agentSteps = Nothing
        }
    ]

-- | List all agents
list :: IO [Agent]
list = pure builtinAgents

-- | Get an agent by name
get :: Text -> IO (Maybe Agent)
get name = do
    agents <- list
    pure $ lookup name [(agentName a, a) | a <- agents]
