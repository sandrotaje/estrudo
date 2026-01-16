import { draw, Drawing, Blueprint, Face, drawCircle } from "replicad";
import { SketchState, Point, Line, Arc, Circle, ConstraintType } from "../../types";

type Point2D = [number, number];

// Helper to find canonical point IDs (handling coincidences)
const getCanonicalPointMap = (sketchState: SketchState) => {
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
  
  return find;
};

export const createReplicadProfiles = (sketchState: SketchState, options?: { allowedIds?: string[]; axisLineId?: string | null }): Drawing[] => {
  const find = getCanonicalPointMap(sketchState);
  const allowedIds = options?.allowedIds;
  const axisLineId = options?.axisLineId;
  const useFilter = allowedIds && allowedIds.length > 0;
  const isAllowed = (id: string) => !useFilter || allowedIds.includes(id);

  const getCoords = (canonicalId: string): Point2D => {
    const p = sketchState.points.find((p) => find(p.id) === canonicalId);
    return p ? [p.x, p.y] : [0, 0];
  };

  // 1. Build adjacency list for cycle finding
  type Edge = { to: string; isArc: boolean; arcData?: Arc; id: string };
  const adj = new Map<string, Edge[]>();
  const addEdge = (u: string, v: string, edge: Edge) => {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u)!.push(edge);
  };

  sketchState.lines.filter(l => !l.construction && l.id !== axisLineId && isAllowed(l.id)).forEach(l => {
    const u = find(l.p1), v = find(l.p2);
    if (u !== v) {
      addEdge(u, v, { to: v, isArc: false, id: l.id });
      addEdge(v, u, { to: u, isArc: false, id: l.id });
    }
  });

  (sketchState.arcs || []).filter(a => !a.construction && isAllowed(a.id)).forEach(a => {
    const u = find(a.p1), v = find(a.p2);
    if (u !== v) {
      addEdge(u, v, { to: v, isArc: true, arcData: a, id: a.id });
      addEdge(v, u, { to: u, isArc: true, arcData: a, id: a.id });
    }
  });

  const visitedGlobal = new Set<string>();
  const drawings: Drawing[] = [];

  console.log(`[sketchToReplicadDrawings] Starting with ${adj.size} nodes in adjacency graph`);

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
      let nextEdge = neighbors.find(e => e.to !== prev && (e.to === path[0] || !visitedInPath.has(e.to)));
      
      if (nextEdge) {
        if (nextEdge.to === path[0] && path.length >= 2) {
          edgePath.push(nextEdge);
          
          const startCoords = getCoords(path[0]);
          const pen = draw(startCoords);

          edgePath.forEach(edge => {
            const dest = getCoords(edge.to);
            if (edge.isArc && edge.arcData) {
              const arc = edge.arcData;
              const center = getCoords(find(arc.center));
              const startP = pen.penPosition;
              
              // Calculate midpoint of the arc
              const a1 = Math.atan2(startP[1] - center[1], startP[0] - center[0]);
              const a2 = Math.atan2(dest[1] - center[1], dest[0] - center[0]);
              
              let diff = a2 - a1;
              while (diff <= -Math.PI) diff += 2 * Math.PI;
              while (diff > Math.PI) diff -= 2 * Math.PI;
              
              const midAngle = a1 + diff / 2;
              const midP: Point2D = [
                center[0] + arc.radius * Math.cos(midAngle),
                center[1] + arc.radius * Math.sin(midAngle)
              ];
              
              pen.threePointsArcTo(dest, midP);
            } else {
              pen.lineTo(dest);
            }
          });
          
          try {
            drawings.push(pen.close());
            console.log(`[sketchToReplicadDrawings] Created closed drawing with ${path.length} points`);
          } catch (e) {
            console.warn("Failed to create Replicad drawing for cycle", e);
          }
          
          path.forEach(id => visitedGlobal.add(id));
          break;
        }
        if (visitedInPath.has(nextEdge.to)) break;
        path.push(nextEdge.to);
        edgePath.push(nextEdge);
        visitedInPath.add(nextEdge.to);
        prev = curr;
        curr = nextEdge.to;
      } else break;
    }
  }

  // 3. Handle Circles
  sketchState.circles.filter(c => !c.construction && isAllowed(c.id)).forEach(c => {
    const center = getCoords(find(c.center));
    if (c.radius > 0) {
      try {
        const circleDrawing = drawCircle(c.radius).translate(center[0], center[1]);
        drawings.push(circleDrawing);
        console.log(`[sketchToReplicadDrawings] Created circle: radius=${c.radius}, center=[${center[0]}, ${center[1]}]`);
      } catch (e) {
        console.warn("Failed to create Replicad drawing for circle", e);
      }
    }
  });

  console.log(`[sketchToReplicadDrawings] Total drawings created: ${drawings.length}`);
  return drawings;
};
