import * as THREE from "three";

export const replicadToThree = (
  shape: any,
  tolerance: number = 0.1,
  angularTolerance: number = 0.1
): THREE.BufferGeometry => {
  const mesh = shape.mesh({
    tolerance,
    angularTolerance,
  });

  const geometry = new THREE.BufferGeometry();
  
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(mesh.vertices, 3)
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(mesh.normals, 3)
  );
  
  if (mesh.triangles) {
    geometry.setIndex(new THREE.Uint32BufferAttribute(mesh.triangles, 1));
  }

  return geometry;
};
