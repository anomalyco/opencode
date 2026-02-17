{-# LANGUAGE OverloadedStrings #-}

module Property.HandlerProps where

import Api
import Bus.Bus qualified as Bus
import Control.Concurrent (forkIO, killThread)
import Control.Concurrent.MVar
import Control.Concurrent.STM
import Control.Exception (bracket)
import Control.Monad (void)
import Data.Aeson (Value (..), object, toJSON, (.=))
import Data.Aeson.Key qualified as K
import Data.Aeson.KeyMap qualified as KM
import Data.ByteString qualified as BS
import Data.ByteString.Base64 qualified as B64
import Data.ByteString.Builder (Builder, toLazyByteString)
import Data.ByteString.Lazy qualified as LBS
import Data.Maybe (mapMaybe)
import Data.Text (Text)
import Data.Text qualified as T
import Data.Text.Encoding qualified as TE
import Data.Text.IO qualified as TIO
import Global.Event (globalEventHandler)
import Handlers
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Katip (Severity (ErrorS))
import Log qualified
import Network.HTTP.Types (hContentType, status200, status400)
import Network.Wai (defaultRequest, responseToStream)
import Network.Wai.Internal (ResponseReceived (..))
import Prompt.Async qualified as PromptAsync
import Pty.Connect (ptyConnectHandler)
import Pty.Pty qualified as Pty
import Servant (Tagged (..))
import Servant.Server (Handler, ServerError, runHandler)
import State
import Storage.Storage qualified as Storage
import System.Directory (createDirectory, findExecutable, removeDirectoryRecursive)
import System.Environment (lookupEnv, setEnv, unsetEnv)
import System.Exit (ExitCode (..))
import System.FilePath ((</>))
import System.IO.Temp (createTempDirectory)
import System.Process (readProcessWithExitCode)
import Test.Tasty
import Test.Tasty.Hedgehog
import Tui.Store qualified as TuiStore

withTmp :: (FilePath -> IO a) -> IO a
withTmp action =
    bracket (createTempDirectory "/tmp" "handler-test") removeDirectoryRecursive action

withState :: (AppState -> IO a) -> IO a
withState action =
    withTmp $ \dir ->
        Log.withLoggerLevel "test" ErrorS $ \lg ->
            Storage.withStorage dir $ \store -> do
                bus <- Bus.newBus
                chan <- newBroadcastTChanIO
                _ <- Bus.subscribeAll bus $ \event ->
                    atomically $ writeTChan chan (toJSON event)
                pty <- Pty.newManager dir
                queue <- newTQueueIO
                let st =
                        AppState
                            { stBus = bus
                            , stStorage = store
                            , stProjectID = "test"
                            , stDirectory = T.pack dir
                            , stVersion = "test"
                            , stEventChan = chan
                            , stPtyManager = pty
                            , stProxy = Nothing
                            , stLogger = lg
                            , stPromptAsyncQueue = queue
                            }
                action st

setVar :: String -> Maybe String -> IO ()
setVar key val = case val of
    Nothing -> unsetEnv key
    Just v -> setEnv key v

withEnv :: String -> Maybe String -> IO a -> IO a
withEnv key val action =
    bracket (lookupEnv key) (setVar key) (\_ -> setVar key val >> action)

runHandlerIO :: Handler a -> IO (Either ServerError a)
runHandlerIO = runHandler

waitVar :: Int -> TMVar a -> IO (Maybe a)
waitVar delay var = do
    gate <- registerDelay delay
    atomically $
        (Just <$> takeTMVar var)
            `orElse` do
                done <- readTVar gate
                if done then pure Nothing else retry

lookupText :: Text -> Value -> Maybe Text
lookupText key (Object obj) = case KM.lookup (K.fromText key) obj of
    Just (String t) -> Just t
    _ -> Nothing
lookupText _ _ = Nothing

lookupBool :: Text -> Value -> Maybe Bool
lookupBool key (Object obj) = case KM.lookup (K.fromText key) obj of
    Just (Bool b) -> Just b
    _ -> Nothing
lookupBool _ _ = Nothing

hasKey :: Text -> Value -> Bool
hasKey key (Object obj) = KM.member (K.fromText key) obj
hasKey _ _ = False

isObject :: Value -> Bool
isObject (Object _) = True
isObject _ = False

matchFind :: Text -> Text -> Value -> Bool
matchFind token path val =
    case (lookupText "text" val, lookupText "path" val) of
        (Just txt, Just pth) -> token `T.isInfixOf` txt && pth == path
        _ -> False

hasSuffix :: Text -> Value -> Bool
hasSuffix suffix val = case lookupText "path" val of
    Just pth -> suffix `T.isSuffixOf` pth
    Nothing -> False

genName :: Gen Text
genName = Gen.text (Range.linear 1 12) Gen.alphaNum

genText :: Gen Text
genText = Gen.text (Range.linear 1 64) Gen.alphaNum

prop_healthHandler :: Property
prop_healthHandler = property $ do
    result <- evalIO $ withState $ \st -> do
        res <- runHandlerIO (healthHandler st)
        pure (res, stVersion st)
    case result of
        (Left _, _) -> failure
        (Right health, ver) -> do
            healthy health === True
            version health === ver

prop_pathHandler :: Property
prop_pathHandler = property $ do
    result <- evalIO $ withState $ \st -> do
        res <- runHandlerIO (pathHandler st)
        pure (res, stDirectory st)
    case result of
        (Left _, _) -> failure
        (Right info, dir) -> do
            let PathInfo{worktree = wt, state = stPath} = info
            wt === dir
            assert $ T.isSuffixOf ".opencode/state" stPath

prop_globalConfigHandler :: Property
prop_globalConfigHandler = property $ do
    result <- evalIO $ runHandlerIO globalConfigHandler
    case result of
        Left _ -> failure
        Right val -> assert $ isObject val

prop_projectHandlers :: Property
prop_projectHandlers = property $ do
    result <- evalIO $ withState $ \st -> do
        listed <- runHandlerIO (projectListHandler st)
        current <- runHandlerIO (projectCurrentHandler st Nothing)
        fetched <- case current of
            Left err -> pure (Left err)
            Right cur -> runHandlerIO (projectGetHandler st (Api.id cur))
        pure (listed, current, fetched, stDirectory st)
    case result of
        (Left _, _, _, _) -> failure
        (_, Left _, _, _) -> failure
        (_, _, Left _, _) -> failure
        (Right listed, Right current, Right fetched, dir) -> do
            let projWork p = case p of Project{worktree = wt} -> wt
            assert $ any (\p -> projWork p == dir) listed
            projWork current === dir
            projWork fetched === dir

prop_providerListHandler :: Property
prop_providerListHandler = property $ do
    result <- evalIO $ withState $ \st -> runHandlerIO (providerListHandler st)
    case result of
        Left _ -> failure
        Right pl -> assert $ isObject (default_ pl)

prop_providerAuthHandler :: Property
prop_providerAuthHandler = property $ do
    result <- evalIO $ withState $ \st -> runHandlerIO (providerAuthHandler st)
    case result of
        Left _ -> failure
        Right val -> assert $ isObject val

prop_providerHandler :: Property
prop_providerHandler = property $ do
    result <- evalIO $ runHandlerIO providerHandler
    case result of
        Left _ -> failure
        Right _ -> success

prop_providerOauthHandlers :: Property
prop_providerOauthHandlers = withTests 10 $ property $ do
    pid <- forAll genName
    token <- forAll genName
    result <- evalIO $ withState $ \st -> do
        let input = object ["redirect" .= ("http://localhost" :: Text), "scopes" .= [("read" :: Text)]]
        auth <- runHandlerIO (providerOauthAuthorizeHandler st pid input)
        callback <- case auth of
            Left err -> pure (Left err)
            Right val -> do
                case lookupText "state" val of
                    Nothing -> pure (Right (object ["ok" .= False]))
                    Just state -> do
                        let payload = object ["state" .= state, "token" .= token]
                        runHandlerIO (providerOauthCallbackHandler st pid payload)
        pure (auth, callback)
    case result of
        (Left _, _) -> failure
        (_, Left _) -> failure
        (Right auth, Right callback) -> do
            lookupText "providerID" auth === Just pid
            assert $ lookupText "state" auth /= Nothing
            lookupBool "ok" callback === Just True
            lookupBool "authenticated" callback === Just True

prop_configHandler :: Property
prop_configHandler = property $ do
    result <- evalIO $ withState $ \st -> runHandlerIO (configHandler st)
    case result of
        Left _ -> failure
        Right val -> assert $ isObject val

prop_commandHandler :: Property
prop_commandHandler = property $ do
    result <- evalIO $ runHandlerIO commandHandler
    case result of
        Left _ -> failure
        Right defs -> do
            let names = mapMaybe (lookupText "name") defs
            assert $ "bash" `elem` names

prop_agentHandler :: Property
prop_agentHandler = property $ do
    result <- evalIO $ runHandlerIO agentHandler
    case result of
        Left _ -> failure
        Right _ -> success

prop_sessionStatusHandler :: Property
prop_sessionStatusHandler = property $ do
    result <- evalIO $ withState $ \st -> runHandlerIO (sessionStatusHandler st)
    case result of
        Left _ -> failure
        Right val -> do
            assert $ hasKey "sessions" val
            assert $ hasKey "ptys" val

prop_sessionLifecycleHandler :: Property
prop_sessionLifecycleHandler = withTests 20 $ property $ do
    title <- forAll genText
    next <- forAll genText
    result <- evalIO $ withState $ \st -> do
        let input = CreateSessionInput (Just title) Nothing
        created <- runHandlerIO (sessionCreateHandler st Nothing input)
        listed <- runHandlerIO (sessionListHandler st Nothing Nothing Nothing)
        fetched <- case created of
            Left err -> pure (Left err)
            Right ses -> runHandlerIO (sessionGetHandler st (sesId ses))
        updated <- case created of
            Left err -> pure (Left err)
            Right ses -> runHandlerIO (sessionUpdateHandler st (sesId ses) (UpdateSessionInput (Just next) Nothing Nothing Nothing))
        deleted <- case created of
            Left err -> pure (Left err)
            Right ses -> runHandlerIO (sessionDeleteHandler st (sesId ses))
        fetched2 <- case created of
            Left err -> pure (Left err)
            Right ses -> runHandlerIO (sessionGetHandler st (sesId ses))
        pure (created, listed, fetched, updated, deleted, fetched2)
    case result of
        (Left _, _, _, _, _, _) -> failure
        (_, Left _, _, _, _, _) -> failure
        (_, _, Left _, _, _, _) -> failure
        (_, _, _, Left _, _, _) -> failure
        (_, _, _, _, Left _, _) -> failure
        (Right created, Right listed, Right fetched, Right updated, Right deleted, Left _) -> do
            assert $ any (\s -> sesId s == sesId created) listed
            sesId fetched === sesId created
            sesTitle updated === next
            deleted === True
        _ -> failure

prop_sessionChildrenHandler :: Property
prop_sessionChildrenHandler = withTests 20 $ property $ do
    parentTitle <- forAll genText
    childTitle <- forAll genText
    result <- evalIO $ withState $ \st -> do
        parent <- runHandlerIO (sessionCreateHandler st Nothing (CreateSessionInput (Just parentTitle) Nothing))
        child <- case parent of
            Left err -> pure (Left err)
            Right ses -> runHandlerIO (sessionCreateHandler st Nothing (CreateSessionInput (Just childTitle) (Just (sesId ses))))
        kids <- case parent of
            Left err -> pure (Left err)
            Right ses -> runHandlerIO (sessionChildrenHandler st (sesId ses))
        pure (parent, child, kids)
    case result of
        (Left _, _, _) -> failure
        (_, Left _, _) -> failure
        (_, _, Left _) -> failure
        (Right parent, Right child, Right kids) ->
            assert $ any (\s -> sesId s == sesId child && sesParentId s == Just (sesId parent)) kids

prop_sessionTodoHandler :: Property
prop_sessionTodoHandler = withTests 20 $ property $ do
    sid <- forAll genName
    item <- forAll genText
    result <- evalIO $ withState $ \st -> do
        let todos = [object ["text" .= item]]
        Storage.write (stStorage st) ["todo", sid] todos
        res <- runHandlerIO (sessionTodoHandler st sid)
        pure res
    case result of
        Left _ -> failure
        Right todos -> todos === [object ["text" .= item]]

prop_sessionInitHandler :: Property
prop_sessionInitHandler = withTests 20 $ property $ do
    sid <- forAll genName
    result <- evalIO $ withState $ \st -> do
        var <- newEmptyTMVarIO
        _ <- Bus.subscribe (stBus st) "session.initialized" $ \event ->
            atomically $ void $ tryPutTMVar var event
        res <- runHandlerIO (sessionInitHandler st sid)
        evt <- waitVar 1000000 var
        pure (res, evt)
    case result of
        (Left _, _) -> failure
        (Right val, evt) -> do
            lookupBool "initialized" val === Just True
            assert $ evt /= Nothing

prop_sessionForkHandler :: Property
prop_sessionForkHandler = withTests 20 $ property $ do
    title <- forAll genText
    result <- evalIO $ withState $ \st -> do
        parent <- runHandlerIO (sessionCreateHandler st Nothing (CreateSessionInput (Just title) Nothing))
        forked <- case parent of
            Left err -> pure (Left err)
            Right ses -> runHandlerIO (sessionForkHandler st (sesId ses))
        pure (parent, forked)
    case result of
        (Left _, _) -> failure
        (_, Left _) -> failure
        (Right parent, Right forked) -> do
            sesParentId forked === Just (sesId parent)
            assert $ "Fork of" `T.isPrefixOf` sesTitle forked

prop_sessionAbortHandler :: Property
prop_sessionAbortHandler = withTests 20 $ property $ do
    sid <- forAll genName
    result <- evalIO $ withState $ \st -> do
        var <- newEmptyTMVarIO
        _ <- Bus.subscribe (stBus st) "session.error" $ \event ->
            atomically $ void $ tryPutTMVar var event
        res <- runHandlerIO (sessionAbortHandler st sid)
        evt <- waitVar 1000000 var
        pure (res, evt)
    case result of
        (Left _, _) -> failure
        (Right val, evt) -> do
            lookupBool "aborted" val === Just True
            assert $ evt /= Nothing

prop_sessionShareHandlers :: Property
prop_sessionShareHandlers = withTests 20 $ property $ do
    result <- evalIO $ withState $ \st -> do
        created <- runHandlerIO (sessionCreateHandler st Nothing (CreateSessionInput (Just "share") Nothing))
        shared <- case created of
            Left err -> pure (Left err)
            Right ses -> runHandlerIO (sessionShareCreateHandler st (sesId ses))
        deleted <- case created of
            Left err -> pure (Left err)
            Right ses -> runHandlerIO (sessionShareDeleteHandler st (sesId ses))
        pure (created, shared, deleted)
    case result of
        (Left _, _, _) -> failure
        (_, Left _, _) -> failure
        (_, _, Left _) -> failure
        (Right created, Right shared, Right deleted) -> do
            assert $ sesId created `T.isInfixOf` shareUrl shared
            deleted === True

prop_sessionDiffHandler :: Property
prop_sessionDiffHandler = withTests 20 $ property $ do
    sid <- forAll genName
    result <- evalIO $ withState $ \st -> runHandlerIO (sessionDiffHandler st sid)
    case result of
        Left _ -> failure
        Right val -> assert $ hasKey "summary" val

prop_sessionSummarizeHandler :: Property
prop_sessionSummarizeHandler = withTests 20 $ property $ do
    result <- evalIO $ withState $ \st -> do
        created <- runHandlerIO (sessionCreateHandler st Nothing (CreateSessionInput (Just "sum") Nothing))
        summary <- case created of
            Left err -> pure (Left err)
            Right ses -> runHandlerIO (sessionSummarizeHandler st (sesId ses))
        pure summary
    case result of
        Left _ -> failure
        Right summary -> do
            ssAdditions summary === 0
            ssDeletions summary === 0

prop_sessionRevertHandlers :: Property
prop_sessionRevertHandlers = withTests 20 $ property $ do
    mid <- forAll genName
    result <- evalIO $ withState $ \st -> do
        created <- runHandlerIO (sessionCreateHandler st Nothing (CreateSessionInput (Just "rev") Nothing))
        reverted <- case created of
            Left err -> pure (Left err)
            Right ses -> runHandlerIO (sessionRevertHandler st (sesId ses) (SessionRevert mid Nothing Nothing Nothing))
        unreverted <- case created of
            Left err -> pure (Left err)
            Right ses -> runHandlerIO (sessionUnrevertHandler st (sesId ses))
        pure (reverted, unreverted)
    case result of
        (Left _, _) -> failure
        (_, Left _) -> failure
        (Right reverted, Right unreverted) -> do
            srMessageId reverted === mid
            unreverted === True

prop_sessionPermissionHandler :: Property
prop_sessionPermissionHandler = withTests 20 $ property $ do
    sid <- forAll genName
    pid <- forAll genName
    result <- evalIO $ withState $ \st -> do
        var <- newEmptyTMVarIO
        _ <- Bus.subscribe (stBus st) "permission.replied" $ \event ->
            atomically $ void $ tryPutTMVar var event
        let input = object ["ok" .= True]
        res <- runHandlerIO (sessionPermissionHandler st sid pid input)
        evt <- waitVar 1000000 var
        pure (res, evt)
    case result of
        (Left _, _) -> failure
        (Right val, evt) -> do
            lookupBool "ok" val === Just True
            assert $ evt /= Nothing

prop_sessionMessageHandlers :: Property
prop_sessionMessageHandlers = withTests 20 $ property $ do
    msg <- forAll genText
    result <- evalIO $ withState $ \st ->
        withEnv "OPENROUTER_API_KEY" Nothing $ do
            let parts = [object ["id" .= ("part_1" :: Text), "type" .= ("text" :: Text), "text" .= msg]]
            let input = CreateMessageInput (Just "msg_1") parts
            _ <- runHandlerIO (sessionMessageCreateHandler st "session" input)
            listed <- runHandlerIO (sessionMessageListHandler st "session" Nothing)
            fetched <- runHandlerIO (sessionMessageGetHandler st "session" "msg_1")
            pure (listed, fetched)
    case result of
        (Left _, _) -> failure
        (_, Left _) -> failure
        (Right listed, Right fetched) -> do
            assert $ length listed >= 2
            msgId (msgInfo fetched) === "msg_1"

prop_sessionMessagePartHandlers :: Property
prop_sessionMessagePartHandlers = withTests 20 $ property $ do
    txt <- forAll genText
    next <- forAll genText
    result <- evalIO $ withState $ \st ->
        withEnv "OPENROUTER_API_KEY" Nothing $ do
            let pid = "part_1" :: Text
            let parts = [object ["id" .= pid, "type" .= ("text" :: Text), "text" .= txt]]
            let input = CreateMessageInput (Just "msg_1") parts
            _ <- runHandlerIO (sessionMessageCreateHandler st "session" input)
            let update =
                    object
                        [ "id" .= pid
                        , "sessionID" .= ("session" :: Text)
                        , "messageID" .= ("msg_1" :: Text)
                        , "type" .= ("text" :: Text)
                        , "text" .= next
                        ]
            updated <- runHandlerIO (sessionMessagePartUpdateHandler st "session" "msg_1" pid update)
            deleted <- runHandlerIO (sessionMessagePartDeleteHandler st "session" "msg_1" pid)
            pure (updated, deleted)
    case result of
        (Left _, _) -> failure
        (_, Left _) -> failure
        (Right updated, Right deleted) -> do
            lookupText "text" updated === Just next
            deleted === True

prop_lspHandler :: Property
prop_lspHandler = property $ do
    result <- evalIO $ withState $ \st -> runHandlerIO (lspHandler st)
    case result of
        Left _ -> failure
        Right _ -> success

prop_permissionHandlers :: Property
prop_permissionHandlers = property $ do
    rid <- forAll genName
    result <- evalIO $ withState $ \st -> do
        let payload = object ["ok" .= True]
        _ <- runHandlerIO (permissionReplyHandler st rid payload)
        res <- runHandlerIO (permissionHandler st)
        pure res
    case result of
        Left _ -> failure
        Right vals -> do
            let hits = filter (\v -> lookupText "requestID" v == Just rid) vals
            assert $ not (null hits)

prop_questionHandlers :: Property
prop_questionHandlers = property $ do
    rid <- forAll genName
    result <- evalIO $ withState $ \st -> do
        let payload = object ["ok" .= True]
        _ <- runHandlerIO (questionReplyHandler st rid payload)
        _ <- runHandlerIO (questionRejectHandler st (rid <> "_r") payload)
        res <- runHandlerIO (questionHandler st)
        pure res
    case result of
        Left _ -> failure
        Right vals -> do
            let hits = filter (\v -> lookupText "requestID" v == Just rid) vals
            assert $ not (null hits)

prop_fileStatusHandler :: Property
prop_fileStatusHandler = withTests 20 $ property $ do
    name <- forAll genName
    result <- evalIO $ withState $ \st -> do
        let root = T.unpack (stDirectory st)
        let path = root </> T.unpack name
        TIO.writeFile path "ok"
        res <- runHandlerIO (fileStatusHandler st (Just (stDirectory st)) (Just name))
        pure res
    case result of
        Left _ -> failure
        Right vals -> do
            let matches = filter (\v -> lookupText "path" v == Just name) vals
            assert $ not (null matches)

prop_tuiHandlers :: Property
prop_tuiHandlers = withTests 20 $ property $ do
    txt <- forAll genText
    result <- evalIO $ withState $ \st -> do
        let input = object ["text" .= txt]
        appended <- runHandlerIO (tuiAppendPromptHandler st input)
        prompt <- TuiStore.getPrompt (stStorage st)
        submitted <- runHandlerIO (tuiSubmitPromptHandler st (object []))
        cleared <- runHandlerIO (tuiClearPromptHandler st (object []))
        openHelp <- runHandlerIO (tuiOpenHandler st "open-help" (object ["ok" .= True]))
        openSessions <- runHandlerIO (tuiOpenHandler st "open-sessions" (object ["ok" .= True]))
        openThemes <- runHandlerIO (tuiOpenHandler st "open-themes" (object ["ok" .= True]))
        openModels <- runHandlerIO (tuiOpenHandler st "open-models" (object ["ok" .= True]))
        exec <- runHandlerIO (tuiExecuteCommandHandler st (object ["cmd" .= ("ok" :: Text)]))
        toast <- runHandlerIO (tuiShowToastHandler st (object ["msg" .= ("ok" :: Text)]))
        publish <- runHandlerIO (tuiPublishHandler st (object ["payload" .= ("ok" :: Text)]))
        select <- runHandlerIO (tuiSelectSessionHandler st (object ["sessionID" .= ("ok" :: Text)]))
        controlNext <- runHandlerIO (tuiControlHandler st "next" (object ["ok" .= True]))
        controlResponse <- runHandlerIO (tuiControlHandler st "response" (object ["ok" .= True]))
        lastVal <- TuiStore.getLast (stStorage st)
        pure (appended, prompt, submitted, cleared, openHelp, openSessions, openThemes, openModels, exec, toast, publish, select, controlNext, controlResponse, lastVal)
    case result of
        (Right appended, prompt, Right submitted, Right cleared, Right openHelp, Right openSessions, Right openThemes, Right openModels, Right exec, Right toast, Right publish, Right select, Right controlNext, Right controlResponse, lastVal) -> do
            lookupText "prompt" appended === Just prompt
            lookupText "prompt" submitted === Just prompt
            lookupBool "ok" cleared === Just True
            lookupBool "ok" openHelp === Just True
            lookupBool "ok" openSessions === Just True
            lookupBool "ok" openThemes === Just True
            lookupBool "ok" openModels === Just True
            lookupBool "ok" exec === Just True
            lookupBool "ok" toast === Just True
            lookupBool "ok" publish === Just True
            lookupBool "ok" select === Just True
            lookupBool "ok" controlNext === Just True
            lookupBool "ok" controlResponse === Just True
            assert $ lastVal /= Nothing
        _ -> failure

prop_skillHandler :: Property
prop_skillHandler = property $ do
    result <- evalIO $ withState $ \st -> runHandlerIO (skillHandler st Nothing)
    case result of
        Left _ -> failure
        Right _ -> success

prop_formatterHandler :: Property
prop_formatterHandler = property $ do
    result <- evalIO $ withState $ \st -> runHandlerIO (formatterHandler st Nothing)
    case result of
        Left _ -> failure
        Right _ -> success

prop_experimentalWorktreeHandlers :: Property
prop_experimentalWorktreeHandlers = withTests 20 $ property $ do
    result <- evalIO $ withState $ \st -> do
        get1 <- runHandlerIO (experimentalWorktreeGetHandler st)
        let input = object ["root" .= ("test" :: Text), "ready" .= True]
        set1 <- runHandlerIO (experimentalWorktreePostHandler st input)
        reset1 <- runHandlerIO (experimentalWorktreeResetHandler st (object []))
        pure (get1, set1, reset1, stDirectory st)
    case result of
        (Left _, _, _, _) -> failure
        (_, Left _, _, _) -> failure
        (_, _, Left _, _) -> failure
        (Right get1, Right set1, Right reset1, root) -> do
            lookupText "root" get1 === Just root
            set1 === object ["root" .= ("test" :: Text), "ready" .= True]
            lookupBool "reset" reset1 === Just True

prop_fileListHandler :: Property
prop_fileListHandler = property $ do
    name <- forAll genName
    dir <- forAll (Gen.filter (/= name) genName)
    result <- evalIO $ withTmp $ \root -> do
        createDirectory (root </> T.unpack dir)
        TIO.writeFile (root </> T.unpack name) "ok"
        runHandlerIO (fileListHandler (Just (T.pack root)) ".")
    case result of
        Left _ -> failure
        Right nodes -> do
            assert $ any (\node -> fnName node == name) nodes
            assert $ any (\node -> fnName node == dir && fnType node == FileTypeDirectory) nodes

prop_fileReadHandler :: Property
prop_fileReadHandler = property $ do
    name <- forAll genName
    content <- forAll genText
    result <- evalIO $ withTmp $ \root -> do
        TIO.writeFile (root </> T.unpack name) content
        runHandlerIO (fileReadHandler (Just (T.pack root)) name)
    case result of
        Left _ -> failure
        Right file -> do
            fcType file === ContentTypeText
            fcContent file === content

prop_fileReadHandlerBinary :: Property
prop_fileReadHandlerBinary = property $ do
    name <- forAll genName
    let bytes = BS.pack [0, 1, 2, 255]
    result <- evalIO $ withTmp $ \root -> do
        BS.writeFile (root </> T.unpack name) bytes
        runHandlerIO (fileReadHandler (Just (T.pack root)) name)
    case result of
        Left _ -> failure
        Right file -> do
            fcType file === ContentTypeBinary
            let encoded = TE.decodeUtf8 (B64.encode bytes)
            fcContent file === encoded

prop_chatHandlerAnthropicMissing :: Property
prop_chatHandlerAnthropicMissing = property $ do
    msg <- forAll genText
    result <- evalIO $ withState $ \st ->
        withEnv "ANTHROPIC_API_KEY" Nothing $
            runHandlerIO (chatHandler st (ChatInput msg Nothing))
    case result of
        Left _ -> failure
        Right val -> lookupText "error" val === Just "ANTHROPIC_API_KEY not set"

prop_chatHandlerOpenRouterMissing :: Property
prop_chatHandlerOpenRouterMissing = property $ do
    msg <- forAll genText
    result <- evalIO $ withState $ \st ->
        withEnv "OPENROUTER_API_KEY" Nothing $
            runHandlerIO (chatHandler st (ChatInput msg (Just "openrouter/test-model")))
    case result of
        Left _ -> failure
        Right val -> lookupText "error" val === Just "OPENROUTER_API_KEY not set"

prop_sessionCommandHandler :: Property
prop_sessionCommandHandler = withTests 20 $ property $ do
    txt <- forAll genName
    result <- evalIO $ withState $ \st -> do
        var <- newEmptyTMVarIO
        _ <- Bus.subscribe (stBus st) "command.executed" $ \event ->
            atomically $ void $ tryPutTMVar var event
        let input =
                object
                    [ "command" .= ("echo " <> txt)
                    , "description" .= ("test" :: Text)
                    , "timeout" .= (2000 :: Int)
                    ]
        res <- runHandlerIO (sessionCommandHandler st "session" input)
        evt <- waitVar 1000000 var
        pure (res, evt)
    case result of
        (Left _, _) -> failure
        (Right val, evt) -> do
            lookupBool "error" val === Just False
            case lookupText "output" val of
                Nothing -> failure
                Just out -> assert $ txt `T.isInfixOf` out
            assert $ evt /= Nothing

prop_sessionShellHandler :: Property
prop_sessionShellHandler = withTests 10 $ property $ do
    result <- evalIO $ withState $ \st -> do
        var <- newEmptyTMVarIO
        _ <- Bus.subscribe (stBus st) "pty.created" $ \event ->
            atomically $ void $ tryPutTMVar var event
        let input =
                object
                    [ "command" .= ("/bin/sh" :: Text)
                    , "sandbox" .= False
                    ]
        res <- runHandlerIO (sessionShellHandler st "session" input)
        evt <- waitVar 2000000 var
        case res of
            Left _ -> pure (res, evt)
            Right val -> do
                case lookupText "id" val of
                    Nothing -> pure (res, evt)
                    Just pid -> do
                        _ <- Pty.remove (stPtyManager st) pid
                        pure (res, evt)
    case result of
        (Left _, _) -> failure
        (Right val, evt) -> do
            let pid = lookupText "id" val
            let err = lookupText "error" val
            case (pid, err) of
                (Nothing, Nothing) -> failure
                _ -> pure ()
            case pid of
                Nothing -> pure ()
                Just _ -> assert $ evt /= Nothing

prop_promptAsyncIndex :: Property
prop_promptAsyncIndex = property $ do
    result <- evalIO $ withState $ \st -> do
        let parts = [object ["type" .= ("text" :: Text), "text" .= ("hi" :: Text)]]
        let input = CreateMessageInput Nothing parts
        res <- runHandlerIO (sessionPromptAsyncHandler st "session" input)
        case res of
            Left _ -> pure (res, False)
            Right val -> do
                let reqId = lookupText "requestID" val
                ids <- Storage.read (stStorage st) (PromptAsync.promptAsyncIndexKey "session") :: IO [Text]
                pure (res, maybe False (`elem` ids) reqId)
    case result of
        (Left _, _) -> failure
        (Right _, ok) -> assert ok

prop_ptyHandlersLifecycle :: Property
prop_ptyHandlersLifecycle = withTests 20 $ property $ do
    result <- evalIO $ withState $ \st -> do
        let input = object ["command" .= ("/bin/sh" :: Text), "sandbox" .= False]
        created <- runHandlerIO (ptyCreateHandler st input)
        case created of
            Left _ -> pure (created, Nothing)
            Right val -> do
                let pid = lookupText "id" val
                case pid of
                    Nothing -> pure (created, Nothing)
                    Just ptyId -> do
                        listed <- runHandlerIO (ptyListHandler st)
                        fetched <- runHandlerIO (ptyGetHandler st ptyId)
                        updated <- runHandlerIO (ptyUpdateHandler st ptyId (object ["title" .= ("Test" :: Text)]))
                        deleted <- runHandlerIO (ptyDeleteHandler st ptyId)
                        fetched2 <- runHandlerIO (ptyGetHandler st ptyId)
                        pure (created, Just (ptyId, listed, fetched, updated, deleted, fetched2))
    case result of
        (Left _, _) -> failure
        (Right val, Nothing) -> do
            assert $ lookupText "error" val /= Nothing
        (Right _, Just (ptyId, listed, fetched, updated, deleted, fetched2)) -> do
            case listed of
                Left _ -> failure
                Right xs -> assert $ any (\v -> lookupText "id" v == Just ptyId) xs
            case fetched of
                Left _ -> failure
                Right val -> lookupText "id" val === Just ptyId
            case updated of
                Left _ -> failure
                Right val -> lookupText "title" val === Just "Test"
            case deleted of
                Left _ -> failure
                Right ok -> ok === True
            case fetched2 of
                Left _ -> failure
                Right val -> assert $ lookupText "error" val /= Nothing

prop_ptyHandlersUnsandboxedChanges :: Property
prop_ptyHandlersUnsandboxedChanges = withTests 20 $ property $ do
    result <- evalIO $ withState $ \st -> do
        let input = object ["command" .= ("/bin/sh" :: Text), "sandbox" .= False]
        created <- runHandlerIO (ptyCreateHandler st input)
        case created of
            Left _ -> pure (created, Nothing, Nothing)
            Right val -> do
                let pid = lookupText "id" val
                case pid of
                    Nothing -> pure (created, Nothing, Nothing)
                    Just ptyId -> do
                        changes <- runHandlerIO (ptyChangesHandler st ptyId)
                        commit <- runHandlerIO (ptyCommitHandler st ptyId)
                        _ <- runHandlerIO (ptyDeleteHandler st ptyId)
                        pure (created, Just changes, Just commit)
    case result of
        (Left _, _, _) -> failure
        (Right val, Nothing, _) -> do
            assert $ lookupText "error" val /= Nothing
        (Right _, Just changes, Just commit) -> do
            case changes of
                Left _ -> failure
                Right val -> assert $ lookupText "error" val /= Nothing
            case commit of
                Left _ -> failure
                Right val -> assert $ lookupText "error" val /= Nothing
        _ -> failure

prop_ptyConnectHandler :: Property
prop_ptyConnectHandler = withTests 20 $ property $ do
    result <- evalIO $ withState $ \st -> do
        var <- newEmptyMVar
        let Tagged app = ptyConnectHandler st "missing"
        _ <- app defaultRequest $ \res -> do
            putMVar var res
            pure ResponseReceived
        res <- takeMVar var
        let (status, _headers, withBody) = responseToStream res
        box <- newEmptyMVar
        let send chunk = void $ tryPutMVar box chunk
        let flush = pure ()
        chunk <- withBody $ \body -> do
            tid <- forkIO $ body send flush
            part <- takeMVar box
            killThread tid
            pure part
        pure (status, chunk)
    case result of
        (status, chunk) -> do
            status === status400
            let text = TE.decodeUtf8 (LBS.toStrict (toLazyByteString chunk))
            assert $ "PTY not found" `T.isInfixOf` text

prop_findHandler :: Property
prop_findHandler = property $ do
    token <- forAll genName
    result <- evalIO $ withState $ \st -> do
        let root = T.unpack (stDirectory st)
        let path = root </> "find.txt"
        TIO.writeFile path ("find " <> token)
        vals <- runHandlerIO (findHandler st (Just token) Nothing Nothing)
        pure (T.pack path, vals)
    case result of
        (_, Left _) -> failure
        (path, Right vals) -> do
            let matches = filter (matchFind token path) vals
            assert $ not (null matches)

prop_findFileHandler :: Property
prop_findFileHandler = property $ do
    name <- forAll genName
    result <- evalIO $ withState $ \st -> do
        let root = T.unpack (stDirectory st)
        let path = root </> T.unpack name <> ".txt"
        TIO.writeFile path "file"
        vals <- runHandlerIO (findFileHandler st (Just "*.txt") Nothing)
        hasFd <- findExecutable "fd"
        pure (T.pack path, vals, hasFd)
    case result of
        (_, Left _, _) -> failure
        (_, Right vals, Nothing) -> vals === []
        (path, Right vals, Just _) -> do
            let matches = filter (\v -> lookupText "path" v == Just path || hasSuffix ".txt" v) vals
            assert $ not (null matches)

prop_findSymbolHandler :: Property
prop_findSymbolHandler = property $ do
    token <- forAll genName
    result <- evalIO $ withState $ \st -> do
        let root = T.unpack (stDirectory st)
        let path = root </> "symbol.txt"
        TIO.writeFile path ("symbol " <> token)
        vals <- runHandlerIO (findSymbolHandler st (Just token) Nothing)
        pure (T.pack path, vals)
    case result of
        (_, Left _) -> failure
        (path, Right vals) -> do
            let matches = filter (matchFind token path) vals
            assert $ not (null matches)

prop_vcsHandler :: Property
prop_vcsHandler = property $ do
    result <- evalIO $ withState $ \st -> do
        exe <- findExecutable "git"
        case exe of
            Nothing -> do
                res <- runHandlerIO (vcsHandler st)
                pure (res, Nothing)
            Just _ -> do
                let root = T.unpack (stDirectory st)
                (code, _, _) <- readProcessWithExitCode "git" ["-C", root, "init", "-b", "main"] ""
                case code of
                    ExitSuccess -> pure ()
                    ExitFailure _ -> do
                        _ <- readProcessWithExitCode "git" ["-C", root, "init"] ""
                        pure ()
                res <- runHandlerIO (vcsHandler st)
                pure (res, Just ())
    case result of
        (Left _, _) -> failure
        (Right info, Nothing) -> branch info === Nothing
        (Right info, Just _) -> assert $ branch info /= Nothing

prop_instanceDisposeHandler :: Property
prop_instanceDisposeHandler = property $ do
    result <- evalIO $ withState $ \st -> do
        var <- newEmptyTMVarIO
        _ <- Bus.subscribe (stBus st) "server.instance.disposed" $ \event ->
            atomically $ void $ tryPutTMVar var event
        res <- runHandlerIO (instanceDisposeHandler st)
        evt <- waitVar 1000000 var
        pure (res, evt)
    case result of
        (Left _, _) -> failure
        (Right val, evt) -> do
            lookupBool "disposed" val === Just True
            assert $ evt /= Nothing

prop_logHandler :: Property
prop_logHandler = property $ do
    msg <- forAll genText
    result <- evalIO $ withState $ \st ->
        runHandlerIO (logHandler st (object ["msg" .= msg]))
    case result of
        Left _ -> failure
        Right val -> lookupBool "ok" val === Just True

prop_globalEventHandler :: Property
prop_globalEventHandler = property $ do
    result <- evalIO $ withState $ \st -> do
        var <- newEmptyMVar
        let Tagged app = globalEventHandler st
        _ <- app defaultRequest $ \res -> do
            putMVar var res
            pure ResponseReceived
        res <- takeMVar var
        let (status, headers, withBody) = responseToStream res
        queue <- newTQueueIO
        tid <- forkIO $ withBody $ \body -> do
            let record chunk = atomically $ writeTQueue queue chunk
            body record (pure ())
        first <- readSseEvent queue
        killThread tid
        pure (status, headers, first)
    case result of
        (status, headers, event) -> do
            status === status200
            let ctype = lookup hContentType headers
            ctype === Just "text/event-stream"
            assert $ "server.connected" `T.isInfixOf` event

prop_globalEventHandlerBusEvent :: Property
prop_globalEventHandlerBusEvent = property $ do
    result <- evalIO $ withState $ \st -> do
        var <- newEmptyMVar
        let Tagged app = globalEventHandler st
        _ <- app defaultRequest $ \res -> do
            putMVar var res
            pure ResponseReceived
        res <- takeMVar var
        let (status, _, withBody) = responseToStream res
        queue <- newTQueueIO
        tid <- forkIO $ withBody $ \body -> do
            let record chunk = atomically $ writeTQueue queue chunk
            body record (pure ())
        _ <- readSseEvent queue
        Bus.publish (stBus st) "test.event" (object ["ok" .= True])
        event <- readSseEvent queue
        killThread tid
        pure (status, event)
    case result of
        (status, event) -> do
            status === status200
            assert $ "\"type\":\"test.event\"" `T.isInfixOf` event

readSseEvent :: TQueue Builder -> IO Text
readSseEvent queue = go ""
  where
    go acc = do
        chunk <- atomically $ readTQueue queue
        let textChunk = TE.decodeUtf8 (LBS.toStrict (toLazyByteString chunk))
        let merged = acc <> textChunk
        if "\n\n" `T.isInfixOf` merged
            then pure merged
            else go merged
prop_experimentalToolIdsHandler :: Property
prop_experimentalToolIdsHandler = property $ do
    result <- evalIO $ runHandlerIO experimentalToolIdsHandler
    case result of
        Left _ -> failure
        Right ids -> assert $ "bash" `elem` ids

prop_experimentalToolHandler :: Property
prop_experimentalToolHandler = property $ do
    name <- forAll genName
    result <- evalIO $ withState $ \st -> do
        let input = object ["name" .= name, "payload" .= ("ok" :: Text)]
        res <- runHandlerIO (experimentalToolHandler st input)
        stored <- Storage.read (stStorage st) ["experimental-tool", name] :: IO Value
        pure (res, stored)
    case result of
        (Left _, _) -> failure
        (Right val, stored) -> val === stored

prop_authCreateHandler :: Property
prop_authCreateHandler = property $ do
    pid <- forAll genName
    token <- forAll genName
    result <- evalIO $ withState $ \st -> do
        let input = object ["token" .= token]
        res <- runHandlerIO (authCreateHandler st pid input)
        stored <- Storage.read (stStorage st) ["auth", pid] :: IO Value
        pure (res, stored)
    case result of
        (Left _, _) -> failure
        (Right val, stored) -> do
            lookupBool "authenticated" val === Just True
            lookupText "token" stored === Just token

prop_authUpdateHandler :: Property
prop_authUpdateHandler = property $ do
    pid <- forAll genName
    tok1 <- forAll genName
    tok2 <- forAll genName
    result <- evalIO $ withState $ \st -> do
        let inputA = object ["token" .= tok1]
        let inputB = object ["token" .= tok2]
        _ <- runHandlerIO (authCreateHandler st pid inputA)
        res <- runHandlerIO (authUpdateHandler st pid inputB)
        stored <- Storage.read (stStorage st) ["auth", pid] :: IO Value
        pure (res, stored)
    case result of
        (Left _, _) -> failure
        (Right val, stored) -> do
            lookupBool "authenticated" val === Just True
            lookupText "token" stored === Just tok2

prop_authDeleteHandler :: Property
prop_authDeleteHandler = property $ do
    pid <- forAll genName
    token <- forAll genName
    result <- evalIO $ withState $ \st -> do
        let input = object ["token" .= token]
        _ <- runHandlerIO (authCreateHandler st pid input)
        res <- runHandlerIO (authDeleteHandler st pid)
        keys <- Storage.list (stStorage st) ["auth"]
        let removed = not $ any (\key -> key == ["auth", pid]) keys
        pure (res, removed)
    case result of
        (Left _, _) -> failure
        (Right val, removed) -> do
            lookupBool "authenticated" val === Just False
            assert removed

tests :: TestTree
tests =
    testGroup
        "Handler Property Tests"
        [ testProperty "health handler" prop_healthHandler
        , testProperty "path handler" prop_pathHandler
        , testProperty "global config handler" prop_globalConfigHandler
        , testProperty "project handlers" prop_projectHandlers
        , testProperty "provider list handler" prop_providerListHandler
        , testProperty "provider auth handler" prop_providerAuthHandler
        , testProperty "provider handler" prop_providerHandler
        , testProperty "provider oauth handlers" prop_providerOauthHandlers
        , testProperty "config handler" prop_configHandler
        , testProperty "command handler" prop_commandHandler
        , testProperty "agent handler" prop_agentHandler
        , testProperty "session status handler" prop_sessionStatusHandler
        , testProperty "session lifecycle handler" prop_sessionLifecycleHandler
        , testProperty "session children handler" prop_sessionChildrenHandler
        , testProperty "session todo handler" prop_sessionTodoHandler
        , testProperty "session init handler" prop_sessionInitHandler
        , testProperty "session fork handler" prop_sessionForkHandler
        , testProperty "session abort handler" prop_sessionAbortHandler
        , testProperty "session share handlers" prop_sessionShareHandlers
        , testProperty "session diff handler" prop_sessionDiffHandler
        , testProperty "session summarize handler" prop_sessionSummarizeHandler
        , testProperty "session revert handlers" prop_sessionRevertHandlers
        , testProperty "session permission handler" prop_sessionPermissionHandler
        , testProperty "session message handlers" prop_sessionMessageHandlers
        , testProperty "session message part handlers" prop_sessionMessagePartHandlers
        , testProperty "lsp handler" prop_lspHandler
        , testProperty "permission handlers" prop_permissionHandlers
        , testProperty "question handlers" prop_questionHandlers
        , testProperty "file status handler" prop_fileStatusHandler
        , testProperty "tui handlers" prop_tuiHandlers
        , testProperty "skill handler" prop_skillHandler
        , testProperty "formatter handler" prop_formatterHandler
        , testProperty "experimental worktree handlers" prop_experimentalWorktreeHandlers
        , testProperty "file list handler" prop_fileListHandler
        , testProperty "file read handler" prop_fileReadHandler
        , testProperty "file read handler binary" prop_fileReadHandlerBinary
        , testProperty "chat handler anthropic missing" prop_chatHandlerAnthropicMissing
        , testProperty "chat handler openrouter missing" prop_chatHandlerOpenRouterMissing
        , testProperty "session command handler" prop_sessionCommandHandler
        , testProperty "session shell handler" prop_sessionShellHandler
        , testProperty "prompt async index" prop_promptAsyncIndex
        , testProperty "pty handler lifecycle" prop_ptyHandlersLifecycle
        , testProperty "pty handler unsandboxed changes" prop_ptyHandlersUnsandboxedChanges
        , testProperty "pty connect handler" prop_ptyConnectHandler
        , testProperty "find handler" prop_findHandler
        , testProperty "find file handler" prop_findFileHandler
        , testProperty "find symbol handler" prop_findSymbolHandler
        , testProperty "vcs handler" prop_vcsHandler
        , testProperty "instance dispose handler" prop_instanceDisposeHandler
        , testProperty "log handler" prop_logHandler
        , testProperty "global event handler" prop_globalEventHandler
        , testProperty "global event handler bus event" prop_globalEventHandlerBusEvent
        , testProperty "experimental tool ids handler" prop_experimentalToolIdsHandler
        , testProperty "experimental tool handler" prop_experimentalToolHandler
        , testProperty "auth create handler" prop_authCreateHandler
        , testProperty "auth update handler" prop_authUpdateHandler
        , testProperty "auth delete handler" prop_authDeleteHandler
        ]
