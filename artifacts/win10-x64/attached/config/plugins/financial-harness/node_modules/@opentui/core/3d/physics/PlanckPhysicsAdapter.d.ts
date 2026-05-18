import * as planck from "planck";
import type { PhysicsVector2, PhysicsRigidBodyDesc, PhysicsColliderDesc, PhysicsRigidBody, PhysicsWorld } from "./physics-interface.js";
export declare class PlanckRigidBody implements PhysicsRigidBody {
    private planckBody;
    constructor(planckBody: planck.Body);
    applyImpulse(force: PhysicsVector2): void;
    applyTorqueImpulse(torque: number): void;
    getTranslation(): PhysicsVector2;
    getRotation(): number;
    get nativeBody(): planck.Body;
}
export declare class PlanckPhysicsWorld implements PhysicsWorld {
    private planckWorld;
    constructor(planckWorld: planck.World);
    createRigidBody(desc: PhysicsRigidBodyDesc): PhysicsRigidBody;
    createCollider(colliderDesc: PhysicsColliderDesc, rigidBody: PhysicsRigidBody): void;
    removeRigidBody(rigidBody: PhysicsRigidBody): void;
    static createFromPlanckWorld(planckWorld: planck.World): PlanckPhysicsWorld;
}
