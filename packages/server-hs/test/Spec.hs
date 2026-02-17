-- | Main test runner for opencode-server
module Main where

import Property.BusProps qualified as BusProps
import Property.ConfigProps qualified as ConfigProps
import Property.DiffProps qualified as DiffProps
import Property.ExperimentalProps qualified as ExperimentalProps
import Property.FormatterProps qualified as FormatterProps
import Property.FindParseProps qualified as FindParseProps
import Property.HealthProps qualified as HealthProps
import Property.LLMProps qualified as LLMProps
import Property.LspProps qualified as LspProps
import Property.MessagePartProps qualified as MessagePartProps
import Property.MessageProps qualified as MessageProps
import Property.OAuthProps qualified as OAuthProps
import Property.ProjectProps qualified as ProjectProps
import Property.ProjectDiscoveryProps qualified as ProjectDiscoveryProps
import Property.ProviderProps qualified as ProviderProps
import Property.PtyProps qualified as PtyProps
import Property.RequestProps qualified as RequestProps
import Property.SessionProps qualified as SessionProps
import Property.SessionStatusProps qualified as SessionStatusProps
import Property.SkillProps qualified as SkillProps
import Property.StorageProps qualified as StorageProps
import Property.TodoProps qualified as TodoProps
import Property.ToolProps qualified as ToolProps
import Property.TuiProps qualified as TuiProps
import Property.VcsStatusProps qualified as VcsStatusProps
import Property.PathProps qualified as PathProps
import Test.Tasty
import Test.Tasty.Hspec
import Unit.ApiSpec qualified as ApiSpec

main :: IO ()
main = do
    apiTests <- testSpec "API Unit Tests" ApiSpec.spec
    defaultMain $
        testGroup
            "All Tests"
            [ testGroup
                "Property Tests"
                [ StorageProps.tests
                , BusProps.tests
                , ConfigProps.tests
                , DiffProps.tests
                , FormatterProps.tests
                , FindParseProps.tests
                , ExperimentalProps.tests
                , HealthProps.tests
                , PathProps.tests
                , SessionProps.tests
                , SessionStatusProps.tests
                , SkillProps.tests
                , ToolProps.tests
                , MessageProps.tests
                , MessagePartProps.tests
                , OAuthProps.tests
                , LLMProps.tests
                , LspProps.tests
                , ProviderProps.tests
                , PtyProps.tests
                , ProjectProps.tests
                , ProjectDiscoveryProps.tests
                , RequestProps.tests
                , TodoProps.tests
                , VcsStatusProps.tests
                , TuiProps.tests
                ]
            , apiTests
            ]
