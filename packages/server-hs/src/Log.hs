{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

{- | Structured logging with Katip

Provides JSON-formatted structured logging for the OpenCode server.
All log output goes to stdout in JSON format for easy parsing.
-}
module Log (
    -- * Environment
    Logger,
    newLogger,
    newLoggerWithLevel,
    closeLogger,
    withLogger,
    withLoggerLevel,

    -- * Logging functions
    logInfo,
    logWarn,
    logError,
    logDebug,
    logMsg,

    -- * Context
    withNS,
) where

import Control.Exception (bracket)
import Data.Text (Text)
import Katip hiding (logMsg)
import System.IO (stdout)

-- | Logger containing Katip state
data Logger = Logger
    { lgEnv :: LogEnv
    , lgContext :: LogContexts
    , lgNamespace :: Namespace
    }

{- | Create a new logger
Logs to stdout in JSON format
-}
newLogger :: Text -> IO Logger
newLogger appName = newLoggerWithLevel appName DebugS

-- | Create a new logger with a minimum severity level
newLoggerWithLevel :: Text -> Severity -> IO Logger
newLoggerWithLevel appName level = do
    handleScribe <- mkHandleScribeWithFormatter jsonFormat ColorIfTerminal stdout (permitItem level) V2
    le <- initLogEnv (Namespace [appName]) "production"
    le' <- registerScribe "stdout" handleScribe defaultScribeSettings le
    pure
        Logger
            { lgEnv = le'
            , lgContext = mempty
            , lgNamespace = Namespace [appName]
            }

-- | Close the logger
closeLogger :: Logger -> IO ()
closeLogger lg = closeScribes (lgEnv lg) >> pure ()

-- | Bracket for logger lifecycle
withLogger :: Text -> (Logger -> IO a) -> IO a
withLogger appName = bracket (newLogger appName) closeLogger

-- | Bracket for logger lifecycle with minimum severity level
withLoggerLevel :: Text -> Severity -> (Logger -> IO a) -> IO a
withLoggerLevel appName level = bracket (newLoggerWithLevel appName level) closeLogger

-- | Log at INFO level with payload
logInfo :: (LogItem a) => Logger -> Text -> a -> IO ()
logInfo lg msg payload = runLog lg InfoS msg payload

-- | Log at WARNING level with payload
logWarn :: (LogItem a) => Logger -> Text -> a -> IO ()
logWarn lg msg payload = runLog lg WarningS msg payload

-- | Log at ERROR level with payload
logError :: (LogItem a) => Logger -> Text -> a -> IO ()
logError lg msg payload = runLog lg ErrorS msg payload

-- | Log at DEBUG level with payload
logDebug :: (LogItem a) => Logger -> Text -> a -> IO ()
logDebug lg msg payload = runLog lg DebugS msg payload

-- | Simple message logging (no structured payload)
logMsg :: Logger -> Severity -> Text -> IO ()
logMsg lg sev msg =
    runKatipContextT (lgEnv lg) (lgContext lg) (lgNamespace lg) $
        logLocM sev (logStr msg)

-- | Internal: run a log action with payload
runLog :: (LogItem a) => Logger -> Severity -> Text -> a -> IO ()
runLog lg sev msg payload =
    runKatipContextT (lgEnv lg) (lgContext lg <> liftPayload payload) (lgNamespace lg) $
        logLocM sev (logStr msg)

-- | Add namespace context for a block of logging
withNS :: Logger -> Text -> Logger
withNS lg ns = lg{lgNamespace = lgNamespace lg <> Namespace [ns]}
