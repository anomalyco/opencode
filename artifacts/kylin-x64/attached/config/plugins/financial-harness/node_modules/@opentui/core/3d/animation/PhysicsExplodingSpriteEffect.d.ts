import * as THREE from "three";
import { NodeMaterial } from "three/webgpu";
import type { TiledSprite, SpriteDefinition, SpriteAnimator } from "./SpriteAnimator.js";
import type { PhysicsWorld } from "../physics/physics-interface.js";
import type { SpriteResource } from "../SpriteResourceManager.js";
export interface PhysicsExplosionEffectParameters {
    numRows: number;
    numCols: number;
    durationMs: number;
    explosionForce: number;
    forceVariation: number;
    torqueStrength: number;
    gravityScale: number;
    fadeOut: boolean;
    linearDamping: number;
    angularDamping: number;
    restitution: number;
    friction: number;
    density: number;
    materialFactory: () => NodeMaterial;
}
export declare const DEFAULT_PHYSICS_EXPLOSION_PARAMETERS: PhysicsExplosionEffectParameters;
export interface PhysicsExplosionCreationData {
    resource: SpriteResource;
    frameUvOffset: THREE.Vector2;
    frameUvSize: THREE.Vector2;
    spriteWorldTransform: THREE.Matrix4;
}
export interface PhysicsSpriteRecreationData {
    definition: SpriteDefinition;
    currentTransform: {
        position: THREE.Vector3;
        quaternion: THREE.Quaternion;
        scale: THREE.Vector3;
    };
}
export interface PhysicsExplosionHandle {
    readonly effect: PhysicsExplodingSpriteEffect;
    readonly recreationData: PhysicsSpriteRecreationData;
    hasBeenRestored: boolean;
    restoreSprite: (spriteAnimator: SpriteAnimator) => Promise<TiledSprite | null>;
}
export declare class PhysicsExplodingSpriteEffect {
    private static materialCache;
    private scene;
    private physicsWorld;
    private resource;
    private frameUvOffset;
    private frameUvSize;
    private spriteWorldTransform;
    private params;
    private particles;
    private numParticles;
    private instancedMesh;
    private material;
    private uvOffsetAttribute;
    isActive: boolean;
    private timeElapsedMs;
    private particleIdCounter;
    constructor(scene: THREE.Scene, physicsWorld: PhysicsWorld, resource: SpriteResource, frameUvOffset: THREE.Vector2, frameUvSize: THREE.Vector2, spriteWorldTransform: THREE.Matrix4, userParams?: Partial<PhysicsExplosionEffectParameters>);
    private _createPhysicsParticles;
    static getSharedMaterial(texture: THREE.DataTexture, materialFactory: () => NodeMaterial): NodeMaterial;
    update(deltaTimeMs: number): void;
    dispose(): void;
}
export declare class PhysicsExplosionManager {
    private scene;
    private physicsWorld;
    private activeExplosions;
    constructor(scene: THREE.Scene, physicsWorld: PhysicsWorld);
    fillPool(resource: SpriteResource, count: number, params?: Partial<PhysicsExplosionEffectParameters>): void;
    private _createEffectCreationData;
    createExplosionForSprite(spriteToExplode: TiledSprite, userParams?: Partial<PhysicsExplosionEffectParameters>): Promise<PhysicsExplosionHandle | null>;
    update(deltaTimeMs: number): void;
    disposeAll(): void;
}
