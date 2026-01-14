import * as THREE from "three";

/**
 * Attempts to find a face on a Replicad shape that matches the given descriptor.
 * Returns face data (normal, boundary edges, etc.) if found, or null if no match.
 * 
 * Strategy: Use Replicad's native .faces property to iterate through CAD faces,
 * find the one with the most similar normal and closest centroid.
 */
export function findMatchingFace(
  replicadShape: any,
  faceDescriptor: { point: [number, number, number]; normal: [number, number, number]; faceIndex?: number }
): {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  boundaryEdges: THREE.Line3[];
  matrixWorld: THREE.Matrix4;
  replicadFace: any;
} | null {
  try {
    // Get all faces from the Replicad shape
    const faces = replicadShape.faces;
    
    if (!faces || faces.length === 0) {
      console.warn("Shape has no faces");
      return null;
    }
    
    const targetPoint = new THREE.Vector3(...faceDescriptor.point);
    const targetNormal = new THREE.Vector3(...faceDescriptor.normal).normalize();
    
    console.log(`Searching ${faces.length} faces for match to center=${targetPoint.toArray().map(v => v.toFixed(2))}, normal=${targetNormal.toArray().map(v => v.toFixed(2))}`);
    
    // If we have a faceIndex hint, try that first
    if (faceDescriptor.faceIndex !== undefined && faceDescriptor.faceIndex < faces.length) {
      const hintedFace = faces[faceDescriptor.faceIndex];
      const center = hintedFace.center;
      const normal = hintedFace.normalAt();
      
      const faceCenter = new THREE.Vector3(center.x, center.y, center.z);
      const faceNormal = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
      
      const distance = faceCenter.distanceTo(targetPoint);
      const normalSimilarity = faceNormal.dot(targetNormal);
      
      // If hint is very close, use it
      if (normalSimilarity > 0.95 && distance < 5.0) {
        console.log(`Using hinted face index ${faceDescriptor.faceIndex}`);
        return extractFaceData(hintedFace);
      }
    }
    
    // Score all faces
    type FaceCandidate = {
      face: any;
      faceIndex: number;
      center: THREE.Vector3;
      normal: THREE.Vector3;
      score: number;
    };
    
    const candidates: FaceCandidate[] = [];
    
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      const center = face.center;
      const normal = face.normalAt();
      
      const faceCenter = new THREE.Vector3(center.x, center.y, center.z);
      const faceNormal = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
      
      // Score based on normal similarity and distance
      const normalSimilarity = faceNormal.dot(targetNormal);
      const distance = faceCenter.distanceTo(targetPoint);
      
      // Only consider faces with reasonably similar normals (within ~30 degrees)
      if (normalSimilarity < 0.85) continue;
      
      const score = (1 - normalSimilarity) * 100 + distance;
      
      candidates.push({
        face,
        faceIndex: i,
        center: faceCenter,
        normal: faceNormal,
        score
      });
    }
    
    if (candidates.length === 0) {
      console.warn("No matching face found - no candidates with similar normal");
      return null;
    }
    
    // Sort by score and pick the best
    candidates.sort((a, b) => a.score - b.score);
    const bestCandidate = candidates[0];
    
    console.log(`Found ${candidates.length} candidate faces, best: index=${bestCandidate.faceIndex}, score=${bestCandidate.score.toFixed(3)}`);
    
    return extractFaceData(bestCandidate.face);
    
  } catch (error) {
    console.error("Failed to find matching face:", error);
    return null;
  }
}

/**
 * Extracts boundary edges from a Replicad Face and converts to Three.js format
 */
function extractFaceData(replicadFace: any): {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  boundaryEdges: THREE.Line3[];
  matrixWorld: THREE.Matrix4;
  replicadFace: any;
} {
  const center = replicadFace.center;
  const normal = replicadFace.normalAt();
  
  const faceCenter = new THREE.Vector3(center.x, center.y, center.z);
  const faceNormal = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
  
  // Get the outer wire (boundary) of the face
  const outerWire = replicadFace.outerWire();
  const edges = outerWire.edges;
  
  // Convert each edge to THREE.Line3
  const boundaryEdges: THREE.Line3[] = [];
  
  for (const edge of edges) {
    const startPt = edge.startPoint;
    const endPt = edge.endPoint;
    
    const start = new THREE.Vector3(startPt.x, startPt.y, startPt.z);
    const end = new THREE.Vector3(endPt.x, endPt.y, endPt.z);
    
    boundaryEdges.push(new THREE.Line3(start, end));
  }
  
  return {
    point: faceCenter,
    normal: faceNormal,
    boundaryEdges,
    matrixWorld: new THREE.Matrix4(), // Identity - Replicad shapes are already in world space
    replicadFace
  };
}
