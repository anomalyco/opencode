{-# LANGUAGE OverloadedStrings #-}

module Pty.Parse (
    parseInput,
) where

import Data.Aeson (Result (..), Value, fromJSON)
import Pty.Types

parseInput :: Value -> CreatePtyInput
parseInput input = case fromJSON input of
    Success value -> value
    Error _ -> CreatePtyInput Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
