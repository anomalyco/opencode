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
import System.Directory (doesFileExist)
import System.FilePath (takeDirectory, (</>))

diagKey :: [Text]
diagKey = ["lsp", "diagnostics"]

getDiagnostics :: Storage.StorageConfig -> IO [Value]
getDiagnostics storage = do
    result <- (Just <$> Storage.read storage diagKey) `catch` \(Storage.NotFoundError _) -> pure Nothing
    case result of
        Just (Array xs) -> pure (toList xs)
        _ -> getDiagnosticsFile storage

setDiagnostics :: Storage.StorageConfig -> [Value] -> IO ()
setDiagnostics storage values =
    Storage.write storage diagKey (Aeson.toJSON values)

getDiagnosticsFile :: Storage.StorageConfig -> IO [Value]
getDiagnosticsFile storage = do
    let dir = Storage.storageDir storage
    readFromPaths (diagnosticPaths dir)

diagnosticPaths :: FilePath -> [FilePath]
diagnosticPaths dir =
    [ dir </> "lsp" </> "diagnostics.json"
    , dir </> "diagnostics.json"
    , takeDirectory dir </> "lsp" </> "diagnostics.json"
    , takeDirectory dir </> "diagnostics.json"
    ]

readFromPaths :: [FilePath] -> IO [Value]
readFromPaths [] = pure []
readFromPaths (path : rest) = do
    exists <- doesFileExist path
    if not exists
        then readFromPaths rest
        else do
            result <- Aeson.eitherDecodeFileStrict path
            case result of
                Right (Array xs) -> pure (toList xs)
                _ -> readFromPaths rest
