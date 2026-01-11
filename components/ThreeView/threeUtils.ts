import * as THREE from "three";

export const disposeMaterial = (
  material: THREE.Material | THREE.Material[]
) => {
  if (Array.isArray(material)) {
    material.forEach((m) => m.dispose());
    return;
  }
  material.dispose();
};

export const clearThreeGroup = (group: THREE.Group) => {
  while (group.children.length > 0) {
    const obj = group.children[0] as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) disposeMaterial(obj.material);
    group.remove(obj);
  }
};
