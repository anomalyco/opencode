import * as THREE from "three";
import type { Scene } from "three";
export interface ResourceConfig {
    imagePath: string;
    sheetNumFrames: number;
}
export interface SheetProperties {
    imagePath: string;
    sheetTilesetWidth: number;
    sheetTilesetHeight: number;
    sheetNumFrames: number;
}
export interface InstanceManagerOptions {
    maxInstances: number;
    renderOrder?: number;
    depthWrite?: boolean;
    name?: string;
    frustumCulled?: boolean;
    matrix?: THREE.Matrix4;
}
export interface MeshPoolOptions {
    geometry: () => THREE.BufferGeometry;
    material: THREE.Material;
    maxInstances: number;
    name?: string;
}
export declare class MeshPool {
    private pools;
    acquireMesh(poolId: string, options: MeshPoolOptions): THREE.InstancedMesh;
    releaseMesh(poolId: string, mesh: THREE.InstancedMesh): void;
    fill(poolId: string, options: MeshPoolOptions, count: number): void;
    clearPool(poolId: string): void;
    clearAllPools(): void;
}
export declare class InstanceManager {
    private scene;
    private instancedMesh;
    private material;
    private maxInstances;
    private _freeIndices;
    private instanceCount;
    private _matrix;
    constructor(scene: Scene, geometry: THREE.BufferGeometry, material: THREE.Material, options: InstanceManagerOptions);
    acquireInstanceSlot(): number;
    releaseInstanceSlot(instanceIndex: number): void;
    getInstanceCount(): number;
    getMaxInstances(): number;
    get hasFreeIndices(): boolean;
    get mesh(): THREE.InstancedMesh;
    dispose(): void;
}
export declare class SpriteResource {
    private _texture;
    private _sheetProperties;
    private scene;
    private _meshPool;
    constructor(texture: THREE.DataTexture, sheetProperties: SheetProperties, scene: Scene);
    get texture(): THREE.DataTexture;
    get sheetProperties(): SheetProperties;
    get meshPool(): MeshPool;
    createInstanceManager(geometry: THREE.BufferGeometry, material: THREE.Material, options: InstanceManagerOptions): InstanceManager;
    get uvTileSize(): THREE.Vector2;
    dispose(): void;
}
export declare class SpriteResourceManager {
    private resources;
    private textureCache;
    private scene;
    constructor(scene: Scene);
    private getResourceKey;
    getOrCreateResource(texture: THREE.DataTexture, sheetProps: SheetProperties): Promise<SpriteResource>;
    createResource(config: ResourceConfig): Promise<SpriteResource>;
    clearCache(): void;
}
