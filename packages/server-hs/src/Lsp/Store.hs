{-# LANGUAGE OverloadedStrings #-}

module Lsp.Store (
    getDiagnostics,
    setDiagnostics,
) where

import Control.Exception (catch)
import Data.Aeson (Value (..))
import Data.Aeson qualified as Aeson
import Data.Foldable (toList)
import Data.Text (Text)
import Storage.Storage qualified as Storage

diagKey :: [Text]
diagKey = ["lsp", "diagnostics"]

getDiagnostics :: Storage.StorageConfig -> IO [Value]
getDiagnostics storage = do
    result <- (Just <$> Storage.read storage diagKey) `catch` \(Storage.NotFoundError _) -> pure Nothing
    case result of
        Just (Array xs) -> pure (toList xs)
        _ -> pure []

setDiagnostics :: Storage.StorageConfig -> [Value] -> IO ()
setDiagnostics storage values =
    Storage.write storage diagKey (Aeson.toJSON values)
