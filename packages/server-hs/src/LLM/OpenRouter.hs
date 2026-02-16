{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

-- | OpenRouter API client
--
-- OpenRouter provides a unified API for multiple LLM providers.
-- Uses OpenAI-compatible chat completions format.
--
module LLM.OpenRouter
  ( -- * Client
    Client(..)
  , newClient
    -- * API Calls
  , chat
  , chatStream
    -- * Types
  , ChatRequest(..)
  , ChatResponse(..)
  , Choice(..)
  , Message(..)
  , Role(..)
  , Usage(..)
  ) where

import Control.Exception (try, SomeException)
import Control.Monad (when)
import Data.Aeson
import Data.Aeson.Types (parseMaybe)
import Data.ByteString (ByteString)
import Data.Text (Text)
import Data.Text.Encoding (encodeUtf8, decodeUtf8)
import GHC.Generics (Generic)
import System.IO (hGetLine, hIsEOF)
import System.Process (createProcess, proc, std_out, std_err, StdStream(..), waitForProcess)

import qualified Data.ByteString as BS
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Lazy as LBS
import qualified Data.Text as T
import qualified Network.HTTP.Client as HC
import qualified Network.HTTP.Client.TLS as HCT
import qualified Network.HTTP.Types as HT

-- | Message role
data Role = User | Assistant | System
  deriving (Eq, Show, Generic)

instance ToJSON Role where
  toJSON User = "user"
  toJSON Assistant = "assistant"
  toJSON System = "system"

instance FromJSON Role where
  parseJSON = withText "Role" $ \case
    "user" -> pure User
    "assistant" -> pure Assistant
    "system" -> pure System
    _ -> fail "Unknown role"

-- | A chat message (OpenAI format)
data Message = Message
  { msgRole    :: Role
  , msgContent :: Text
  } deriving (Eq, Show, Generic)

instance ToJSON Message where
  toJSON Message{..} = object
    [ "role" .= msgRole
    , "content" .= msgContent
    ]

instance FromJSON Message where
  parseJSON = withObject "Message" $ \v -> Message
    <$> v .: "role"
    <*> v .: "content"

-- | Chat completion request (OpenAI format)
data ChatRequest = ChatRequest
  { crModel       :: Text
  , crMessages    :: [Message]
  , crMaxTokens   :: Maybe Int
  , crTemperature :: Maybe Double
  , crStream      :: Bool
  } deriving (Eq, Show, Generic)

instance ToJSON ChatRequest where
  toJSON ChatRequest{..} = object $ filter ((/= Null) . snd)
    [ "model" .= crModel
    , "messages" .= crMessages
    , "max_tokens" .= crMaxTokens
    , "temperature" .= crTemperature
    , "stream" .= crStream
    ]

-- | Token usage
data Usage = Usage
  { usagePromptTokens     :: Int
  , usageCompletionTokens :: Int
  , usageTotalTokens      :: Int
  } deriving (Eq, Show, Generic)

instance FromJSON Usage where
  parseJSON = withObject "Usage" $ \v -> Usage
    <$> v .:? "prompt_tokens" .!= 0
    <*> v .:? "completion_tokens" .!= 0
    <*> v .:? "total_tokens" .!= 0

instance ToJSON Usage where
  toJSON Usage{..} = object
    [ "prompt_tokens" .= usagePromptTokens
    , "completion_tokens" .= usageCompletionTokens
    , "total_tokens" .= usageTotalTokens
    ]

-- | Choice in response
data Choice = Choice
  { choiceIndex        :: Int
  , choiceMessage      :: Message
  , choiceFinishReason :: Maybe Text
  } deriving (Eq, Show, Generic)

instance FromJSON Choice where
  parseJSON = withObject "Choice" $ \v -> Choice
    <$> v .: "index"
    <*> v .: "message"
    <*> v .:? "finish_reason"

-- | Chat completion response (OpenAI format)
data ChatResponse = ChatResponse
  { respId      :: Text
  , respModel   :: Text
  , respChoices :: [Choice]
  , respUsage   :: Maybe Usage
  } deriving (Eq, Show, Generic)

instance FromJSON ChatResponse where
  parseJSON = withObject "ChatResponse" $ \v -> ChatResponse
    <$> v .: "id"
    <*> v .: "model"
    <*> v .: "choices"
    <*> v .:? "usage"

-- | OpenRouter API client
data Client = Client
  { clApiKey  :: Text
  , clManager :: HC.Manager
  , clBaseUrl :: Text
  }

-- | Create a new OpenRouter client
-- Uses standard hostname - will work if IPv6 is functional or system prefers IPv4
newClient :: Text -> IO Client
newClient apiKey = do
  let baseUrl = "https://openrouter.ai/api/v1"
  
  -- Configure TLS manager with extended timeout for streaming
  let settings = HCT.tlsManagerSettings
        { HC.managerResponseTimeout = HC.responseTimeoutMicro (120 * 1000000)  -- 120s timeout
        }
  manager <- HC.newManager settings
  pure Client
    { clApiKey = apiKey
    , clManager = manager
    , clBaseUrl = baseUrl
    }

-- | Non-streaming chat completion
chat :: Client -> ChatRequest -> IO (Either Text ChatResponse)
chat client req = do
  let reqBody = encode req { crStream = False }
  
  result <- makeRequest client "/chat/completions" reqBody
  
  case result of
    Left err -> pure $ Left err
    Right body -> case eitherDecode body of
      Left parseErr -> pure $ Left $ "Parse error: " <> T.pack parseErr <> " body: " <> decodeUtf8 (LBS.toStrict body)
      Right resp -> pure $ Right resp

-- | Streaming chat completion using curl (workaround for IPv6 issues)
-- Calls handler for each content delta
chatStream :: Client -> ChatRequest -> (Text -> IO ()) -> IO (Either Text ())
chatStream client req onDelta = do
  let reqBody = LBS.toStrict $ encode req { crStream = True }
  
  -- Use curl with IPv4 flag to avoid IPv6 timeout issues
  let curlArgs = 
        [ "-4"  -- Force IPv4
        , "-s"  -- Silent
        , "-N"  -- No buffering
        , "-X", "POST"
        , T.unpack (clBaseUrl client) <> "/chat/completions"
        , "-H", "Content-Type: application/json"
        , "-H", "Authorization: Bearer " <> T.unpack (clApiKey client)
        , "-H", "HTTP-Referer: https://opencode.ai"
        , "-H", "X-Title: opencode"
        , "-d", C8.unpack reqBody
        ]
  
  result <- try @SomeException $ do
    (_, Just hOut, _, ph) <- createProcess (proc "curl" curlArgs)
      { std_out = CreatePipe
      , std_err = CreatePipe
      }
    
    -- Read lines from curl output
    let readLoop = do
          eof <- hIsEOF hOut
          if eof
            then pure ()
            else do
              line <- hGetLine hOut
              -- Parse SSE line
              when (": OPENROUTER" `C8.isPrefixOf` C8.pack line) $ pure ()  -- Skip processing comments
              when ("data: " `C8.isPrefixOf` C8.pack line) $ do
                let jsonPart = C8.drop 6 (C8.pack line)
                case extractDelta jsonPart of
                  Just delta -> onDelta delta
                  Nothing -> pure ()
              if "data: [DONE]" `C8.isPrefixOf` C8.pack line
                then pure ()
                else readLoop
    
    readLoop
    _ <- waitForProcess ph
    pure ()
  
  case result of
    Left e -> pure $ Left $ T.pack $ show e
    Right () -> pure $ Right ()

-- | Make an HTTP request to OpenRouter API
makeRequest :: Client -> Text -> LBS.ByteString -> IO (Either Text LBS.ByteString)
makeRequest Client{..} path body = do
  initReq <- HC.parseRequest $ T.unpack clBaseUrl <> T.unpack path
  let req = initReq
        { HC.method = "POST"
        , HC.requestHeaders = 
            [ ("Host", "openrouter.ai")  -- Required when using IP address
            , ("Content-Type", "application/json")
            , ("Authorization", "Bearer " <> encodeUtf8 clApiKey)
            , ("HTTP-Referer", "https://opencode.ai")
            , ("X-Title", "opencode")
            ]
        , HC.requestBody = HC.RequestBodyLBS body
        }
  
  result <- try @SomeException $ HC.httpLbs req clManager
  
  case result of
    Left e -> pure $ Left $ T.pack $ show e
    Right resp -> do
      let status = HC.responseStatus resp
      if HT.statusCode status == 200
        then pure $ Right $ HC.responseBody resp
        else pure $ Left $ "API error " <> T.pack (show $ HT.statusCode status) 
                        <> ": " <> decodeUtf8 (LBS.toStrict $ HC.responseBody resp)

-- | Parse SSE chunk and extract content deltas
-- Returns (remaining buffer, list of delta texts)
parseSSEChunk :: ByteString -> (ByteString, [Text])
parseSSEChunk buffer = go (C8.lines buffer) [] ""
  where
    go [] deltas remaining = (remaining, reverse deltas)
    go (l:ls) deltas _
      | "data: [DONE]" `BS.isPrefixOf` l = go ls deltas ""
      | "data: " `BS.isPrefixOf` l = 
          let jsonPart = BS.drop 6 l
          in case extractDelta jsonPart of
               Just delta -> go ls (delta : deltas) ""
               Nothing -> go ls deltas l  -- Keep for next chunk
      | BS.null l = go ls deltas ""  -- Empty line
      | otherwise = go ls deltas l   -- Incomplete line

-- | Extract delta content from SSE JSON
-- Returns Nothing for empty or missing content (skip empty deltas)
extractDelta :: ByteString -> Maybe Text
extractDelta bs = do
  json <- decode (LBS.fromStrict bs)
  flip parseMaybe json $ \case
    Object obj -> do
      choices <- obj .: "choices"
      case choices of
        (choice:_) -> do
          delta <- choice .: "delta"
          content <- delta .:? "content"
          case content of
            Just txt | not (T.null txt) -> pure txt
            _ -> fail "empty or no content"
        [] -> fail "no choices"
    _ -> fail "not object"
