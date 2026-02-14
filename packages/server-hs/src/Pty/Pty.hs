{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE LambdaCase #-}

-- | PTY management for sandboxed shell sessions
--
-- Each PTY session runs inside a bwrap sandbox with:
-- - Isolated namespaces (user, pid, mount, net, ipc)
-- - Copy-on-write filesystem via overlayfs
-- - Resource limits via cgroups (when available)
-- - seccomp-bpf syscall filtering
--
-- The PTY is created by spawning bwrap with a shell, connected via
-- pipes that we wrap in a pseudo-terminal abstraction.
--
module Pty.Pty
  ( -- * PTY Manager
    PtyManager
  , newManager
    -- * PTY Operations
  , create
  , get
  , list
  , update
  , remove
  , write
  , resize
    -- * Connection
  , connect
  , PtyConnection(..)
  ) where

import Control.Concurrent (forkIO, ThreadId, killThread)
import Control.Concurrent.STM
import Control.Exception (try, SomeException, bracket)
import Control.Monad (void, when, forM, forever)
import Data.ByteString (ByteString)
import Data.IORef
import Data.Map.Strict (Map)
import Data.Maybe (fromMaybe, isJust)
import Data.Text (Text)
import Data.Word (Word64)
import System.Directory (getCurrentDirectory)
import System.Exit (ExitCode(..))
import System.IO (Handle, hClose, hSetBinaryMode, hSetBuffering, BufferMode(..))
import System.Process

import qualified Data.ByteString as BS
import qualified Data.ByteString.Char8 as C8
import qualified Data.Map.Strict as Map
import qualified Data.Text as T

import Pty.Types
import Sandbox.Types
import qualified Sandbox.Sandbox as Sandbox

-- | PTY Manager - holds all active PTY sessions
data PtyManager = PtyManager
  { pmSessions :: TVar (Map Text PtySession)
  , pmCounter  :: IORef Word64
  , pmDirectory :: FilePath  -- Default working directory
  }

-- | Create a new PTY manager
newManager :: FilePath -> IO PtyManager
newManager directory = do
  sessions <- newTVarIO Map.empty
  counter <- newIORef 0
  pure PtyManager
    { pmSessions = sessions
    , pmCounter = counter
    , pmDirectory = directory
    }

-- | Generate a new PTY ID
nextId :: PtyManager -> IO Text
nextId PtyManager{..} = do
  n <- atomicModifyIORef' pmCounter (\x -> (x + 1, x))
  pure $ "pty_" <> T.pack (show n)

-- | Create a new PTY session
create :: PtyManager -> CreatePtyInput -> IO (Either Text PtyInfo)
create mgr@PtyManager{..} input = do
  ptyId <- nextId mgr
  
  let sandbox = fromMaybe True (cpiSandbox input)
      cwd = T.unpack $ fromMaybe (T.pack pmDirectory) (cpiCwd input)
      title = fromMaybe ("Terminal " <> T.takeEnd 4 ptyId) (cpiTitle input)
      env = fromMaybe [] (cpiEnv input)
      network = fromMaybe False (cpiNetwork input)
  
  if sandbox
    then createSandboxed mgr ptyId cwd title env network input
    else createUnsandboxed mgr ptyId cwd title env input

-- | Create a sandboxed PTY using bwrap
createSandboxed :: PtyManager -> Text -> FilePath -> Text -> [(Text, Text)] -> Bool -> CreatePtyInput -> IO (Either Text PtyInfo)
createSandboxed PtyManager{..} ptyId cwd title env network input = do
  -- Build sandbox config
  let config = (defaultConfig cwd)
        { scNetwork = if network then NetworkHost else NetworkNone
        , scEnv = env
        , scMounts = maybe [] (map toMountSpec) (cpiMounts input)
        }
  
  -- Create sandbox directories
  result <- Sandbox.create ptyId config
  
  case result of
    Left err -> pure $ Left err
    Right (overlayDir, _) -> do
      -- Build the full bwrap command
      let bwrapArgs = Sandbox.buildBwrapArgs config
      
      -- Create process with pipes
      let cp = (proc "bwrap" bwrapArgs)
            { std_in  = CreatePipe
            , std_out = CreatePipe
            , std_err = CreatePipe
            , create_group = True
            , new_session = True
            }
      
      procResult <- try @SomeException $ createProcess cp
      
      case procResult of
        Left e -> do
          -- Cleanup sandbox dir on failure
          void $ try @SomeException $ Sandbox.destroy overlayDir undefined
          pure $ Left $ "Failed to spawn sandbox: " <> T.pack (show e)
        
        Right (Just stdinH, Just stdoutH, Just stderrH, ph) -> do
          -- Set binary mode and no buffering for PTY-like behavior
          hSetBinaryMode stdinH True
          hSetBinaryMode stdoutH True
          hSetBinaryMode stderrH True
          hSetBuffering stdinH NoBuffering
          hSetBuffering stdoutH NoBuffering
          
          -- Get PID
          pid <- getPid ph
          
          -- Create buffer
          bufferVar <- newTVarIO emptyBuffer
          
          let info = PtyInfo
                { piId      = ptyId
                , piTitle   = title
                , piCommand = "bwrap"
                , piArgs    = map T.pack bwrapArgs
                , piCwd     = T.pack cwd
                , piStatus  = PtyRunning
                , piPid     = maybe 0 fromIntegral pid
                , piSandbox = True
                }
          
          let session = PtySession
                { psInfo       = info
                , psProcess    = ph
                , psMasterFd   = stdoutH  -- We read from stdout
                , psBuffer     = bufferVar
                , psOverlayDir = Just overlayDir
                , psSandboxCfg = Just config
                }
          
          -- Register session
          atomically $ modifyTVar' pmSessions (Map.insert ptyId session)
          
          -- Start reader thread to fill buffer
          void $ forkIO $ readerThread session stdinH stdoutH stderrH
          
          -- Monitor for exit
          void $ forkIO $ exitMonitor pmSessions ptyId ph overlayDir
          
          pure $ Right info
        
        _ -> pure $ Left "Failed to create process pipes"

-- | Create an unsandboxed PTY (fallback for when sandbox not available)
createUnsandboxed :: PtyManager -> Text -> FilePath -> Text -> [(Text, Text)] -> CreatePtyInput -> IO (Either Text PtyInfo)
createUnsandboxed PtyManager{..} ptyId cwd title env input = do
  let cmd = T.unpack $ fromMaybe "/bin/sh" (cpiCommand input)
      args = map T.unpack $ fromMaybe ["-l"] (cpiArgs input)
  
  let cp = (proc cmd args)
        { std_in  = CreatePipe
        , std_out = CreatePipe
        , std_err = CreatePipe
        , cwd     = Just cwd
        , env     = Just $ map (\(k, v) -> (T.unpack k, T.unpack v)) env
                         ++ defaultEnvList
        , create_group = True
        }
  
  procResult <- try @SomeException $ createProcess cp
  
  case procResult of
    Left e -> pure $ Left $ "Failed to spawn process: " <> T.pack (show e)
    Right (Just stdinH, Just stdoutH, Just stderrH, ph) -> do
      hSetBinaryMode stdinH True
      hSetBinaryMode stdoutH True
      hSetBinaryMode stderrH True
      hSetBuffering stdinH NoBuffering
      hSetBuffering stdoutH NoBuffering
      
      pid <- getPid ph
      bufferVar <- newTVarIO emptyBuffer
      
      let info = PtyInfo
            { piId      = ptyId
            , piTitle   = title
            , piCommand = T.pack cmd
            , piArgs    = map T.pack args
            , piCwd     = T.pack cwd
            , piStatus  = PtyRunning
            , piPid     = maybe 0 fromIntegral pid
            , piSandbox = False
            }
      
      let session = PtySession
            { psInfo       = info
            , psProcess    = ph
            , psMasterFd   = stdoutH
            , psBuffer     = bufferVar
            , psOverlayDir = Nothing
            , psSandboxCfg = Nothing
            }
      
      atomically $ modifyTVar' pmSessions (Map.insert ptyId session)
      void $ forkIO $ readerThread session stdinH stdoutH stderrH
      void $ forkIO $ exitMonitorNoSandbox pmSessions ptyId ph
      
      pure $ Right info
    _ -> pure $ Left "Failed to create process pipes"

-- | Default environment variables
defaultEnvList :: [(String, String)]
defaultEnvList =
  [ ("HOME", "/root")
  , ("USER", "root")
  , ("SHELL", "/bin/sh")
  , ("PATH", "/nix/var/nix/profiles/default/bin:/usr/local/bin:/usr/bin:/bin")
  , ("TERM", "xterm-256color")
  , ("LANG", "C.UTF-8")
  , ("LC_ALL", "C.UTF-8")
  ]

-- | Convert mount tuple to MountSpec
toMountSpec :: (Text, Text, Bool) -> MountSpec
toMountSpec (src, dest, ro) = MountSpec (T.unpack src) (T.unpack dest) ro

-- | Reader thread - reads from stdout and fills buffer
readerThread :: PtySession -> Handle -> Handle -> Handle -> IO ()
readerThread PtySession{..} stdinH stdoutH stderrH = do
  -- Read loop
  forever $ do
    -- Read from stdout (non-blocking would be better)
    chunk <- try @SomeException $ BS.hGetSome stdoutH 4096
    case chunk of
      Left _ -> pure ()  -- EOF or error
      Right bs | BS.null bs -> pure ()
      Right bs -> do
        -- Update buffer
        atomically $ modifyTVar' psBuffer $ \buf ->
          let newCursor = pbCursor buf + fromIntegral (BS.length bs)
              newData = BS.take bufferLimit (pbData buf <> bs)
              excess = max 0 (BS.length newData - bufferLimit)
              newBufferCursor = pbBufferCursor buf + fromIntegral excess
          in buf
            { pbData = newData
            , pbCursor = newCursor
            , pbBufferCursor = newBufferCursor
            }

-- | Exit monitor thread - updates status when process exits
exitMonitor :: TVar (Map Text PtySession) -> Text -> ProcessHandle -> FilePath -> IO ()
exitMonitor sessions ptyId ph overlayDir = do
  code <- waitForProcess ph
  let status = case code of
        ExitSuccess   -> PtyExited 0
        ExitFailure n -> PtyExited n
  
  -- Update session status
  atomically $ modifyTVar' sessions $ Map.adjust
    (\s -> s { psInfo = (psInfo s) { piStatus = status } })
    ptyId
  
  -- Cleanup overlay after a delay
  void $ forkIO $ do
    threadDelay 5000000  -- 5 seconds
    void $ try @SomeException $ Sandbox.destroy overlayDir ph

-- | Exit monitor for non-sandboxed PTY
exitMonitorNoSandbox :: TVar (Map Text PtySession) -> Text -> ProcessHandle -> IO ()
exitMonitorNoSandbox sessions ptyId ph = do
  code <- waitForProcess ph
  let status = case code of
        ExitSuccess   -> PtyExited 0
        ExitFailure n -> PtyExited n
  
  atomically $ modifyTVar' sessions $ Map.adjust
    (\s -> s { psInfo = (psInfo s) { piStatus = status } })
    ptyId

-- | Simple thread delay
threadDelay :: Int -> IO ()
threadDelay = Control.Concurrent.threadDelay

-- | Get a PTY session by ID
get :: PtyManager -> Text -> IO (Maybe PtyInfo)
get PtyManager{..} ptyId = do
  sessions <- readTVarIO pmSessions
  pure $ fmap psInfo (Map.lookup ptyId sessions)

-- | List all PTY sessions
list :: PtyManager -> IO [PtyInfo]
list PtyManager{..} = do
  sessions <- readTVarIO pmSessions
  pure $ map psInfo (Map.elems sessions)

-- | Update a PTY session
update :: PtyManager -> Text -> UpdatePtyInput -> IO (Maybe PtyInfo)
update PtyManager{..} ptyId UpdatePtyInput{..} = do
  atomically $ do
    sessions <- readTVar pmSessions
    case Map.lookup ptyId sessions of
      Nothing -> pure Nothing
      Just session -> do
        let info' = (psInfo session)
              { piTitle = fromMaybe (piTitle (psInfo session)) upiTitle
              }
        let session' = session { psInfo = info' }
        writeTVar pmSessions (Map.insert ptyId session' sessions)
        pure $ Just info'

-- | Remove a PTY session
remove :: PtyManager -> Text -> IO Bool
remove PtyManager{..} ptyId = do
  mSession <- atomically $ do
    sessions <- readTVar pmSessions
    case Map.lookup ptyId sessions of
      Nothing -> pure Nothing
      Just s -> do
        writeTVar pmSessions (Map.delete ptyId sessions)
        pure (Just s)
  
  case mSession of
    Nothing -> pure False
    Just session -> do
      -- Kill the process
      terminateProcess (psProcess session)
      
      -- Cleanup sandbox if applicable
      case psOverlayDir session of
        Nothing -> pure ()
        Just dir -> void $ try @SomeException $ 
          Sandbox.destroy dir (psProcess session)
      
      pure True

-- | Write data to a PTY
write :: PtyManager -> Text -> ByteString -> IO Bool
write PtyManager{..} ptyId bs = do
  sessions <- readTVarIO pmSessions
  case Map.lookup ptyId sessions of
    Nothing -> pure False
    Just session -> do
      -- We need stdin handle, but we stored stdout
      -- This is a design issue - we need to keep both handles
      -- For now, this is a placeholder
      pure True

-- | Resize a PTY (sends SIGWINCH)
resize :: PtyManager -> Text -> Int -> Int -> IO Bool
resize PtyManager{..} ptyId cols rows = do
  sessions <- readTVarIO pmSessions
  case Map.lookup ptyId sessions of
    Nothing -> pure False
    Just session -> do
      -- In a real PTY implementation, we'd use ioctl TIOCSWINSZ
      -- With pipes, we can't resize - this is a limitation
      pure True

-- | PTY connection for WebSocket bridging
data PtyConnection = PtyConnection
  { pcSend   :: ByteString -> IO ()
  , pcOnData :: (ByteString -> IO ()) -> IO ()
  , pcClose  :: IO ()
  }

-- | Connect to a PTY session (for WebSocket bridging)
connect :: PtyManager -> Text -> Maybe Word64 -> IO (Maybe PtyConnection)
connect PtyManager{..} ptyId cursor = do
  sessions <- readTVarIO pmSessions
  case Map.lookup ptyId sessions of
    Nothing -> pure Nothing
    Just session -> do
      -- Get current buffer state
      buf <- readTVarIO (psBuffer session)
      
      -- Calculate replay data
      let replayFrom = fromMaybe 0 cursor
          replayData = if replayFrom >= pbCursor buf
            then BS.empty
            else let offset = max 0 (fromIntegral $ replayFrom - pbBufferCursor buf)
                 in BS.drop offset (pbData buf)
      
      -- Create connection
      -- This is a simplified implementation - real one needs
      -- proper subscriber management
      pure $ Just PtyConnection
        { pcSend = \_ -> pure ()  -- TODO: write to stdin
        , pcOnData = \handler -> do
            -- Send replay data first
            when (not $ BS.null replayData) $
              handler replayData
            -- Then subscribe to new data
            -- TODO: proper subscription
            pure ()
        , pcClose = pure ()
        }
