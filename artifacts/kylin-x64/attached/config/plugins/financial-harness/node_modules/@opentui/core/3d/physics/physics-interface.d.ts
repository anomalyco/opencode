export interface PhysicsVector2 {
    x: number;
    y: number;
}
export interface PhysicsRigidBodyDesc {
    translation: PhysicsVector2;
    linearDamping: number;
    angularDamping: number;
}
export interface PhysicsColliderDesc {
    width: number;
    height: number;
    restitution: number;
    friction: number;
    density: number;
}
export interface PhysicsRigidBody {
    applyImpulse(force: PhysicsVector2): void;
    applyTorqueImpulse(torque: number): void;
    getTranslation(): PhysicsVector2;
    getRotation(): number;
}
export interface PhysicsWorld {
    createRigidBody(desc: PhysicsRigidBodyDesc): PhysicsRigidBody;
    createCollider(colliderDesc: PhysicsColliderDesc, rigidBody: PhysicsRigidBody): void;
    removeRigidBody(rigidBody: PhysicsRigidBody): void;
}
