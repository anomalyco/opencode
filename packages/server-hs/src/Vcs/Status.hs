{-# LANGUAGE OverloadedStrings #-}

module Vcs.Status (
    FileStatus (..),
    parsePorcelain,
    loadBranch,
    loadStatus,
) where

import Data.Aeson (ToJSON (..), object, (.=))
import Data.Text (Text)
import Data.Text qualified as T
import System.Directory (findExecutable)
import System.Exit (ExitCode (..))
import System.Process (readProcessWithExitCode)

data FileStatus = FileStatus
    { fsPath :: Text
    , fsStatus :: Text
    }
    deriving (Eq, Show)

instance ToJSON FileStatus where
    toJSON s =
        object
            [ "path" .= fsPath s
            , "status" .= fsStatus s
            ]

parsePorcelain :: Text -> [FileStatus]
parsePorcelain input =
    map toStatus $ filter (not . T.null) (T.lines input)
  where
    toStatus line =
        let (code, rest) = T.splitAt 2 line
            pathRaw = T.dropWhile (== ' ') rest
            path = parsePath pathRaw
         in FileStatus path (codeStatus code)

    parsePath raw =
        case T.splitOn " -> " raw of
            [] -> raw
            parts -> last parts

    codeStatus code
        | code == "??" = "untracked"
        | "U" `T.isInfixOf` code = "unmerged"
        | "A" `T.isInfixOf` code = "added"
        | "D" `T.isInfixOf` code = "deleted"
        | "R" `T.isInfixOf` code = "renamed"
        | "C" `T.isInfixOf` code = "copied"
        | "M" `T.isInfixOf` code = "modified"
        | otherwise = "unknown"

loadStatus :: FilePath -> IO [FileStatus]
loadStatus root = do
    exe <- findExecutable "git"
    case exe of
        Nothing -> pure []
        Just _ -> do
            (code, out, _) <- readProcessWithExitCode "git" ["-C", root, "status", "--porcelain"] ""
            case code of
                ExitSuccess -> pure (parsePorcelain (T.pack out))
                _ -> pure []

loadBranch :: FilePath -> IO (Maybe Text)
loadBranch root = do
    exe <- findExecutable "git"
    case exe of
        Nothing -> pure Nothing
        Just _ -> do
            result <- readBranch root
            case result of
                Just name -> pure (Just name)
                Nothing -> do
                    (code, out, _) <- readProcessWithExitCode "git" ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"] ""
                    case code of
                        ExitSuccess -> do
                            let name = T.strip (T.pack out)
                            case name of
                                "" -> pure Nothing
                                "HEAD" -> pure Nothing
                                _ -> pure (Just name)
                        _ -> pure Nothing

readBranch :: FilePath -> IO (Maybe Text)
readBranch root = do
    (code, out, _) <- readProcessWithExitCode "git" ["-C", root, "symbolic-ref", "--short", "HEAD"] ""
    case code of
        ExitSuccess -> do
            let name = T.strip (T.pack out)
            case name of
                "" -> pure Nothing
                _ -> pure (Just name)
        _ -> pure Nothing
