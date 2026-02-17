{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

{- | Anthropic API client

Handles both streaming and non-streaming requests to Claude.
-}
module LLM.Anthropic (
    -- * Client
    AnthropicClient (..),
    newClient,

    -- * API Calls
    chat,
    chatStream,
) where

import Control.Exception (SomeException, try)
import Control.Monad (when)
import Data.Aeson (Value (..), decode, eitherDecode, encode, parseJSON, (.:))
import Data.Aeson.Types (parseMaybe)
import Data.ByteString (ByteString)
import Data.IORef
import Data.Text (Text)
import Data.Text.Encoding (decodeUtf8, encodeUtf8)

import Data.ByteString qualified as BS
import Data.ByteString.Char8 qualified as C8
import Data.ByteString.Lazy qualified as LBS
import Data.Text qualified as T
import Network.HTTP.Client qualified as HC
import Network.HTTP.Client.TLS qualified as HCT
import Network.HTTP.Types qualified as HT

import LLM.Types

-- | Anthropic API client
data AnthropicClient = AnthropicClient
    { acApiKey :: Text
    , acManager :: HC.Manager
    , acBaseUrl :: Text
    }

-- | Create a new Anthropic client
newClient :: Text -> IO AnthropicClient
newClient apiKey = do
    manager <- HC.newManager HCT.tlsManagerSettings
    pure
        AnthropicClient
            { acApiKey = apiKey
            , acManager = manager
            , acBaseUrl = "https://api.anthropic.com"
            }

-- | Non-streaming chat completion
chat :: AnthropicClient -> ChatRequest -> IO (Either Text ChatResponse)
chat client req = do
    let reqBody = encode req{crStream = False}

    result <- makeRequest client "/v1/messages" reqBody

    case result of
        Left err -> pure $ Left err
        Right body -> case eitherDecode body of
            Left parseErr -> pure $ Left $ "Parse error: " <> T.pack parseErr
            Right resp -> pure $ Right resp

{- | Streaming chat completion
Returns an action that yields events until MessageStop
-}
chatStream :: AnthropicClient -> ChatRequest -> (StreamEvent -> IO ()) -> IO (Either Text ())
chatStream client req onEvent = do
    let reqBody = encode req{crStream = True}

    initReq <- HC.parseRequest $ T.unpack (acBaseUrl client) <> "/v1/messages"
    let httpReq =
            initReq
                { HC.method = "POST"
                , HC.requestHeaders =
                    [ ("Content-Type", "application/json")
                    , ("x-api-key", encodeUtf8 $ acApiKey client)
                    , ("anthropic-version", "2023-06-01")
                    ]
                , HC.requestBody = HC.RequestBodyLBS reqBody
                }

    result <- try @SomeException $ HC.withResponse httpReq (acManager client) $ \resp -> do
        let status = HC.responseStatus resp
        when (HT.statusCode status /= 200) $ do
            body <- HC.brConsume $ HC.responseBody resp
            error $ "API error: " <> show status <> " " <> show body

        -- Parse SSE stream
        bufferRef <- newIORef ""
        let loop = do
                chunk <- HC.brRead $ HC.responseBody resp
                if BS.null chunk
                    then pure ()
                    else do
                        buffer <- readIORef bufferRef
                        let fullBuffer = buffer <> chunk
                        -- Process complete events
                        (remaining, events) <- parseSSE fullBuffer
                        writeIORef bufferRef remaining
                        mapM_ onEvent events
                        -- Check if we got MessageStop
                        if any isMessageStop events
                            then pure ()
                            else loop
        loop

    case result of
        Left e -> pure $ Left $ T.pack $ show e
        Right () -> pure $ Right ()

-- | Make an HTTP request to Anthropic API
makeRequest :: AnthropicClient -> Text -> LBS.ByteString -> IO (Either Text LBS.ByteString)
makeRequest AnthropicClient{..} path body = do
    initReq <- HC.parseRequest $ T.unpack acBaseUrl <> T.unpack path
    let req =
            initReq
                { HC.method = "POST"
                , HC.requestHeaders =
                    [ ("Content-Type", "application/json")
                    , ("x-api-key", encodeUtf8 acApiKey)
                    , ("anthropic-version", "2023-06-01")
                    ]
                , HC.requestBody = HC.RequestBodyLBS body
                }

    result <- try @SomeException $ HC.httpLbs req acManager

    case result of
        Left e -> pure $ Left $ T.pack $ show e
        Right resp -> do
            let status = HC.responseStatus resp
            if HT.statusCode status == 200
                then pure $ Right $ HC.responseBody resp
                else
                    pure $
                        Left $
                            "API error "
                                <> T.pack (show $ HT.statusCode status)
                                <> ": "
                                <> decodeUtf8 (LBS.toStrict $ HC.responseBody resp)

{- | Parse SSE events from buffer
Returns (remaining buffer, parsed events)
-}
parseSSE :: ByteString -> IO (ByteString, [StreamEvent])
parseSSE buffer = do
    let chunks = C8.lines buffer
    go chunks [] ""
  where
    go [] events remaining = pure (remaining, reverse events)
    go (l : ls) events _
        | "data: " `BS.isPrefixOf` l = do
            let jsonPart = BS.drop 6 l
            case parseEvent jsonPart of
                Just event -> go ls (event : events) ""
                Nothing -> go ls events l -- Keep unparsed line
        | "event: " `BS.isPrefixOf` l = go ls events "" -- Skip event type lines
        | BS.null l = go ls events "" -- Empty line = event boundary
        | otherwise = go ls events l -- Incomplete line

-- | Parse a single SSE event from JSON
parseEvent :: ByteString -> Maybe StreamEvent
parseEvent bs = do
    json <- decode (LBS.fromStrict bs)
    parseStreamEvent json

-- | Parse stream event from JSON Value
parseStreamEvent :: Value -> Maybe StreamEvent
parseStreamEvent json = flip parseMaybe json $ \case
    Object obj -> do
        typ <- obj .: "type"
        case typ :: Text of
            "message_start" -> do
                msg <- obj .: "message"
                MessageStart <$> parseJSON msg
            "content_block_start" -> do
                idx <- obj .: "index"
                block <- obj .: "content_block"
                ContentBlockStart idx <$> parseJSON block
            "content_block_delta" -> do
                idx <- obj .: "index"
                delta <- obj .: "delta"
                txt <- delta .: "text"
                pure $ ContentBlockDelta idx txt
            "content_block_stop" -> do
                idx <- obj .: "index"
                pure $ ContentBlockStop idx
            "message_delta" -> do
                delta <- obj .: "delta"
                stopReason <- delta .: "stop_reason"
                usage <- obj .: "usage"
                pure $ MessageDelta stopReason usage
            "message_stop" -> pure MessageStop
            "ping" -> pure Ping
            _ -> fail "Unknown event type"
    _ -> fail "Not an object"

-- | Check if event is MessageStop
isMessageStop :: StreamEvent -> Bool
isMessageStop MessageStop = True
isMessageStop _ = False
