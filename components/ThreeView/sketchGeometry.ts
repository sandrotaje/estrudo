import * as THREE from "three";
import { ConstraintType, SketchState } from "../../types";

const isPointInside = (point: THREE.Vector2, polygon: THREE.Vector2[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

export const getShapesFromSketch = (
  sketchState: SketchState,
  options?: { allowedIds?: string[]; axisLineId?: string | null }
) => {
  const allowedIds = options?.allowedIds;
  const axisLineId = options?.axisLineId;

  // 1. Resolve Coincident Points
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
    return parent.get(id)!;
  };
  const union = (id1: string, id2: string) => {
    const root1 = find(id1);
    const root2 = find(id2);
    if (root1 !== root2) parent.set(root1, root2);
  };
  sketchState.points.forEach((p) => find(p.id));
  sketchState.constraints
    .filter((c) => c.type === ConstraintType.COINCIDENT && c.points.length >= 2)
    .forEach((c) => {
      for (let i = 1; i < c.points.length; i++) union(c.points[0], c.points[i]);
    });

  type Edge = { to: string; isArc: boolean; arcData?: any };
  const adj = new Map<string, Edge[]>();
  const getAdj = (id: string) => {
    if (!adj.has(id)) adj.set(id, []);
    return adj.get(id)!;
  };

  // Filter Logic
  const useFilter = allowedIds && allowedIds.length > 0;
  const isAllowed = (id: string) => !useFilter || allowedIds.includes(id);

  const lines = sketchState.lines.filter(
    (l) => !l.construction && l.id !== axisLineId && isAllowed(l.id)
  );
  const arcs = (sketchState.arcs || []).filter(
    (a) => !a.construction && isAllowed(a.id)
  );
  const circles = sketchState.circles.filter(
    (c) => !c.construction && isAllowed(c.id)
  );

  lines.forEach((l) => {
    const u = find(l.p1),
      v = find(l.p2);
    if (u !== v) {
      getAdj(u).push({ to: v, isArc: false });
      getAdj(v).push({ to: u, isArc: false });
    }
  });
  arcs.forEach((a) => {
    const u = find(a.p1),
      v = find(a.p2);
    if (u !== v) {
      getAdj(u).push({ to: v, isArc: true, arcData: a });
      getAdj(v).push({ to: u, isArc: true, arcData: a });
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    for (const [node, neighbors] of adj.entries()) {
      if (neighbors.length < 2) {
        for (const neighbor of neighbors) {
          const nList = adj.get(neighbor.to);
          if (nList) {
            const idx = nList.findIndex((e) => e.to === node);
            if (idx !== -1) nList.splice(idx, 1);
          }
        }
        adj.delete(node);
        changed = true;
      }
    }
  }

  const visitedGlobal = new Set<string>();
  const cycles: {
    edges: { from: string; to: string; isArc: boolean; arcData?: any }[];
  }[] = [];
  const getCoords = (canonicalId: string) => {
    const p =
      sketchState.points.find((p) => p.id === canonicalId) ||
      sketchState.points.find((p) => find(p.id) === canonicalId);
    if (!p || isNaN(p.x) || isNaN(p.y)) return { x: 0, y: 0 };
    return { x: p.x, y: p.y };
  };

  for (const startNode of adj.keys()) {
    if (visitedGlobal.has(startNode)) continue;
    const path: string[] = [startNode];
    const edgePath: Edge[] = [];
    const visitedInPath = new Set([startNode]);
    let curr = startNode;
    let prev = "";

    while (true) {
      const neighbors = adj.get(curr);
      if (!neighbors) break;
      let nextEdge: Edge | undefined;
      for (const edge of neighbors) {
        if (edge.to !== prev) {
          if (!visitedInPath.has(edge.to)) {
            nextEdge = edge;
            break;
          }
          if (path.length > 2 && edge.to === path[0]) {
            nextEdge = edge;
            break;
          }
        }
      }
      if (!nextEdge) {
        if (
          neighbors.some((e) => e.to === path[0]) &&
          path.length > 2 &&
          prev !== path[0]
        )
          nextEdge = neighbors.find((e) => e.to === path[0]);
        else break;
      }
      if (nextEdge) {
        if (nextEdge.to === path[0]) {
          edgePath.push(nextEdge);
          const cycleEdges = [];
          for (let i = 0; i < path.length; i++)
            cycleEdges.push({
              from: path[i],
              to: edgePath[i].to,
              isArc: edgePath[i].isArc,
              arcData: edgePath[i].arcData,
            });
          cycles.push({ edges: cycleEdges });
          path.forEach((id) => visitedGlobal.add(id));
          break;
        }
        if (visitedInPath.has(nextEdge.to)) break;
        path.push(nextEdge.to);
        edgePath.push(nextEdge);
        visitedInPath.add(nextEdge.to);
        prev = curr;
        curr = nextEdge.to;
        if (path.length > 1000) break;
      } else break;
    }
  }

  const shapes: THREE.Shape[] = [];

  cycles.forEach((cycle) => {
    const s = new THREE.Shape();
    const first = getCoords(cycle.edges[0].from);
    s.moveTo(first.x, first.y);
    cycle.edges.forEach((edge) => {
      const dest = getCoords(edge.to);
      if (edge.isArc && edge.arcData) {
        const arc = edge.arcData;
        const center = getCoords(find(arc.center));
        const from2d = getCoords(edge.from);
        const to2d = getCoords(edge.to);
        if (isNaN(arc.radius) || arc.radius <= 0) {
          s.lineTo(dest.x, dest.y);
        } else {
          const a1 = Math.atan2(from2d.y - center.y, from2d.x - center.x);
          const a2 = Math.atan2(to2d.y - center.y, to2d.x - center.x);
          let diff = a2 - a1;
          while (diff <= -Math.PI) diff += 2 * Math.PI;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          const clockwise = diff < 0;
          s.absarc(center.x, center.y, arc.radius, a1, a2, clockwise);
        }
      } else s.lineTo(dest.x, dest.y);
    });
    shapes.push(s);
  });

  circles.forEach((circle) => {
    const center = sketchState.points.find((p) => p.id === circle.center);
    if (center && !isNaN(circle.radius) && circle.radius > 0) {
      const s = new THREE.Shape();
      s.absarc(center.x, center.y, circle.radius, 0, Math.PI * 2, false);
      shapes.push(s);
    }
  });

  const shapeData = shapes.map((s) => {
    const points = s.getPoints();
    const area = Math.abs(THREE.ShapeUtils.area(points));
    return {
      shape: s,
      points,
      area: isNaN(area) ? 0 : area,
      parent: null as any,
    };
  });
  const validShapeData = shapeData.filter((d) => d.area > 0.001);
  validShapeData.sort((a, b) => b.area - a.area);

  for (let i = 0; i < validShapeData.length; i++) {
    const current = validShapeData[i];
    let bestParent = null;
    for (let j = i - 1; j >= 0; j--) {
      const potential = validShapeData[j];
      if (
        current.points.length > 0 &&
        isPointInside(current.points[0], potential.points)
      ) {
        if (!bestParent || potential.area < bestParent.area)
          bestParent = potential;
      }
    }
    current.parent = bestParent;
  }
  const rootShapes: THREE.Shape[] = [];
  validShapeData.forEach((item) => {
    let depth = 0;
    let p = item.parent;
    while (p) {
      depth++;
      p = p.parent;
    }
    if (depth % 2 === 0) rootShapes.push(item.shape);
    else if (item.parent) item.parent.shape.holes.push(item.shape);
  });

  return rootShapes;
};

export const generateExtrusionGeometry = (
  shapes: THREE.Shape[],
  depth: number
) => {
  if (shapes.length === 0) return null;
  const extrudeSettings = {
    steps: 1,
    depth: depth,
    bevelEnabled: false,
    curveSegments: 32,
  };
  return new THREE.ExtrudeGeometry(shapes, extrudeSettings);
};

export const generateRevolveGeometry = (
  shapes: THREE.Shape[],
  axisLineId: string | undefined,
  angleDeg: number,
  sketchState: SketchState
) => {
  if (shapes.length === 0 || !axisLineId) return null;

  const axisLine = sketchState.lines.find((l) => l.id === axisLineId);
  if (!axisLine) return null;

  const p1 = sketchState.points.find((p) => p.id === axisLine.p1);
  const p2 = sketchState.points.find((p) => p.id === axisLine.p2);
  if (!p1 || !p2) return null;

  const axisStart = new THREE.Vector2(p1.x, p1.y);
  const axisEnd = new THREE.Vector2(p2.x, p2.y);
  const axisVec = new THREE.Vector2()
    .subVectors(axisEnd, axisStart)
    .normalize();

  const geometries: THREE.BufferGeometry[] = [];

  shapes.forEach((shape) => {
    const points = shape.getPoints();
    const lathePoints: THREE.Vector2[] = [];
    points.forEach((pt) => {
      const V = new THREE.Vector2(pt.x, pt.y);
      const vecToPt = new THREE.Vector2().subVectors(V, axisStart);
      const height = vecToPt.dot(axisVec);
      const projection = axisVec.clone().multiplyScalar(height);
      const distVec = new THREE.Vector2().subVectors(vecToPt, projection);
      const radius = distVec.length();
      lathePoints.push(new THREE.Vector2(radius, height));
    });
    const angleRad = (angleDeg * Math.PI) / 180;
    const geom = new THREE.LatheGeometry(lathePoints, 32, 0, angleRad);
    const alignMatrix = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);
    const targetAxis = new THREE.Vector3(axisVec.x, axisVec.y, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      up,
      targetAxis
    );
    alignMatrix.makeRotationFromQuaternion(quaternion);
    alignMatrix.setPosition(p1.x, p1.y, 0);
    geom.applyMatrix4(alignMatrix);
    geometries.push(geom);
  });

  if (geometries.length === 0) return null;
  return geometries[0];
};

export const generateGeometryForFeature = (
  featType: "EXTRUDE" | "REVOLVE",
  shapeList: THREE.Shape[],
  depth: number,
  angle: number,
  axisId: string | undefined,
  sketch: SketchState
) => {
  if (featType === "EXTRUDE") {
    return generateExtrusionGeometry(shapeList, depth);
  } else {
    return generateRevolveGeometry(shapeList, axisId, angle, sketch);
  }
};
