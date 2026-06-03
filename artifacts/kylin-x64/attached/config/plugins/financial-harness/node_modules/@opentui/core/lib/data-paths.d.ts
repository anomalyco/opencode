import { EventEmitter } from "events";
export interface DataPaths {
    globalConfigPath: string;
    globalConfigFile: string;
    localConfigFile: string;
    globalDataPath: string;
}
export interface DataPathsEvents {
    "paths:changed": [paths: DataPaths];
}
export declare class DataPathsManager extends EventEmitter<DataPathsEvents> {
    private _appName;
    private _globalConfigPath?;
    private _globalConfigFile?;
    private _localConfigFile?;
    private _globalDataPath?;
    constructor();
    get appName(): string;
    set appName(value: string);
    get globalConfigPath(): string;
    get globalConfigFile(): string;
    get localConfigFile(): string;
    get globalDataPath(): string;
    toObject(): DataPaths;
}
export declare function getDataPaths(): DataPathsManager;
