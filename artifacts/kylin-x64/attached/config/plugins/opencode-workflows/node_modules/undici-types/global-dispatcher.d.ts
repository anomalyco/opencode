import Dispatcher from "./dispatcher";

export {
  getGlobalDispatcher,
  setGlobalDispatcher
}

declare function setGlobalDispatcher<DispatcherImplementation extends Dispatcher>(dispatcher: DispatcherImplementation): void;
declare function getGlobalDispatcher(): Dispatcher;
