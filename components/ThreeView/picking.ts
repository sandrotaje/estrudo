import * as THREE from "three";

export type ExtractedFace = {
  vertices: Float32Array;
  boundary: THREE.Line3[];
  normal: THREE.Vector3;
};

export const extractCoplanarFace = (
  mesh: THREE.Mesh,
  faceIndex: number
): ExtractedFace => {
  const geometry = mesh.geometry;
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const getV = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
  const i1 = idx ? idx.getX(faceIndex * 3) : faceIndex * 3;
  const i2 = idx ? idx.getY(faceIndex * 3) : faceIndex * 3 + 1;
  const i3 = idx ? idx.getZ(faceIndex * 3) : faceIndex * 3 + 2;
  const vA = getV(i1),
    vB = getV(i2),
    vC = getV(i3);
  const n = new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(vB, vA),
    new THREE.Vector3().subVectors(vC, vA)
  );
  if (n.lengthSq() < 1e-12)
    return {
      vertices: new Float32Array([]),
      boundary: [],
      normal: new THREE.Vector3(0, 0, 1),
    };
  n.normalize();
  const constant = -n.dot(vA);
  const vertices: number[] = [];
  const edges = new Map<
    string,
    { a: THREE.Vector3; b: THREE.Vector3; count: number }
  >();
  const key = (v: THREE.Vector3) =>
    `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
  const edgeKey = (va: THREE.Vector3, vb: THREE.Vector3) => {
    const ka = key(va),
      kb = key(vb);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const count = idx ? idx.count / 3 : pos.count / 3;
  const tempV = new THREE.Vector3();
  for (let f = 0; f < count; f++) {
    const idx1 = idx ? idx.getX(f * 3) : f * 3;
    const idx2 = idx ? idx.getY(f * 3) : f * 3 + 1;
    const idx3 = idx ? idx.getZ(f * 3) : f * 3 + 2;
    tempV.fromBufferAttribute(pos, idx1);
    if (Math.abs(tempV.dot(n) + constant) > 0.002) continue;
    const va = getV(idx1),
      vb = getV(idx2),
      vc = getV(idx3);
    const fn = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(vb, va),
        new THREE.Vector3().subVectors(vc, va)
      )
      .normalize();
    if (fn.dot(n) < 0.9) continue;
    vertices.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
    [
      [va, vb],
      [vb, vc],
      [vc, va],
    ].forEach((pair) => {
      const k = edgeKey(pair[0], pair[1]);
      if (!edges.has(k)) edges.set(k, { a: pair[0], b: pair[1], count: 0 });
      edges.get(k)!.count++;
    });
  }
  const boundary: THREE.Line3[] = [];
  edges.forEach((e) => {
    if (e.count === 1) boundary.push(new THREE.Line3(e.a, e.b));
  });
  return { vertices: new Float32Array(vertices), boundary, normal: n };
};

export const setRayFromMouseEvent = (
  raycaster: THREE.Raycaster,
  mouse: THREE.Vector2,
  event: { clientX: number; clientY: number },
  rect: DOMRect,
  camera: THREE.Camera
) => {
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
};

export const pickSketchElementId = (
  raycaster: THREE.Raycaster,
  sketchObjects: THREE.Object3D[]
) => {
  raycaster.params.Line.threshold = 3.0;
  const sketchIntersects = raycaster.intersectObjects(sketchObjects, true);
  if (sketchIntersects.length === 0) return null;
  const sketchId = sketchIntersects[0].object.userData.sketchId;
  return sketchId || null;
};

export const pickFaceData = (
  raycaster: THREE.Raycaster,
  objectsToCheck: THREE.Object3D[]
) => {
  const intersects = raycaster.intersectObjects(objectsToCheck, true);
  if (intersects.length === 0) return null;

  const hit = intersects[0];
  const mesh = hit.object as THREE.Mesh;
  if (!hit.face) return null;

  const faceData = extractCoplanarFace(mesh, hit.faceIndex!);
  if (faceData.vertices.length === 0) return null;

  const normalWorld = faceData.normal
    .clone()
    .transformDirection(mesh.matrixWorld)
    .normalize();

  return {
    point: hit.point,
    normal: normalWorld,
    boundaryEdges: faceData.boundary,
    faceVertices: faceData.vertices,
    matrixWorld: mesh.matrixWorld,
  };
};
