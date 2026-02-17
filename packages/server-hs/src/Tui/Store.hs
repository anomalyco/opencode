{-# LANGUAGE OverloadedStrings #-}

module Tui.Store (
    getPrompt,
    appendPrompt,
    clearPrompt,
    submitPrompt,
    setLast,
    getLast,
) where

import Control.Exception (catch)
import Data.Aeson (Value (..), object, (.=))
import Data.Text (Text)
import Storage.Storage qualified as Storage

promptKey :: [Text]
promptKey = ["tui", "prompt"]

lastKey :: [Text]
lastKey = ["tui", "last"]

getPrompt :: Storage.StorageConfig -> IO Text
getPrompt storage = do
    result <- (Just <$> Storage.read storage promptKey) `catch` \(Storage.NotFoundError _) -> pure Nothing
    case result of
        Just (String t) -> pure t
        _ -> pure ""

appendPrompt :: Storage.StorageConfig -> Text -> IO Text
appendPrompt storage text = do
    current <- getPrompt storage
    let next = current <> text
    Storage.write storage promptKey (String next)
    pure next

clearPrompt :: Storage.StorageConfig -> IO ()
clearPrompt storage = Storage.write storage promptKey (String "")

submitPrompt :: Storage.StorageConfig -> IO Text
submitPrompt storage = do
    current <- getPrompt storage
    Storage.write storage promptKey (String "")
    Storage.write storage ["tui", "submitted"] (object ["prompt" .= current])
    pure current

setLast :: Storage.StorageConfig -> Value -> IO ()
setLast storage value = Storage.write storage lastKey value

getLast :: Storage.StorageConfig -> IO (Maybe Value)
getLast storage = (Just <$> Storage.read storage lastKey) `catch` \(Storage.NotFoundError _) -> pure Nothing
