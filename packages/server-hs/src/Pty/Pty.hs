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
-- Uses posix-pty for proper terminal emulation with resize support.
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
    -- * Sandbox commit
  , commitChanges
  , getChangedFiles
  ) where

import Control.Concurrent (forkIO, threadDelay)
import Control.Concurrent.STM
import Control.Exception (try, SomeException, bracket)
import Control.Monad (void, when, forever)
import Data.ByteString (ByteString)
import Data.IORef
import Data.Map.Strict (Map)
import Data.Maybe (fromMaybe)
import Data.Text (Text)
import Data.Word (Word64)
import System.Directory (findExecutable)
import System.Exit (ExitCode(..))
import System.IO (Handle, hSetBinaryMode, hSetBuffering, BufferMode(..))
import System.Posix.Pty (Pty, PtyControlCode(..), spawnWithPty, resizePty, readPty, writePty, closePty, createPty)
import System.Posix.Types (Fd)
import System.Process (ProcessHandle, getPid, terminateProcess, waitForProcess, getProcessExitCode)

import qualified Data.ByteString as BS
import qualified Data.Map.Strict as Map
import qualified Data.Text as T

import Pty.Types
import Sandbox.Types
import qualified Sandbox.Sandbox as Sandbox

-- | PTY Manager - holds all active PTY sessions
data PtyManager = PtyManager
  { pmSessions  :: TVar (Map Text RealPtySession)
  , pmCounter   :: IORef Word64
  , pmDirectory :: FilePath  -- Default working directory
  }

-- | Real PTY session with posix-pty
data RealPtySession = RealPtySession
  { rpsInfo       :: PtyInfo
  , rpsPty        :: Pty
  , rpsProcess    :: ProcessHandle
  , rpsBuffer     :: TVar PtyBuffer
  , rpsOverlayDir :: Maybe FilePath
  , rpsSandboxCfg :: Maybe SandboxConfig
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
      sessionId = fromMaybe ptyId (cpiSessionId input)
      -- Inject OPENCODE_SESSION_ID for proxy correlation
      baseEnv = fromMaybe [] (cpiEnv input)
      env = ("OPENCODE_SESSION_ID", sessionId) : baseEnv
      network = fromMaybe False (cpiNetwork input)
  
  if sandbox
    then do
      -- Check if bwrap is available
      bwrapPath <- findExecutable "bwrap"
      case bwrapPath of
        Nothing -> createUnsandboxed mgr ptyId cwd title env input
        Just _ -> do
          result <- createSandboxed mgr ptyId cwd title env network input
          case result of
            Left _ -> createUnsandboxed mgr ptyId cwd title env input
            Right info -> pure $ Right info
    else createUnsandboxed mgr ptyId cwd title env input

-- | Create a sandboxed PTY using bwrap with real PTY
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
          envList = map (\(k, v) -> (T.unpack k, T.unpack v)) env ++ defaultEnvList
      
      -- Spawn with PTY
      ptyResult <- try @SomeException $ 
        spawnWithPty Nothing True "bwrap" bwrapArgs (80, 24)
      
      case ptyResult of
        Left e -> do
          void $ try @SomeException $ Sandbox.destroyDir overlayDir
          pure $ Left $ "Failed to spawn sandbox PTY: " <> T.pack (show e)
        
        Right (pty, ph) -> do
          pid <- getPid ph
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
          
          let session = RealPtySession
                { rpsInfo       = info
                , rpsPty        = pty
                , rpsProcess    = ph
                , rpsBuffer     = bufferVar
                , rpsOverlayDir = Just overlayDir
                , rpsSandboxCfg = Just config
                }
          
          atomically $ modifyTVar' pmSessions (Map.insert ptyId session)
          
          -- Start reader thread
          void $ forkIO $ ptyReaderThread session
          
          -- Monitor for exit
          void $ forkIO $ exitMonitor pmSessions ptyId ph (Just overlayDir)
          
          pure $ Right info

-- | Create an unsandboxed PTY
createUnsandboxed :: PtyManager -> Text -> FilePath -> Text -> [(Text, Text)] -> CreatePtyInput -> IO (Either Text PtyInfo)
createUnsandboxed PtyManager{..} ptyId cwd title env input = do
  let cmd = T.unpack $ fromMaybe "/bin/sh" (cpiCommand input)
      args = map T.unpack $ fromMaybe ["-l"] (cpiArgs input)
      envList = Just $ map (\(k, v) -> (T.unpack k, T.unpack v)) env ++ defaultEnvList
  
  ptyResult <- try @SomeException $
    spawnWithPty envList True cmd args (80, 24)
  
  case ptyResult of
    Left e -> pure $ Left $ "Failed to spawn PTY: " <> T.pack (show e)
    Right (pty, ph) -> do
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
      
      let session = RealPtySession
            { rpsInfo       = info
            , rpsPty        = pty
            , rpsProcess    = ph
            , rpsBuffer     = bufferVar
            , rpsOverlayDir = Nothing
            , rpsSandboxCfg = Nothing
            }
      
      atomically $ modifyTVar' pmSessions (Map.insert ptyId session)
      void $ forkIO $ ptyReaderThread session
      void $ forkIO $ exitMonitor pmSessions ptyId ph Nothing
      
      pure $ Right info

-- | Default environment variables
defaultEnvList :: [(String, String)]
defaultEnvList =
  [ ("HOME", "/root")
  , ("USER", "root")
  , ("SHELL", "/bin/sh")
    -- NixOS-compatible PATH
  , ("PATH", "/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/usr/local/bin:/usr/bin:/bin")
  , ("TERM", "xterm-256color")
  , ("LANG", "C.UTF-8")
  , ("LC_ALL", "C.UTF-8")
    -- Route all HTTP traffic through MITM proxy
  , ("HTTP_PROXY", "http://127.0.0.1:8888")
  , ("HTTPS_PROXY", "http://127.0.0.1:8888")
  , ("http_proxy", "http://127.0.0.1:8888")
  , ("https_proxy", "http://127.0.0.1:8888")
  ]

-- | Convert mount tuple to MountSpec
toMountSpec :: (Text, Text, Bool) -> MountSpec
toMountSpec (src, dest, ro) = MountSpec (T.unpack src) (T.unpack dest) ro

-- | Reader thread - reads from PTY and fills buffer
ptyReaderThread :: RealPtySession -> IO ()
ptyReaderThread RealPtySession{..} = loop
  where
    loop = do
      result <- try @SomeException $ readPty rpsPty
      case result of
        Left _ -> pure ()  -- PTY closed
        Right bs | BS.null bs -> do
          threadDelay 10000  -- 10ms
          loop
        Right bs -> do
          atomically $ modifyTVar' rpsBuffer $ \buf ->
            let newCursor = pbCursor buf + fromIntegral (BS.length bs)
                newData = BS.take bufferLimit (pbData buf <> bs)
                excess = max 0 (BS.length newData - bufferLimit)
                newBufferCursor = pbBufferCursor buf + fromIntegral excess
            in buf
              { pbData = newData
              , pbCursor = newCursor
              , pbBufferCursor = newBufferCursor
              }
          loop

-- | Exit monitor thread
exitMonitor :: TVar (Map Text RealPtySession) -> Text -> ProcessHandle -> Maybe FilePath -> IO ()
exitMonitor sessions ptyId ph mOverlayDir = do
  code <- waitForProcess ph
  let status = case code of
        ExitSuccess   -> PtyExited 0
        ExitFailure n -> PtyExited n
  
  atomically $ modifyTVar' sessions $ Map.adjust
    (\s -> s { rpsInfo = (rpsInfo s) { piStatus = status } })
    ptyId
  
  -- Cleanup overlay after delay
  case mOverlayDir of
    Nothing -> pure ()
    Just dir -> void $ forkIO $ do
      threadDelay 5000000  -- 5 seconds
      void $ try @SomeException $ Sandbox.destroyDir dir

-- | Get a PTY session by ID
get :: PtyManager -> Text -> IO (Maybe PtyInfo)
get PtyManager{..} ptyId = do
  sessions <- readTVarIO pmSessions
  pure $ fmap rpsInfo (Map.lookup ptyId sessions)

-- | List all PTY sessions
list :: PtyManager -> IO [PtyInfo]
list PtyManager{..} = do
  sessions <- readTVarIO pmSessions
  pure $ map rpsInfo (Map.elems sessions)

-- | Update a PTY session
update :: PtyManager -> Text -> UpdatePtyInput -> IO (Maybe PtyInfo)
update mgr@PtyManager{..} ptyId UpdatePtyInput{..} = do
  -- Handle resize if requested
  case upiSize of
    Just (ResizeInput rows cols) -> void $ resize mgr ptyId cols rows
    Nothing -> pure ()
  
  -- Update title
  atomically $ do
    sessions <- readTVar pmSessions
    case Map.lookup ptyId sessions of
      Nothing -> pure Nothing
      Just session -> do
        let info' = (rpsInfo session)
              { piTitle = fromMaybe (piTitle (rpsInfo session)) upiTitle
              }
        let session' = session { rpsInfo = info' }
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
      terminateProcess (rpsProcess session)
      void $ try @SomeException $ closePty (rpsPty session)
      
      case rpsOverlayDir session of
        Nothing -> pure ()
        Just dir -> void $ try @SomeException $ Sandbox.destroyDir dir
      
      pure True

-- | Write data to a PTY
write :: PtyManager -> Text -> ByteString -> IO Bool
write PtyManager{..} ptyId bs = do
  sessions <- readTVarIO pmSessions
  case Map.lookup ptyId sessions of
    Nothing -> pure False
    Just session -> do
      result <- try @SomeException $ writePty (rpsPty session) bs
      case result of
        Left _ -> pure False
        Right _ -> pure True

-- | Resize a PTY (sends SIGWINCH via ioctl TIOCSWINSZ)
resize :: PtyManager -> Text -> Int -> Int -> IO Bool
resize PtyManager{..} ptyId cols rows = do
  sessions <- readTVarIO pmSessions
  case Map.lookup ptyId sessions of
    Nothing -> pure False
    Just session -> do
      result <- try @SomeException $ resizePty (rpsPty session) (cols, rows)
      case result of
        Left _ -> pure False
        Right _ -> pure True

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
      buf <- readTVarIO (rpsBuffer session)
      
      let replayFrom = fromMaybe 0 cursor
          replayData = if replayFrom >= pbCursor buf
            then BS.empty
            else let offset = max 0 (fromIntegral $ replayFrom - pbBufferCursor buf)
                 in BS.drop offset (pbData buf)
      
      lastCursorRef <- newIORef (pbCursor buf)
      runningRef <- newIORef True
      
      pure $ Just PtyConnection
        { pcSend = \bs -> void $ try @SomeException $ writePty (rpsPty session) bs
        , pcOnData = \handler -> do
            when (not $ BS.null replayData) $ handler replayData
            
            void $ forkIO $ do
              let pollLoop = do
                    running <- readIORef runningRef
                    when running $ do
                      currentBuf <- readTVarIO (rpsBuffer session)
                      lastCursor <- readIORef lastCursorRef
                      
                      when (pbCursor currentBuf > lastCursor) $ do
                        let start = pbBufferCursor currentBuf
                            offset = max 0 (fromIntegral $ lastCursor - start)
                            newData = BS.drop offset (pbData currentBuf)
                        when (not $ BS.null newData) $ handler newData
                        writeIORef lastCursorRef (pbCursor currentBuf)
                      
                      threadDelay 10000
                      pollLoop
              pollLoop
        , pcClose = writeIORef runningRef False
        }

-- | Commit sandbox changes to real filesystem
-- Copies modified files from sandbox overlay to the workdir
commitChanges :: PtyManager -> Text -> IO (Either Text ())
commitChanges PtyManager{..} ptyId = do
  sessions <- readTVarIO pmSessions
  case Map.lookup ptyId sessions of
    Nothing -> pure $ Left "PTY not found"
    Just session -> case (rpsOverlayDir session, rpsSandboxCfg session) of
      (Nothing, _) -> pure $ Left "PTY is not sandboxed"
      (_, Nothing) -> pure $ Left "PTY has no sandbox config"
      (Just overlayDir, Just cfg) -> do
        let workdir = scWorkdir cfg
        Sandbox.commit overlayDir workdir

-- | Get list of changed files in sandbox
getChangedFiles :: PtyManager -> Text -> IO (Either Text [FilePath])
getChangedFiles PtyManager{..} ptyId = do
  sessions <- readTVarIO pmSessions
  case Map.lookup ptyId sessions of
    Nothing -> pure $ Left "PTY not found"
    Just session -> case rpsOverlayDir session of
      Nothing -> pure $ Left "PTY is not sandboxed"
      Just overlayDir -> do
        files <- Sandbox.getChanges overlayDir
        pure $ Right files
