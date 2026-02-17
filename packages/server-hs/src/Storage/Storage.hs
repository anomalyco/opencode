{-# LANGUAGE OverloadedStrings #-}

{- | Storage module - JSON file-based persistence
Mirrors the TypeScript Storage namespace
-}
module Storage.Storage (
    read,
    write,
    update,
    remove,
    list,
    NotFoundError (..),
    withStorage,
    StorageConfig (..),
) where

import Control.Exception (Exception, catch, throwIO)
import Control.Monad (forM, when)
import Data.Aeson (FromJSON, ToJSON, eitherDecodeFileStrict, encodeFile)
import Data.Text (Text)
import Data.Text qualified as T
import System.Directory
import System.FilePath (dropExtension, splitDirectories, takeDirectory, (</>))
import System.IO.Error (isDoesNotExistError)
import Prelude hiding (read)

-- | Storage configuration
data StorageConfig = StorageConfig
    { storageDir :: FilePath
    }
    deriving (Show, Eq)

-- | Not found error
newtype NotFoundError = NotFoundError {notFoundPath :: FilePath}
    deriving (Show, Eq)

instance Exception NotFoundError

-- | Initialize storage with a base directory
withStorage :: FilePath -> (StorageConfig -> IO a) -> IO a
withStorage dir action = do
    createDirectoryIfMissing True dir
    action (StorageConfig dir)

-- | Build the full path for a key
keyPath :: StorageConfig -> [Text] -> FilePath
keyPath cfg key = storageDir cfg </> foldr (</>) "" (map T.unpack key) <> ".json"

-- | Read a JSON value from storage
read :: (FromJSON a) => StorageConfig -> [Text] -> IO a
read cfg key = do
    let target = keyPath cfg key
    result <- eitherDecodeFileStrict target `catch` handleNotFound target
    case result of
        Left err -> fail $ "JSON decode error: " <> err
        Right val -> pure val
  where
    handleNotFound :: FilePath -> IOError -> IO (Either String a)
    handleNotFound target e
        | isDoesNotExistError e = throwIO (NotFoundError target)
        | otherwise = throwIO e

-- | Write a JSON value to storage
write :: (ToJSON a) => StorageConfig -> [Text] -> a -> IO ()
write cfg key content = do
    let target = keyPath cfg key
    createDirectoryIfMissing True (takeDirectory target)
    encodeFile target content

-- | Update a JSON value in storage
update :: (FromJSON a, ToJSON a) => StorageConfig -> [Text] -> (a -> a) -> IO a
update cfg key fn = do
    val <- read cfg key
    let updated = fn val
    write cfg key updated
    pure updated

-- | Remove a value from storage
remove :: StorageConfig -> [Text] -> IO ()
remove cfg key = do
    let target = keyPath cfg key
    removeFile target `catch` \e ->
        when (not $ isDoesNotExistError e) $ throwIO e

-- | List all keys with a given prefix
list :: StorageConfig -> [Text] -> IO [[Text]]
list cfg prefix = do
    let dir = storageDir cfg </> foldr (</>) "" (map T.unpack prefix)
    exists <- doesDirectoryExist dir
    if not exists
        then pure []
        else do
            files <- listDirectoryRecursive dir
            let jsonFiles = filter (\f -> takeExtension f == (".json" :: String)) files
            pure $ map (toKey prefix dir) jsonFiles
  where
    takeExtension f = case reverse f of
        'n' : 'o' : 's' : 'j' : '.' : _ -> ".json"
        _ -> ""

    toKey pfx base file =
        let rel = drop (length base + 1) file
            parts = splitDirectories (dropExtension rel)
         in pfx ++ map T.pack parts

-- | Recursively list all files in a directory
listDirectoryRecursive :: FilePath -> IO [FilePath]
listDirectoryRecursive dir = do
    contents <- listDirectory dir
    paths <- forM contents $ \name -> do
        let path = dir </> name
        isDir <- doesDirectoryExist path
        if isDir
            then listDirectoryRecursive path
            else pure [path]
    pure (concat paths)
