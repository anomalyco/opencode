import * as THREE from "three";
import { NodeMaterial } from "three/webgpu";
import type { TiledSprite, SpriteDefinition, SpriteAnimator } from "./SpriteAnimator.js";
import type { SpriteResource } from "../SpriteResourceManager.js";
export interface ExplosionEffectParameters {
    numRows: number;
    numCols: number;
    durationMs: number;
    strength: number;
    strengthVariation: number;
    gravity: number;
    gravityScale: number;
    fadeOut: boolean;
    angularVelocityMin: THREE.Vector3;
    angularVelocityMax: THREE.Vector3;
    initialVelocityYBoost: number;
    zVariationStrength: number;
    materialFactory: () => NodeMaterial;
}
export declare const DEFAULT_EXPLOSION_PARAMETERS: ExplosionEffectParameters;
export interface ExplosionCreationData {
    resource: SpriteResource;
    frameUvOffset: THREE.Vector2;
    frameUvSize: THREE.Vector2;
    spriteWorldTransform: THREE.Matrix4;
}
export interface SpriteRecreationData {
    definition: SpriteDefinition;
    currentTransform: {
        position: THREE.Vector3;
        quaternion: THREE.Quaternion;
        scale: THREE.Vector3;
    };
}
export interface ExplosionHandle {
    readonly effect: ExplodingSpriteEffect;
    readonly recreationData: SpriteRecreationData;
    hasBeenRestored: boolean;
    restoreSprite: (spriteAnimator: SpriteAnimator) => Promise<TiledSprite | null>;
}
export declare class ExplodingSpriteEffect {
    private static baseMaterialCache;
    private scene;
    private resource;
    private frameUvOffset;
    private frameUvSize;
    private spriteWorldTransform;
    private params;
    private instancedMesh;
    private material;
    private numParticles;
    private uniformRefs;
    isActive: boolean;
    private timeElapsedMs;
    constructor(scene: THREE.Scene, resource: SpriteResource, frameUvOffset: THREE.Vector2, frameUvSize: THREE.Vector2, spriteWorldTransform: THREE.Matrix4, userParams?: Partial<ExplosionEffectParameters>);
    private _createGPUParticles;
    private _createGPUMaterial;
    static _buildTemplateMaterial(texture: THREE.DataTexture, params: ExplosionEffectParameters, materialFactory: () => NodeMaterial): NodeMaterial;
    update(deltaTimeMs: number): void;
    dispose(): void;
}
export declare class ExplosionManager {
    private scene;
    private activeExplosions;
    constructor(scene: THREE.Scene);
    fillPool(resource: SpriteResource, count: number, params?: Partial<ExplosionEffectParameters>): void;
    private _createEffectCreationData;
    createExplosionForSprite(spriteToExplode: TiledSprite, userParams?: Partial<ExplosionEffectParameters>): ExplosionHandle | null;
    update(deltaTimeMs: number): void;
    disposeAll(): void;
}
