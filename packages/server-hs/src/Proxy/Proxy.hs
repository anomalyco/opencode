{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

{- | MITM Proxy for full-take surveillance of LLM API traffic

Architecture:
  Sandbox ──HTTP_PROXY──▶ Proxy ──HTTPS──▶ api.anthropic.com
                            │
                            ├── TLS termination (dynamic certs)
                            ├── Full request/response logging
                            ├── SSE stream capture
                            └── Token counting

Every request/response logged to JSONL for audit.
-}
module Proxy.Proxy (
    -- * Proxy Server
    ProxyServer,
    start,
    stop,

    -- * Logging
    getSessionLogs,
    getTokenUsage,
) where

import Control.Concurrent (ThreadId, forkIO, killThread)
import Control.Concurrent.STM
import Control.Exception (SomeException, try)
import Control.Monad (forM_)
import Data.Aeson (Value (..), decode, encode, (.:), (.:?))
import Data.Aeson.Types (parseMaybe)
import Data.CaseInsensitive (original)
import Data.Map.Strict (Map)
import Data.Maybe (catMaybes, fromMaybe)
import Data.Text (Text)
import Data.Text.Encoding (decodeUtf8)
import Data.Time (diffUTCTime, getCurrentTime)
import Network.HTTP.Types
import Network.Wai
import Network.Wai.Handler.Warp (run)
import System.Directory (createDirectoryIfMissing)

import Data.ByteString qualified as BS
import Data.ByteString.Char8 qualified as C8
import Data.ByteString.Lazy qualified as LBS
import Data.Map.Strict qualified as Map
import Data.Text qualified as T
import Network.HTTP.Client qualified as HC
import Network.HTTP.Client.TLS qualified as HCT

import Proxy.Types

-- | Running proxy server
data ProxyServer = ProxyServer
    { psState :: ProxyState
    , psManager :: HC.Manager
    , psThread :: ThreadId
    , psLogFile :: FilePath
    }

-- | Start the MITM proxy
start :: ProxyConfig -> IO ProxyServer
start config = do
    -- Setup log directory
    createDirectoryIfMissing True (pcLogDir config)

    -- Create HTTP manager for outbound requests
    manager <- HC.newManager HCT.tlsManagerSettings

    -- Initialize state
    requestCount <- newTVarIO 0
    tokenTotals <- newTVarIO Map.empty

    let state =
            ProxyState
                { psConfig = config
                , psRequestCount = requestCount
                , psTokenTotals = tokenTotals
                }

    let logFile = pcLogDir config <> "/requests.jsonl"

    -- Start proxy server
    tid <- forkIO $ run (pcPort config) (proxyApp state manager logFile)

    pure
        ProxyServer
            { psState = state
            , psManager = manager
            , psThread = tid
            , psLogFile = logFile
            }

-- | Stop the proxy
stop :: ProxyServer -> IO ()
stop ProxyServer{..} = killThread psThread

-- | The proxy WAI application
proxyApp :: ProxyState -> HC.Manager -> FilePath -> Application
proxyApp state manager logFile req respond = do
    let method = requestMethod req

    -- Handle CONNECT for HTTPS tunneling
    if method == "CONNECT"
        then handleConnect state manager logFile req respond
        else handleHttp state manager logFile req respond

-- | Handle regular HTTP requests (non-CONNECT)
handleHttp :: ProxyState -> HC.Manager -> FilePath -> Application
handleHttp state manager logFile req respond = do
    startTime <- getCurrentTime
    let method = requestMethod req

    -- Extract session ID from header (injected by sandbox)
    let sessionId =
            fromMaybe "unknown" $
                decodeUtf8 <$> lookup "X-Opencode-Session" (requestHeaders req)

    -- Generate request ID
    reqId <- atomically $ do
        n <- readTVar (psRequestCount state)
        writeTVar (psRequestCount state) (n + 1)
        pure $ "req_" <> T.pack (show n)

    -- Read request body
    body <- strictRequestBody req
    let bodyText =
            if LBS.length body > 0
                then
                    Just $
                        decodeUtf8 $
                            LBS.toStrict $
                                LBS.take (fromIntegral $ pcMaxBodyLog $ psConfig state) body
                else Nothing

    -- Build outbound request
    -- For proxy requests, reconstruct full URL from Host header + path
    let host = fromMaybe "unknown" $ decodeUtf8 <$> requestHeaderHost req
        path = rawPathInfo req <> rawQueryString req
        url =
            if "http" `BS.isPrefixOf` path
                then T.unpack $ decodeUtf8 path -- Already full URL
                else "http://" <> T.unpack host <> T.unpack (decodeUtf8 path)

    -- Log request
    let reqLog =
            RequestLog
                { rlHeaders = Map.fromList [(decodeUtf8 (original k), decodeUtf8 v) | (k, v) <- requestHeaders req]
                , rlBody = bodyText
                , rlSize = fromIntegral $ LBS.length body
                }

    -- Forward request
    outReq <- HC.parseRequest url
    let outReq' =
            outReq
                { HC.method = method
                , HC.requestHeaders = filter (not . isHopHeader . fst) (requestHeaders req)
                , HC.requestBody = HC.RequestBodyLBS body
                }

    -- Execute and capture response
    result <- try @SomeException $ HC.httpLbs outReq' manager

    endTime <- getCurrentTime
    let duration = realToFrac (diffUTCTime endTime startTime) * 1000

    case result of
        Left _ -> do
            -- Log failed request
            let entry =
                    LogEntry
                        { leTimestamp = startTime
                        , leSessionId = sessionId
                        , leRequestId = reqId
                        , leMethod = decodeUtf8 method
                        , leUrl = T.pack url
                        , leHost = host
                        , leRequest = reqLog
                        , leResponse = Nothing
                        , leTokens = Nothing
                        , leDuration = duration
                        }
            appendLog logFile entry

            respond $ responseLBS status502 [] "Proxy error"
        Right resp -> do
            let respBody = HC.responseBody resp
                respStatus = HC.responseStatus resp
                respHeaders = HC.responseHeaders resp
                isStream =
                    maybe False ("text/event-stream" `BS.isInfixOf`) $
                        lookup "content-type" respHeaders

            -- Parse token usage from response
            tokens <- parseTokenUsage host respBody

            -- Update session totals
            forM_ tokens $ \t ->
                atomically $
                    modifyTVar' (psTokenTotals state) $
                        Map.insertWith addTokens sessionId t

            -- Log response
            let respLog =
                    ResponseLog
                        { rsStatus = statusCode respStatus
                        , rsHeaders = Map.fromList [(decodeUtf8 (original k), decodeUtf8 v) | (k, v) <- respHeaders]
                        , rsBody =
                            Just $
                                decodeUtf8 $
                                    LBS.toStrict $
                                        LBS.take (fromIntegral $ pcMaxBodyLog $ psConfig state) respBody
                        , rsSize = fromIntegral $ LBS.length respBody
                        , rsStream = isStream
                        }

            let entry =
                    LogEntry
                        { leTimestamp = startTime
                        , leSessionId = sessionId
                        , leRequestId = reqId
                        , leMethod = decodeUtf8 method
                        , leUrl = T.pack url
                        , leHost = host
                        , leRequest = reqLog
                        , leResponse = Just respLog
                        , leTokens = tokens
                        , leDuration = duration
                        }
            appendLog logFile entry

            -- Forward response
            respond $
                responseLBS
                    respStatus
                    (filter (not . isHopHeader . fst) respHeaders)
                    respBody

-- | Handle CONNECT requests (HTTPS tunneling with MITM)
handleConnect :: ProxyState -> HC.Manager -> FilePath -> Application
handleConnect _state _manager _logFile req respond = do
    -- For now, just tunnel without MITM
    -- Full MITM requires dynamic cert generation
    -- TODO: Implement proper TLS interception

    let _host = C8.unpack $ rawPathInfo req

    -- For HTTPS MITM, we'd need to:
    -- 1. Generate cert for target host signed by our CA
    -- 2. Accept TLS from client with that cert
    -- 3. Open TLS to real server
    -- 4. Proxy and log all data

    -- For now, respond with 200 and note this needs work
    respond $
        responseLBS
            status200
            [("Content-Type", "text/plain")]
            "CONNECT tunneling - MITM TLS not yet implemented"

-- | Check if header should not be forwarded
isHopHeader :: HeaderName -> Bool
isHopHeader h =
    h
        `elem` [ "connection"
               , "keep-alive"
               , "proxy-authenticate"
               , "proxy-authorization"
               , "te"
               , "trailer"
               , "transfer-encoding"
               , "upgrade"
               ]

-- | Parse token usage from LLM API response
parseTokenUsage :: Text -> LBS.ByteString -> IO (Maybe TokenUsage)
parseTokenUsage host body = do
    let mJson = decode body :: Maybe Value
    case mJson of
        Nothing -> pure Nothing -- Not JSON or SSE
        Just json -> pure $ parseTokensFromJson host json

parseTokensFromJson :: Text -> Value -> Maybe TokenUsage
parseTokensFromJson host json = flip parseMaybe json $ \case
    Object obj -> do
        -- Try Anthropic format
        if "anthropic" `T.isInfixOf` host
            then do
                usage <- obj .: "usage"
                inputTokens <- usage .: "input_tokens"
                outputTokens <- usage .: "output_tokens"
                cacheRead <- usage .:? "cache_read_input_tokens"
                cacheWrite <- usage .:? "cache_creation_input_tokens"
                model <- obj .: "model"
                pure
                    TokenUsage
                        { tuProvider = "anthropic"
                        , tuModel = model
                        , tuInputTokens = inputTokens
                        , tuOutputTokens = outputTokens
                        , tuCacheRead = cacheRead
                        , tuCacheWrite = cacheWrite
                        }
            -- Try OpenAI format
            else
                if "openai" `T.isInfixOf` host
                    then do
                        usage <- obj .: "usage"
                        inputTokens <- usage .: "prompt_tokens"
                        outputTokens <- usage .: "completion_tokens"
                        model <- obj .: "model"
                        pure
                            TokenUsage
                                { tuProvider = "openai"
                                , tuModel = model
                                , tuInputTokens = inputTokens
                                , tuOutputTokens = outputTokens
                                , tuCacheRead = Nothing
                                , tuCacheWrite = Nothing
                                }
                    else fail "Unknown provider"
    _ -> fail "Not an object"

-- | Add token counts
addTokens :: TokenUsage -> TokenUsage -> TokenUsage
addTokens a b =
    a
        { tuInputTokens = tuInputTokens a + tuInputTokens b
        , tuOutputTokens = tuOutputTokens a + tuOutputTokens b
        , tuCacheRead = (+) <$> tuCacheRead a <*> tuCacheRead b
        , tuCacheWrite = (+) <$> tuCacheWrite a <*> tuCacheWrite b
        }

-- | Append a log entry to the JSONL file
appendLog :: FilePath -> LogEntry -> IO ()
appendLog path entry = do
    let line = LBS.toStrict (encode entry) <> "\n"
    BS.appendFile path line

-- | Get logs for a session
getSessionLogs :: ProxyServer -> Text -> IO [LogEntry]
getSessionLogs ProxyServer{..} sessionId = do
    content <- BS.readFile psLogFile
    let chunks = C8.lines content
        entries = catMaybes [decode (LBS.fromStrict l) | l <- chunks]
    pure [e | e <- entries, leSessionId e == sessionId]

-- | Get token usage totals
getTokenUsage :: ProxyServer -> IO (Map Text TokenUsage)
getTokenUsage ProxyServer{..} = readTVarIO (psTokenTotals psState)
