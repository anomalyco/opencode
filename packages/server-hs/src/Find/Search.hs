{-# LANGUAGE OverloadedStrings #-}

module Find.Search
  ( findText
  , findFile
  , findSymbol
  ) where

import Data.Aeson (Value, object, (.=))
import Data.Text (Text)
import Data.Text qualified as T
import System.Directory (findExecutable)
import System.Exit (ExitCode(..))
import System.Process (readProcessWithExitCode)

import Find.Parse

findText :: FilePath -> Text -> IO [Value]
findText root query = do
  runRg root query

findSymbol :: FilePath -> Text -> IO [Value]
findSymbol root query = do
  runRg root query

findFile :: FilePath -> Text -> IO [Value]
findFile root pattern = do
  exe <- findExecutable "fd"
  case exe of
    Nothing -> pure []
    Just _ -> do
      (code, out, _) <- readProcessWithExitCode "fd" ["--type", "f", "--glob", T.unpack pattern, root] ""
      case code of
        ExitSuccess -> pure $ map toValue $ mapMaybe parseFdLine (T.lines (T.pack out))
        _ -> pure []
  where
    mapMaybe f = foldr (\x acc -> case f x of
        Nothing -> acc
        Just v -> v : acc) []
    toValue path = object ["path" .= path]

runRg :: FilePath -> Text -> IO [Value]
runRg root query = do
  (code, out, _) <- readProcessWithExitCode "rg" ["--line-number", "--no-heading", "--color", "never", T.unpack query, root] ""
  case code of
    ExitSuccess -> pure $ map toValue $ mapMaybe parseRgLine (T.lines (T.pack out))
    ExitFailure _ -> pure []
  where
    mapMaybe f = foldr (\x acc -> case f x of
        Nothing -> acc
        Just v -> v : acc) []
    toValue (path, lineNum, text) = object ["path" .= path, "line" .= lineNum, "text" .= text]
