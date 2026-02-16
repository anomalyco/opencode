-- | Main test runner for opencode-server
module Main where

import Property.BusProps qualified as BusProps
import Property.ConfigProps qualified as ConfigProps
import Property.LLMProps qualified as LLMProps
import Property.MessageProps qualified as MessageProps
import Property.ProviderProps qualified as ProviderProps
import Property.SessionProps qualified as SessionProps
import Property.StorageProps qualified as StorageProps
import Property.ToolProps qualified as ToolProps
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
          [ StorageProps.tests,
            BusProps.tests,
            ConfigProps.tests,
            SessionProps.tests,
            ToolProps.tests,
            MessageProps.tests,
            LLMProps.tests,
            ProviderProps.tests
          ],
        apiTests
      ]
