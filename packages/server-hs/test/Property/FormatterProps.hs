{-# LANGUAGE OverloadedStrings #-}

module Property.FormatterProps where

import Config.Config qualified as Config
import Config.Types qualified as CT
import Data.List (nub)
import Data.Map.Strict qualified as Map
import Formatter.Status (FormatterStatus (..), statusFor, statusForConfig)
import Hedgehog
import Test.Tasty
import Test.Tasty.Hedgehog

prop_uniqueNames :: Property
prop_uniqueNames = property $ do
    statuses <- evalIO $ statusFor "."
    let names = map fsName statuses
    length names === length (nub names)

prop_extensionsNonEmpty :: Property
prop_extensionsNonEmpty = property $ do
    statuses <- evalIO $ statusFor "."
    assert $ all (not . null) (map fsExtensions statuses)

prop_formatterDisabled :: Property
prop_formatterDisabled = property $ do
    statuses <- evalIO $ statusForConfig "." (Config.defaultConfig{CT.cfgFormatter = Just CT.FormatterDisabled})
    statuses === []

prop_customFormatterIncluded :: Property
prop_customFormatterIncluded = property $ do
    let entry =
            CT.FormatterEntry
                { CT.feDisabled = Nothing
                , CT.feCommand = Just ["custom"]
                , CT.feEnvironment = Nothing
                , CT.feExtensions = Just [".x"]
                }
    let cfg =
            Config.defaultConfig
                { CT.cfgFormatter = Just (CT.FormatterConfig (Map.fromList [("custom", entry)]))
                }
    statuses <- evalIO $ statusForConfig "." cfg
    assert $ any (\status -> fsName status == "custom" && fsEnabled status) statuses

prop_disableBaseFormatter :: Property
prop_disableBaseFormatter = property $ do
    let entry =
            CT.FormatterEntry
                { CT.feDisabled = Just True
                , CT.feCommand = Nothing
                , CT.feEnvironment = Nothing
                , CT.feExtensions = Nothing
                }
    let cfg =
            Config.defaultConfig
                { CT.cfgFormatter = Just (CT.FormatterConfig (Map.fromList [("gofmt", entry)]))
                }
    statuses <- evalIO $ statusForConfig "." cfg
    assert $ all (\status -> fsName status /= "gofmt") statuses

prop_overrideExtensions :: Property
prop_overrideExtensions = property $ do
    let entry =
            CT.FormatterEntry
                { CT.feDisabled = Nothing
                , CT.feCommand = Nothing
                , CT.feEnvironment = Nothing
                , CT.feExtensions = Just [".x"]
                }
    let cfg =
            Config.defaultConfig
                { CT.cfgFormatter = Just (CT.FormatterConfig (Map.fromList [("gofmt", entry)]))
                }
    statuses <- evalIO $ statusForConfig "." cfg
    assert $ any (\status -> fsName status == "gofmt" && fsExtensions status == [".x"]) statuses

tests :: TestTree
tests =
    testGroup
        "Formatter Property Tests"
        [ testProperty "unique names" prop_uniqueNames
        , testProperty "extensions non-empty" prop_extensionsNonEmpty
        , testProperty "formatter disabled" prop_formatterDisabled
        , testProperty "custom formatter included" prop_customFormatterIncluded
        , testProperty "disable base formatter" prop_disableBaseFormatter
        , testProperty "override extensions" prop_overrideExtensions
        ]
