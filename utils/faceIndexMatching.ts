import * as THREE from "three";

/**
 * Given a picked point/normal from Three.js raycasting and a Replicad shape,
 * finds which Replicad face index corresponds to that pick.
 */
export function findReplicadFaceIndex(
  replicadShape: any,
  pickedPoint: THREE.Vector3,
  pickedNormal: THREE.Vector3
): number | undefined {
  try {
    const faces = replicadShape.faces;
    if (!faces || faces.length === 0) return undefined;
    
    const targetNormal = pickedNormal.clone().normalize();
    
    // Find the face with closest center to picked point and similar normal
    let bestIndex: number | undefined;
    let bestScore = Infinity;
    
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      const center = face.center;
      const normal = face.normalAt();
      
      const faceCenter = new THREE.Vector3(center.x, center.y, center.z);
      const faceNormal = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
      
      const distance = faceCenter.distanceTo(pickedPoint);
      const normalSimilarity = faceNormal.dot(targetNormal);
      
      // Only consider faces with very similar normals (within 15 degrees)
      if (normalSimilarity < 0.95) continue;
      
      const score = distance;
      
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    
    if (bestIndex !== undefined) {
      console.log(`Matched picked face to Replicad face index ${bestIndex} (distance: ${bestScore.toFixed(2)})`);
    }
    
    return bestIndex;
  } catch (error) {
    console.error("Failed to find Replicad face index:", error);
    return undefined;
  }
}
