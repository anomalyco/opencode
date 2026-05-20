export {
	setGlobalOrigin,
	getGlobalOrigin
}
  
declare function setGlobalOrigin(origin: string | URL | undefined): void;
declare function getGlobalOrigin(): URL | undefined;