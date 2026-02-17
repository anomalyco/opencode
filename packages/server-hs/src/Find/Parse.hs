{-# LANGUAGE OverloadedStrings #-}

module Find.Parse (
    parseRgLine,
    parseFdLine,
) where

import Data.Text (Text)
import Data.Text qualified as T

parseRgLine :: Text -> Maybe (Text, Int, Text)
parseRgLine line = do
    let (path, rest) = T.breakOn ":" line
    let rest' = T.drop 1 rest
    let (lineTxt, text) = T.breakOn ":" rest'
    case (T.null path, T.null rest', T.null lineTxt) of
        (True, _, _) -> Nothing
        (_, True, _) -> Nothing
        (_, _, True) -> Nothing
        _ -> do
            case reads (T.unpack lineTxt) of
                [(n, "")] -> Just (path, n, T.drop 1 text)
                _ -> Nothing

parseFdLine :: Text -> Maybe Text
parseFdLine line =
    case T.strip line of
        "" -> Nothing
        trimmed -> Just trimmed
