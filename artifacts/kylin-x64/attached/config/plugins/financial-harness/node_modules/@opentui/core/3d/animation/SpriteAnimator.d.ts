import * as THREE from "three";
import { NodeMaterial } from "three/webgpu";
import type { Scene } from "three";
import { type SpriteResource, InstanceManager } from "../SpriteResourceManager.js";
export interface AnimationStateConfig {
    imagePath: string;
    sheetNumFrames: number;
    animNumFrames: number;
    animFrameOffset: number;
    frameDuration?: number;
    loop?: boolean;
    initialFrame?: number;
    flipX?: boolean;
    flipY?: boolean;
}
export type ResolvedAnimationState = Required<AnimationStateConfig> & {
    sheetTilesetWidth: number;
    sheetTilesetHeight: number;
    texture: THREE.DataTexture;
};
export interface AnimationDefinition {
    resource: SpriteResource;
    animNumFrames?: number;
    animFrameOffset?: number;
    frameDuration?: number;
    loop?: boolean;
    initialFrame?: number;
    flipX?: boolean;
    flipY?: boolean;
}
export interface SpriteDefinition {
    id?: string;
    renderOrder?: number;
    depthWrite?: boolean;
    maxInstances?: number;
    scale?: number;
    initialAnimation: string;
    animations: Record<string, AnimationDefinition>;
}
declare class Animation {
    readonly name: string;
    state: ResolvedAnimationState;
    private resource;
    instanceIndex: number;
    private instanceManager;
    private frameAttribute;
    private flipAttribute;
    currentLocalFrame: number;
    timeAccumulator: number;
    isPlaying: boolean;
    private _isActive;
    constructor(name: string, state: ResolvedAnimationState, resource: SpriteResource, instanceIndex: number, instanceManager: InstanceManager, frameAttribute: THREE.InstancedBufferAttribute, flipAttribute: THREE.InstancedBufferAttribute);
    activate(worldTransform: THREE.Matrix4): void;
    deactivate(): void;
    updateVisuals(worldTransform: THREE.Matrix4): void;
    updateTime(deltaTimeMs: number): boolean;
    play(): void;
    stop(): void;
    goToFrame(localFrame: number): void;
    setFrameDuration(newFrameDuration: number): void;
    getResource(): SpriteResource;
    releaseInstanceSlot(): void;
}
export declare class TiledSprite {
    readonly id: string;
    private animator;
    private _animations;
    private _currentAnimation;
    private _transformObject;
    private _reusableMatrix;
    private _reusableAnimGeomScale;
    private _isVisibleState;
    private originalDefinition;
    constructor(id: string, userSpriteDefinition: SpriteDefinition, animator: SpriteAnimator, animationInstanceParams: Array<{
        name: string;
        state: ResolvedAnimationState;
        resource: SpriteResource;
        index: number;
        instanceManager: InstanceManager;
        frameAttribute: THREE.InstancedBufferAttribute;
        flipAttribute: THREE.InstancedBufferAttribute;
    }>);
    private _calculateAnimationWorldMatrix;
    get currentAnimation(): Animation;
    private updateCurrentAnimationVisuals;
    setPosition(position: THREE.Vector3): void;
    setRotation(rotation: THREE.Quaternion): void;
    setScale(scale: THREE.Vector3): void;
    getScale(): THREE.Vector3;
    setTransform(position: THREE.Vector3, rotation: THREE.Quaternion, newScale: THREE.Vector3): void;
    play(): void;
    stop(): void;
    goToFrame(frame: number): void;
    setFrameDuration(newFrameDuration: number): void;
    isPlaying(): boolean;
    setAnimation(animationName: string): Promise<void>;
    update(deltaTime: number): void;
    destroy(): void;
    getCurrentAnimationName(): string;
    getWorldTransform(): THREE.Matrix4;
    getWorldPlaneSize(): THREE.Vector2;
    get visible(): boolean;
    set visible(value: boolean);
    get definition(): SpriteDefinition;
    get currentTransform(): {
        position: THREE.Vector3;
        quaternion: THREE.Quaternion;
        scale: THREE.Vector3;
    };
}
export declare class SpriteAnimator {
    private scene;
    private instances;
    private _idCounter;
    private instanceManagers;
    constructor(scene: Scene);
    private createSpriteAnimationMaterial;
    private getOrCreateInstanceManager;
    createSprite(userSpriteDefinition: SpriteDefinition, materialFactory?: () => NodeMaterial): Promise<TiledSprite>;
    update(deltaTime: number): void;
    removeSprite(id: string): void;
    removeAllSprites(): void;
}
export {};
