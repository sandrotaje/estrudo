import * as THREE from 'three';

export interface Point2D {
  x: number;
  y: number;
}

export interface CircleFit {
  center: Point2D;
  radius: number;
  rmsError: number;
}

export interface CircleDetection {
  center: Point2D;
  radius: number;
  isFullCircle: boolean;
  startAngle?: number; // In radians
  endAngle?: number; // In radians
  points: Point2D[];
  rmsError: number;
}

const TOLERANCE_MM = 0.1; // Maximum RMS error for circle detection
const MIN_POINTS_FOR_CIRCLE = 8; // Minimum points to confidently detect a circle
const MIN_ARC_ANGLE = (10 * Math.PI) / 180; // Minimum 10 degrees for arc
const FULL_CIRCLE_GAP_THRESHOLD = (5 * Math.PI) / 180; // 5 degrees

/**
 * Fits a circle to a set of 2D points using least-squares minimization
 * Returns null if the fit quality is poor (RMS error > tolerance)
 */
export function fitCircleToPoints(points: Point2D[]): CircleFit | null {
  if (points.length < 3) {
    return null;
  }

  // Compute mean (centroid)
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / points.length;
  const meanY = sumY / points.length;

  // Center coordinates relative to centroid
  const u: number[] = [];
  const v: number[] = [];
  for (const p of points) {
    u.push(p.x - meanX);
    v.push(p.y - meanY);
  }

  // Compute moments
  let Suu = 0, Suv = 0, Svv = 0;
  let Suuu = 0, Suvv = 0, Svvv = 0, Svuu = 0;

  for (let i = 0; i < points.length; i++) {
    const ui = u[i];
    const vi = v[i];
    const ui2 = ui * ui;
    const vi2 = vi * vi;

    Suu += ui2;
    Suv += ui * vi;
    Svv += vi2;
    Suuu += ui2 * ui;
    Suvv += ui * vi2;
    Svvv += vi2 * vi;
    Svuu += vi * ui2;
  }

  // Solve the linear system for circle center
  // [Suu Suv] [uc]   [0.5 * (Suuu + Suvv)]
  // [Suv Svv] [vc] = [0.5 * (Svvv + Svuu)]

  const A = Suu;
  const B = Suv;
  const C = Suv;
  const D = Svv;
  const E = 0.5 * (Suuu + Suvv);
  const F = 0.5 * (Svvv + Svuu);

  const det = A * D - B * C;
  if (Math.abs(det) < 1e-10) {
    return null; // Singular matrix, points are collinear
  }

  const uc = (D * E - B * F) / det;
  const vc = (A * F - C * E) / det;

  // Circle center in original coordinate system
  const cx = uc + meanX;
  const cy = vc + meanY;

  // Compute radius as average distance from center
  let sumR = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sumR += Math.sqrt(dx * dx + dy * dy);
  }
  const radius = sumR / points.length;

  // Compute RMS error
  let sumSquaredError = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const error = dist - radius;
    sumSquaredError += error * error;
  }
  const rmsError = Math.sqrt(sumSquaredError / points.length);

  return {
    center: { x: cx, y: cy },
    radius,
    rmsError,
  };
}

/**
 * Groups connected edges into sequences (chains)
 * Edges are connected if they share endpoints (within small tolerance)
 */
export function groupConnectedEdges(edges: THREE.Line3[]): THREE.Line3[][] {
  if (edges.length === 0) return [];

  const ENDPOINT_TOLERANCE = 0.001; // 1 micron

  const groups: THREE.Line3[][] = [];
  const used = new Set<number>();

  const arePointsEqual = (p1: THREE.Vector3, p2: THREE.Vector3): boolean => {
    return p1.distanceTo(p2) < ENDPOINT_TOLERANCE;
  };

  const findConnectedEdge = (point: THREE.Vector3, excludeIndices: Set<number>): number => {
    for (let i = 0; i < edges.length; i++) {
      if (excludeIndices.has(i)) continue;
      const edge = edges[i];
      if (arePointsEqual(edge.start, point) || arePointsEqual(edge.end, point)) {
        return i;
      }
    }
    return -1;
  };

  // Build groups by walking connected edges
  for (let startIdx = 0; startIdx < edges.length; startIdx++) {
    if (used.has(startIdx)) continue;

    const group: THREE.Line3[] = [];
    const groupIndices = new Set<number>();
    
    // Start a new chain
    let currentIdx = startIdx;
    let currentEdge = edges[currentIdx];
    group.push(currentEdge);
    groupIndices.add(currentIdx);
    used.add(currentIdx);

    let currentPoint = currentEdge.end;

    // Walk forward
    while (true) {
      const nextIdx = findConnectedEdge(currentPoint, groupIndices);
      if (nextIdx === -1) break;

      const nextEdge = edges[nextIdx];
      group.push(nextEdge);
      groupIndices.add(nextIdx);
      used.add(nextIdx);

      // Determine which end to follow
      if (arePointsEqual(nextEdge.start, currentPoint)) {
        currentPoint = nextEdge.end;
      } else {
        currentPoint = nextEdge.start;
      }

      // Check if we've closed the loop
      if (arePointsEqual(currentPoint, currentEdge.start)) {
        break;
      }
    }

    // Try walking backward from start
    currentPoint = currentEdge.start;
    while (true) {
      const prevIdx = findConnectedEdge(currentPoint, groupIndices);
      if (prevIdx === -1) break;

      const prevEdge = edges[prevIdx];
      group.unshift(prevEdge); // Add to beginning
      groupIndices.add(prevIdx);
      used.add(prevIdx);

      // Determine which end to follow
      if (arePointsEqual(prevEdge.end, currentPoint)) {
        currentPoint = prevEdge.start;
      } else {
        currentPoint = prevEdge.end;
      }

      // Check if we've closed the loop
      if (arePointsEqual(currentPoint, currentEdge.end)) {
        break;
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * Extracts ordered 2D points from a sequence of connected edges
 */
function extractOrderedPoints(edges: THREE.Line3[]): Point2D[] {
  if (edges.length === 0) return [];

  const ENDPOINT_TOLERANCE = 0.001;
  const points: Point2D[] = [];

  // Start with first edge
  let currentEdge = edges[0];
  points.push({ x: currentEdge.start.x, y: currentEdge.start.y });
  points.push({ x: currentEdge.end.x, y: currentEdge.end.y });

  let lastPoint = currentEdge.end;

  // Walk through remaining edges
  for (let i = 1; i < edges.length; i++) {
    const edge = edges[i];
    
    if (lastPoint.distanceTo(edge.start) < ENDPOINT_TOLERANCE) {
      points.push({ x: edge.end.x, y: edge.end.y });
      lastPoint = edge.end;
    } else if (lastPoint.distanceTo(edge.end) < ENDPOINT_TOLERANCE) {
      points.push({ x: edge.start.x, y: edge.start.y });
      lastPoint = edge.start;
    }
  }

  // Remove duplicate last point if it closes the loop
  if (points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    const dx = first.x - last.x;
    const dy = first.y - last.y;
    if (Math.sqrt(dx * dx + dy * dy) < ENDPOINT_TOLERANCE) {
      points.pop();
    }
  }

  return points;
}

/**
 * Checks if points are well-distributed around the circle
 * (prevents detecting a small arc as a full circle)
 */
function arePointsWellDistributed(points: Point2D[], center: Point2D): boolean {
  if (points.length < MIN_POINTS_FOR_CIRCLE) return false;

  // Calculate angles of all points relative to center
  const angles: number[] = [];
  for (const p of points) {
    const angle = Math.atan2(p.y - center.y, p.x - center.x);
    angles.push(angle);
  }

  // Sort angles
  angles.sort((a, b) => a - b);

  // Check for large gaps in angular coverage
  let maxGap = 0;
  for (let i = 0; i < angles.length; i++) {
    const angle1 = angles[i];
    const angle2 = angles[(i + 1) % angles.length];
    
    let gap = angle2 - angle1;
    if (gap < 0) gap += 2 * Math.PI; // Wrap around
    
    maxGap = Math.max(maxGap, gap);
  }

  // If max gap is small, points are well distributed (full circle)
  return maxGap < Math.PI / 2; // No gap larger than 90 degrees
}

/**
 * Detects if a sequence of edges forms a circle or arc
 * Returns null if the edges don't fit a circle within tolerance
 */
export function detectCircularSequence(
  edges: THREE.Line3[],
  tolerance: number = TOLERANCE_MM
): CircleDetection | null {
  if (edges.length < 3) {
    return null;
  }

  // Extract ordered points from edge sequence
  const points = extractOrderedPoints(edges);
  
  if (points.length < MIN_POINTS_FOR_CIRCLE) {
    return null;
  }

  // Fit circle to points
  const fit = fitCircleToPoints(points);
  if (!fit) {
    return null;
  }

  // Check if fit quality meets tolerance
  if (fit.rmsError > tolerance) {
    return null;
  }

  // Check if it's a full circle or arc
  const isFullCircle = arePointsWellDistributed(points, fit.center);

  let startAngle: number | undefined;
  let endAngle: number | undefined;

  if (!isFullCircle) {
    // Calculate start and end angles for arc
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    
    startAngle = Math.atan2(firstPoint.y - fit.center.y, firstPoint.x - fit.center.x);
    endAngle = Math.atan2(lastPoint.y - fit.center.y, lastPoint.x - fit.center.x);

    // Ensure we have a valid arc (not too small)
    let arcAngle = endAngle - startAngle;
    if (arcAngle < 0) arcAngle += 2 * Math.PI;
    
    if (arcAngle < MIN_ARC_ANGLE) {
      return null; // Arc too small, treat as lines
    }
  }

  return {
    center: fit.center,
    radius: fit.radius,
    isFullCircle,
    startAngle,
    endAngle,
    points,
    rmsError: fit.rmsError,
  };
}
