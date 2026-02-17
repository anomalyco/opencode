{-# LANGUAGE OverloadedStrings #-}

module Provider.OAuth (
    generateState,
    buildAuthorizeUrl,
) where

import Data.Text (Text)
import Data.Text qualified as T
import Data.Word (Word64)
import Numeric (showHex)
import System.Random (randomIO)

generateState :: IO Text
generateState = do
    n <- randomIO :: IO Word64
    pure $ T.pack (showHex n "")

buildAuthorizeUrl :: Text -> Text -> Maybe Text -> [Text] -> Text
buildAuthorizeUrl providerId state redirect scopes =
    let base = "https://auth.opencode.ai/oauth/" <> providerId
        params =
            [ ("state", state)
            ]
                <> maybe [] (\r -> [("redirect_uri", r)]) redirect
                <> scopeParams scopes
     in base <> "?" <> renderParams params
  where
    scopeParams xs = case xs of
        [] -> []
        _ -> [("scope", T.intercalate "," xs)]

renderParams :: [(Text, Text)] -> Text
renderParams params =
    T.intercalate "&" (map (\(k, v) -> k <> "=" <> v) params)
