import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three"
import type { DesignMaterial, DesignObject, DesignShape } from "./model"

export function createGeometry(shape: DesignShape): BufferGeometry {
  switch (shape) {
    case "box":
      return new BoxGeometry(1, 1, 1, 1, 1, 1)
    case "sphere":
      return new SphereGeometry(0.75, 48, 32)
    case "cylinder":
      return new CylinderGeometry(0.55, 0.55, 1.2, 48)
    case "cone":
      return new ConeGeometry(0.65, 1.2, 48)
    case "torus":
      return new TorusGeometry(0.6, 0.2, 24, 64)
    case "plane":
      return new PlaneGeometry(4, 4, 1, 1)
  }
}

export function createMaterial(material: DesignMaterial, shape: DesignShape): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: material.color,
    metalness: material.metalness,
    roughness: material.roughness,
    emissive: material.emissive,
    emissiveIntensity: material.emissiveIntensity,
    opacity: material.opacity,
    transparent: material.opacity < 1,
    wireframe: material.wireframe,
    side: shape === "plane" ? DoubleSide : FrontSide,
  })
}

export function createMesh(object: DesignObject): Mesh {
  const mesh = new Mesh(createGeometry(object.shape), createMaterial(object.material, object.shape))

  mesh.name = object.name
  mesh.userData.designId = object.id
  mesh.position.set(...object.position)
  mesh.rotation.set(...object.rotation)
  mesh.scale.set(...object.scale)
  mesh.visible = object.visible
  mesh.castShadow = object.shape !== "plane"
  mesh.receiveShadow = true

  return mesh
}

export function syncMesh(mesh: Mesh, object: DesignObject) {
  mesh.name = object.name
  mesh.position.set(...object.position)
  mesh.rotation.set(...object.rotation)
  mesh.scale.set(...object.scale)
  mesh.visible = object.visible

  const material = mesh.material

  if (!(material instanceof MeshStandardMaterial)) return
  material.color.set(object.material.color)
  material.metalness = object.material.metalness
  material.roughness = object.material.roughness
  material.emissive.set(object.material.emissive)
  material.emissiveIntensity = object.material.emissiveIntensity
  material.opacity = object.material.opacity
  material.transparent = object.material.opacity < 1
  material.wireframe = object.material.wireframe
  material.side = object.shape === "plane" ? DoubleSide : FrontSide
  material.needsUpdate = true
}

export function disposeMesh(mesh: Mesh) {
  mesh.geometry.dispose()

  if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose())
  else mesh.material.dispose()
}
