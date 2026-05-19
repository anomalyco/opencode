import RAPIER from "@dimforge/rapier2d-simd-compat";
import type { PhysicsVector2, PhysicsRigidBodyDesc, PhysicsColliderDesc, PhysicsRigidBody, PhysicsWorld } from "./physics-interface.js";
export declare class RapierRigidBody implements PhysicsRigidBody {
    private rapierBody;
    constructor(rapierBody: RAPIER.RigidBody);
    applyImpulse(force: PhysicsVector2): void;
    applyTorqueImpulse(torque: number): void;
    getTranslation(): PhysicsVector2;
    getRotation(): number;
    get nativeBody(): RAPIER.RigidBody;
}
export declare class RapierPhysicsWorld implements PhysicsWorld {
    private rapierWorld;
    constructor(rapierWorld: RAPIER.World);
    createRigidBody(desc: PhysicsRigidBodyDesc): PhysicsRigidBody;
    createCollider(colliderDesc: PhysicsColliderDesc, rigidBody: PhysicsRigidBody): void;
    removeRigidBody(rigidBody: PhysicsRigidBody): void;
    static createFromRapierWorld(rapierWorld: RAPIER.World): RapierPhysicsWorld;
}
