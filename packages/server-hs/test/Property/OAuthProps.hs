{-# LANGUAGE OverloadedStrings #-}

module Property.OAuthProps where

import Data.Text (Text)
import Data.Text qualified as T
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Provider.OAuth qualified as OAuth
import Test.Tasty
import Test.Tasty.Hedgehog

prop_buildAuthorizeUrlIncludesState :: Property
prop_buildAuthorizeUrlIncludesState = property $ do
    provider <- forAll genText
    state <- forAll genText
    let url = OAuth.buildAuthorizeUrl provider state Nothing []
    assert $ T.isInfixOf ("state=" <> state) url
    assert $ T.isInfixOf ("/" <> provider) url

prop_buildAuthorizeUrlIncludesRedirect :: Property
prop_buildAuthorizeUrlIncludesRedirect = property $ do
    provider <- forAll genText
    state <- forAll genText
    redirect <- forAll genText
    let url = OAuth.buildAuthorizeUrl provider state (Just redirect) []
    assert $ T.isInfixOf ("redirect_uri=" <> redirect) url

genText :: Gen Text
genText = Gen.text (Range.linear 1 12) Gen.alphaNum

tests :: TestTree
tests =
    testGroup
        "OAuth Property Tests"
        [ testProperty "build authorize url includes state" prop_buildAuthorizeUrlIncludesState
        , testProperty "build authorize url includes redirect" prop_buildAuthorizeUrlIncludesRedirect
        ]
