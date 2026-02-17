{-# LANGUAGE OverloadedStrings #-}

module Vcs.Diff (
    parseNumstat,
    loadDiff,
) where

import Data.Char (isDigit)
import Data.Text (Text)
import Data.Text qualified as T
import Session.Types qualified as ST
import System.Exit (ExitCode (..))
import System.Process (readProcessWithExitCode)

parseNumstat :: Text -> ST.SessionSummary
parseNumstat input =
    let entries = filter (not . T.null) (T.lines input)
        parts = map (T.splitOn "\t") entries
        stats = map toStat parts
        adds = sum (map fst stats)
        dels = sum (map snd stats)
        count = length stats
     in ST.SessionSummary adds dels (Just count)
  where
    toStat fields = case fields of
        (addTxt : delTxt : _) -> (readInt addTxt, readInt delTxt)
        _ -> (0, 0)
    readInt txt =
        if T.all isDigit txt
            then case reads (T.unpack txt) of
                [(n, "")] -> n
                _ -> 0
            else 0

loadDiff :: FilePath -> IO (Maybe (Text, ST.SessionSummary))
loadDiff root = do
    (diffCode, diffOut, _) <- readProcessWithExitCode "git" ["-C", root, "diff", "--no-color"] ""
    (numCode, numOut, _) <- readProcessWithExitCode "git" ["-C", root, "diff", "--numstat"] ""
    case (diffCode, numCode) of
        (ExitSuccess, ExitSuccess) ->
            pure $ Just (T.pack diffOut, parseNumstat (T.pack numOut))
        _ -> pure Nothing
