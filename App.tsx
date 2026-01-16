import React, { useState, useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import {
  Point,
  Line,
  Circle,
  Constraint,
  ConstraintType,
  SketchState,
  Feature,
  Arc,
} from "./types";
import { ConstraintSolver } from "./services/constraintSolver";
import SketchCanvas from "./components/SketchCanvas";
import ThreeView from "./components/ThreeView";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import FloatingConstraints from "./components/FloatingConstraints";
import { initReplicad } from "./services/replicad";

const INITIAL_STATE: SketchState = {
  points: [],
  lines: [],
  circles: [],
  arcs: [],
  constraints: [],
  selectedPointIds: [],
  selectedLineIds: [],
  selectedCircleIds: [],
  selectedConstraintIds: [],
  tool: "SELECT",
  extrusionDepth: 50,
};

// Helper for calculating intersection points
const calculateIntersectionPoints = (
  c1: any,
  c2: any,
  points: Point[]
): Point[] => {
  const getP = (id: string) => points.find((p) => p.id === id);
  const isLine = (c: any) => c.p1 && c.p2 && !c.center;
  const isCircle = (c: any) => c.center && c.radius; // Covers Arc too

  const result: Point[] = [];

  // 1. Line - Line
  if (isLine(c1) && isLine(c2)) {
    const p1 = getP(c1.p1),
      p2 = getP(c1.p2);
    const p3 = getP(c2.p1),
      p4 = getP(c2.p2);
    if (!p1 || !p2 || !p3 || !p4) return [];

    const det = (p2.x - p1.x) * (p4.y - p3.y) - (p4.x - p3.x) * (p2.y - p1.y);
    if (Math.abs(det) < 1e-9) return []; // Parallel

    const t =
      ((p4.y - p3.y) * (p4.x - p1.x) + (p3.x - p4.x) * (p4.y - p1.y)) / det;
    result.push({
      id: `p_int_${Math.random().toString(36).substr(2, 9)}`,
      x: p1.x + t * (p2.x - p1.x),
      y: p1.y + t * (p2.y - p1.y),
    });
  }

  // 2. Line - Circle
  else if ((isLine(c1) && isCircle(c2)) || (isCircle(c1) && isLine(c2))) {
    const line = isLine(c1) ? c1 : c2;
    const circ = isCircle(c1) ? c1 : c2;
    const p1 = getP(line.p1),
      p2 = getP(line.p2),
      center = getP(circ.center);
    if (!p1 || !p2 || !center) return [];

    const dx = p2.x - p1.x,
      dy = p2.y - p1.y;
    const fx = p1.x - center.x,
      fy = p1.y - center.y;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - circ.radius * circ.radius;
    const delta = b * b - 4 * a * c;

    if (delta >= 0) {
      const t1 = (-b - Math.sqrt(delta)) / (2 * a);
      result.push({
        id: `p_int_${Math.random().toString(36).substr(2, 9)}`,
        x: p1.x + t1 * dx,
        y: p1.y + t1 * dy,
      });
      if (delta > 1e-9) {
        const t2 = (-b + Math.sqrt(delta)) / (2 * a);
        result.push({
          id: `p_int_${Math.random().toString(36).substr(2, 9)}`,
          x: p1.x + t2 * dx,
          y: p1.y + t2 * dy,
        });
      }
    }
  }

  // 3. Circle - Circle
  else if (isCircle(c1) && isCircle(c2)) {
    const p1 = getP(c1.center),
      p2 = getP(c2.center);
    if (!p1 || !p2) return [];
    const d2 = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2;
    const d = Math.sqrt(d2);
    const r1 = c1.radius,
      r2 = c2.radius;

    if (d > r1 + r2 || d < Math.abs(r1 - r2) || d === 0) return [];

    const a = (r1 * r1 - r2 * r2 + d2) / (2 * d);
    const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    const x2 = p1.x + (a * (p2.x - p1.x)) / d;
    const y2 = p1.y + (a * (p2.y - p1.y)) / d;

    result.push({
      id: `p_int_${Math.random().toString(36).substr(2, 9)}`,
      x: x2 + (h * (p2.y - p1.y)) / d,
      y: y2 - (h * (p2.x - p1.x)) / d,
    });
    if (h > 1e-9) {
      result.push({
        id: `p_int_${Math.random().toString(36).substr(2, 9)}`,
        x: x2 - (h * (p2.y - p1.y)) / d,
        y: y2 + (h * (p2.x - p1.x)) / d,
      });
    }
  }

  return result;
};

const App: React.FC = () => {
  const [state, setState] = useState<SketchState>(INITIAL_STATE);

  const [features, setFeatures] = useState<Feature[]>([]);
  const [editingFeatureId, setEditingFeatureId] = useState<string | null>(null);
  const [currentTransform, setCurrentTransform] = useState<
    number[] | undefined
  >(undefined);

  const [viewMode, setViewMode] = useState<"2D" | "3D">("2D");
  
  // Store pending parent info for new features (sketch-on-face)
  const pendingParentInfoRef = useRef<{
    parentFeatureId?: string;
    faceSelectionData?: { point: [number, number, number]; normal: [number, number, number] };
  }>({});
  
  // Store the latest feature shapes from useHistoryCSG for auto-update
  const featureShapesRef = useRef<Map<string, any>>(new Map());
  
  // Prevent infinite loops in auto-update
  const isAutoUpdatingRef = useRef(false);

  const [past, setPast] = useState<SketchState[]>([]);
  const [future, setFuture] = useState<SketchState[]>([]);
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    initReplicad().catch(console.error);
  }, []);

  const [pendingValueConstraint, setPendingValueConstraint] = useState<{
    id?: string;
    type: ConstraintType;
    pIds: string[];
    lIds: string[];
    cIds: string[];
    initialValue: string;
  } | null>(null);

  // Derived state for the feature being edited
  const editingFeature = editingFeatureId
    ? features.find((f) => f.id === editingFeatureId)
    : undefined;

  const saveToHistory = useCallback(() => {
    setPast((prev) => [...prev, JSON.parse(JSON.stringify(state))]);
    setFuture([]);
  }, [state]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setFuture((prev) => [JSON.parse(JSON.stringify(state)), ...prev]);
    setState(previous);
    setPast(past.slice(0, -1));
  }, [past, state]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setPast((prev) => [...prev, JSON.parse(JSON.stringify(state))]);
    setState(next);
    setFuture(future.slice(1));
  }, [future, state]);

  const deleteSelected = useCallback(() => {
    saveToHistory();
    setState((prev) => {
      const {
        selectedPointIds: sp,
        selectedLineIds: sl,
        selectedCircleIds: sc,
        selectedConstraintIds: scn,
      } = prev;
      if (!sp.length && !sl.length && !sc.length && !scn.length) return prev;
      const rp = prev.points.filter((p) => !sp.includes(p.id));
      const rl = prev.lines.filter(
        (l) =>
          !sl.includes(l.id) &&
          rp.some((p) => p.id === l.p1) &&
          rp.some((p) => p.id === l.p2)
      );
      const rc = prev.circles.filter(
        (c) => !sc.includes(c.id) && rp.some((p) => p.id === c.center)
      );
      const ra = prev.arcs.filter(
        (a) =>
          !sc.includes(a.id) &&
          rp.some((p) => p.id === a.center) &&
          rp.some((p) => p.id === a.p1) &&
          rp.some((p) => p.id === a.p2)
      );

      // Constraints cleanup
      const rcn = prev.constraints.filter(
        (c) =>
          !scn.includes(c.id) &&
          c.points.every((id) => rp.some((p) => p.id === id)) &&
          c.lines.every((id) => rl.some((l) => l.id === id)) &&
          c.circles.every(
            (id) =>
              rc.some((cir) => cir.id === id) || ra.some((a) => a.id === id)
          )
      );

      return {
        ...prev,
        points: rp,
        lines: rl,
        circles: rc,
        arcs: ra,
        constraints: rcn,
        selectedPointIds: [],
        selectedLineIds: [],
        selectedCircleIds: [],
        selectedConstraintIds: [],
      };
    });
  }, [saveToHistory, state]);

  const toggleConstruction = useCallback(() => {
    saveToHistory();
    setState((prev) => ({
      ...prev,
      lines: prev.lines.map((l) =>
        prev.selectedLineIds.includes(l.id)
          ? { ...l, construction: !l.construction }
          : l
      ),
      circles: prev.circles.map((c) =>
        prev.selectedCircleIds.includes(c.id)
          ? { ...c, construction: !c.construction }
          : c
      ),
      arcs: prev.arcs.map((a) =>
        prev.selectedCircleIds.includes(a.id)
          ? { ...a, construction: !a.construction }
          : a
      ),
    }));
  }, [saveToHistory]);

  const solveConstraints = useCallback(() => {
    setIsSolving(true);
    setState((prev) => {
      const mixedCircles = [
        ...prev.circles,
        ...prev.arcs.map((a) => ({
          id: a.id,
          center: a.center,
          radius: a.radius,
        })),
      ];

      const { points, circles: solvedCircles } = ConstraintSolver.solve(
        prev.points,
        prev.constraints,
        prev.lines,
        mixedCircles
      );

      const nextCircles = prev.circles.map((c) => {
        const solved = solvedCircles.find((sc) => sc.id === c.id);
        return solved ? { ...c, radius: solved.radius } : c;
      });

      const nextArcs = prev.arcs.map((a) => {
        const solved = solvedCircles.find((sc) => sc.id === a.id);
        return solved ? { ...a, radius: solved.radius } : a;
      });

      return { ...prev, points, circles: nextCircles, arcs: nextArcs };
    });
    setIsSolving(false);
  }, []);

  const addConstraint = (
    type: ConstraintType,
    pointIds: string[],
    lineIds: string[],
    circleIds: string[],
    value?: number
  ) => {
    saveToHistory();
    const id = `c_${Math.random().toString(36).substr(2, 9)}`;
    const newConstraint: Constraint = {
      id,
      type,
      points: pointIds,
      lines: lineIds,
      circles: circleIds,
      value,
    };
    setState((prev) => ({
      ...prev,
      constraints: [...prev.constraints, newConstraint],
      selectedPointIds: [],
      selectedCircleIds: [],
      selectedLineIds: [],
      selectedConstraintIds: [],
    }));
    setTimeout(solveConstraints, 10);
  };

  const handleIntersection = useCallback(() => {
    saveToHistory();
    setState((prev) => {
      const selectedLines = prev.lines.filter((l) =>
        prev.selectedLineIds.includes(l.id)
      );
      const selectedCircles = [...prev.circles, ...prev.arcs].filter((c) =>
        prev.selectedCircleIds.includes(c.id)
      );
      const curves = [...selectedLines, ...selectedCircles];

      if (curves.length !== 2) return prev;

      const newPoints = calculateIntersectionPoints(
        curves[0],
        curves[1],
        prev.points
      );

      if (newPoints.length === 0) return prev;

      const newConstraints: Constraint[] = [];
      newPoints.forEach((pt) => {
        // Constrain to Curve 1
        newConstraints.push({
          id: `c_${Math.random().toString(36).substr(2, 9)}`,
          type: ConstraintType.COINCIDENT,
          points: [pt.id],
          lines: prev.selectedLineIds.includes(curves[0].id)
            ? [curves[0].id]
            : [],
          circles: prev.selectedCircleIds.includes(curves[0].id)
            ? [curves[0].id]
            : [],
        });
        // Constrain to Curve 2
        newConstraints.push({
          id: `c_${Math.random().toString(36).substr(2, 9)}`,
          type: ConstraintType.COINCIDENT,
          points: [pt.id],
          lines: prev.selectedLineIds.includes(curves[1].id)
            ? [curves[1].id]
            : [],
          circles: prev.selectedCircleIds.includes(curves[1].id)
            ? [curves[1].id]
            : [],
        });
      });

      return {
        ...prev,
        points: [...prev.points, ...newPoints],
        constraints: [...prev.constraints, ...newConstraints],
        selectedPointIds: newPoints.map((p) => p.id),
        selectedLineIds: [],
        selectedCircleIds: [],
      };
    });
    setTimeout(solveConstraints, 10);
  }, [saveToHistory, solveConstraints]);

  const handleAutoIntersection = useCallback(() => {
    saveToHistory();
    setState((prev) => {
      const newPoints: Point[] = [];
      const newConstraints: Constraint[] = [];
      const { lines, points } = prev;

      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          const l1 = lines[i];
          const l2 = lines[j];

          const p1 = points.find((p) => p.id === l1.p1);
          const p2 = points.find((p) => p.id === l1.p2);
          const p3 = points.find((p) => p.id === l2.p1);
          const p4 = points.find((p) => p.id === l2.p2);

          if (!p1 || !p2 || !p3 || !p4) continue;

          // Check intersection
          const det =
            (p2.x - p1.x) * (p4.y - p3.y) - (p4.x - p3.x) * (p2.y - p1.y);
          if (det === 0) continue; // Parallel

          const lambda =
            ((p4.y - p3.y) * (p4.x - p1.x) + (p3.x - p4.x) * (p4.y - p1.y)) /
            det;
          const gamma =
            ((p1.y - p2.y) * (p4.x - p1.x) + (p2.x - p1.x) * (p4.y - p1.y)) /
            det;

          // Check if intersection is STRICTLY inside both segments (0 < t < 1)
          const EPS = 0.001;
          if (
            lambda > EPS &&
            lambda < 1 - EPS &&
            gamma > EPS &&
            gamma < 1 - EPS
          ) {
            const ix = p1.x + lambda * (p2.x - p1.x);
            const iy = p1.y + lambda * (p2.y - p1.y);

            const exists = points.some(
              (p) => Math.hypot(p.x - ix, p.y - iy) < 1
            );
            const newlyAdded = newPoints.some(
              (p) => Math.hypot(p.x - ix, p.y - iy) < 1
            );

            if (!exists && !newlyAdded) {
              const newId = `p_int_${Math.random().toString(36).substr(2, 9)}`;
              newPoints.push({ id: newId, x: ix, y: iy });
              newConstraints.push({
                id: `c_int_1_${Math.random().toString(36).substr(2, 9)}`,
                type: ConstraintType.COINCIDENT,
                points: [newId],
                lines: [l1.id],
                circles: [],
              });
              newConstraints.push({
                id: `c_int_2_${Math.random().toString(36).substr(2, 9)}`,
                type: ConstraintType.COINCIDENT,
                points: [newId],
                lines: [l2.id],
                circles: [],
              });
            }
          }
        }
      }

      if (newPoints.length === 0) return prev;

      return {
        ...prev,
        points: [...prev.points, ...newPoints],
        constraints: [...prev.constraints, ...newConstraints],
      };
    });
    setTimeout(solveConstraints, 50);
  }, [saveToHistory, solveConstraints]);

  const handleFillet = (pointId: string) => {
    saveToHistory();
    setState((prev) => {
      const getCluster = (startId: string) => {
        const cluster = new Set<string>([startId]);
        const queue = [startId];
        const visited = new Set<string>([startId]);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          prev.constraints
            .filter(
              (c) =>
                c.type === ConstraintType.COINCIDENT && c.points.includes(curr)
            )
            .forEach((c) => {
              c.points.forEach((p) => {
                if (!visited.has(p)) {
                  visited.add(p);
                  cluster.add(p);
                  queue.push(p);
                }
              });
            });
        }
        return Array.from(cluster);
      };
      const cluster = getCluster(pointId);
      const connectedLines = prev.lines.filter(
        (l) => cluster.includes(l.p1) || cluster.includes(l.p2)
      );
      // Explicitly typed to avoid 'unknown' inference with Set spread
      const uniqueLines: Line[] = Array.from(new Set(connectedLines));

      if (uniqueLines.length !== 2) {
        console.warn(
          "Fillet requires exactly 2 lines connected to the vertex."
        );
        return prev;
      }

      const l1 = uniqueLines[0];
      const l2 = uniqueLines[1];
      const pVertex = prev.points.find((p) => p.id === pointId);
      if (!pVertex) return prev;

      const pOther1Id = cluster.includes(l1.p1) ? l1.p2 : l1.p1;
      const pOther2Id = cluster.includes(l2.p1) ? l2.p2 : l2.p1;
      const pOther1 = prev.points.find((p) => p.id === pOther1Id);
      const pOther2 = prev.points.find((p) => p.id === pOther2Id);

      if (!pOther1 || !pOther2) return prev;

      const v1 = { x: pOther1.x - pVertex.x, y: pOther1.y - pVertex.y };
      const v2 = { x: pOther2.x - pVertex.x, y: pOther2.y - pVertex.y };
      const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
      const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
      const nv1 = { x: v1.x / len1, y: v1.y / len1 };
      const nv2 = { x: v2.x / len2, y: v2.y / len2 };
      const dot = nv1.x * nv2.x + nv1.y * nv2.y;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      let radius = 20;
      const halfAngle = angle / 2;
      let distToTan = radius / Math.tan(halfAngle);
      if (distToTan > len1 * 0.4 || distToTan > len2 * 0.4) {
        const maxDist = Math.min(len1, len2) * 0.4;
        distToTan = maxDist;
        radius = distToTan * Math.tan(halfAngle);
      }

      const t1 = {
        id: `p_fil_${Math.random().toString(36).substr(2, 9)}`,
        x: pVertex.x + nv1.x * distToTan,
        y: pVertex.y + nv1.y * distToTan,
      };
      const t2 = {
        id: `p_fil_${Math.random().toString(36).substr(2, 9)}`,
        x: pVertex.x + nv2.x * distToTan,
        y: pVertex.y + nv2.y * distToTan,
      };

      const bisector = { x: nv1.x + nv2.x, y: nv1.y + nv2.y };
      const bLen = Math.sqrt(bisector.x * bisector.x + bisector.y * bisector.y);
      const nBisector = { x: bisector.x / bLen, y: bisector.y / bLen };
      const distToCenter = radius / Math.sin(halfAngle);

      const center = {
        id: `p_fil_c_${Math.random().toString(36).substr(2, 9)}`,
        x: pVertex.x + nBisector.x * distToCenter,
        y: pVertex.y + nBisector.y * distToCenter,
      };
      const arcId = `a_fil_${Math.random().toString(36).substr(2, 9)}`;
      const newArc: Arc = {
        id: arcId,
        center: center.id,
        radius: radius,
        p1: t1.id,
        p2: t2.id,
      };

      const newL1 = { ...l1, p1: pOther1Id, p2: t1.id };
      const newL2 = { ...l2, p1: pOther2Id, p2: t2.id };
      const otherLines = prev.lines.filter(
        (l) => l.id !== l1.id && l.id !== l2.id
      );

      const nextConstraints = prev.constraints.flatMap((c) => {
        if (!c.points.some((id) => cluster.includes(id))) return [c];
        if (c.points.includes(pOther1.id))
          return [
            {
              ...c,
              points: c.points.map((id) => (cluster.includes(id) ? t1.id : id)),
            },
          ];
        if (c.points.includes(pOther2.id))
          return [
            {
              ...c,
              points: c.points.map((id) => (cluster.includes(id) ? t2.id : id)),
            },
          ];
        return [];
      });

      const tc1: Constraint = {
        id: `c_tan_${Math.random().toString(36).substr(2, 9)}`,
        type: ConstraintType.TANGENT,
        points: [],
        lines: [newL1.id],
        circles: [arcId],
      };
      const tc2: Constraint = {
        id: `c_tan_${Math.random().toString(36).substr(2, 9)}`,
        type: ConstraintType.TANGENT,
        points: [],
        lines: [newL2.id],
        circles: [arcId],
      };
      const coin1: Constraint = {
        id: `c_coin_${Math.random().toString(36).substr(2, 9)}`,
        type: ConstraintType.COINCIDENT,
        points: [t1.id],
        lines: [],
        circles: [arcId],
      };
      const coin2: Constraint = {
        id: `c_coin_${Math.random().toString(36).substr(2, 9)}`,
        type: ConstraintType.COINCIDENT,
        points: [t2.id],
        lines: [],
        circles: [arcId],
      };
      const rc: Constraint = {
        id: `c_rad_${Math.random().toString(36).substr(2, 9)}`,
        type: ConstraintType.RADIUS,
        points: [],
        lines: [],
        circles: [arcId],
        value: radius,
      };

      return {
        ...prev,
        points: [
          ...prev.points.filter((p) => !cluster.includes(p.id)),
          t1,
          t2,
          center,
        ],
        lines: [...otherLines, newL1, newL2],
        arcs: [...prev.arcs, newArc],
        constraints: [...nextConstraints, tc1, tc2, coin1, coin2, rc],
        selectedPointIds: [],
      };
    });
    setTimeout(solveConstraints, 50);
  };

  const handleTrim = (id1: string, id2: string) => {
    saveToHistory();
    setState((prev) => {
      let nextLines = [...prev.lines];
      let nextConstraints = [...prev.constraints];
      let nextCircles = [...prev.circles];
      let nextArcs = [...prev.arcs];

      const checkCoin = (pId: string, lId: string) =>
        nextConstraints.some(
          (c) =>
            c.type === ConstraintType.COINCIDENT &&
            c.points.includes(pId) &&
            c.lines.includes(lId)
        );

      const p1 = prev.points.find((p) => p.id === id1);
      const p2 = prev.points.find((p) => p.id === id2);
      if (p1 && p2) {
        const circleIdx = nextCircles.findIndex((c) => {
          const center = prev.points.find((p) => p.id === c.center);
          if (!center) return false;
          const d1 = Math.sqrt((p1.x - center.x) ** 2 + (p1.y - center.y) ** 2);
          const d2 = Math.sqrt((p2.x - center.x) ** 2 + (p2.y - center.y) ** 2);
          return Math.abs(d1 - c.radius) < 1 && Math.abs(d2 - c.radius) < 1;
        });
        if (circleIdx !== -1) {
          const circle = nextCircles[circleIdx];
          nextCircles.splice(circleIdx, 1);
          nextArcs.push({
            id: circle.id,
            center: circle.center,
            radius: circle.radius,
            p1: id1,
            p2: id2,
            construction: circle.construction,
          });
          return {
            ...prev,
            circles: nextCircles,
            arcs: nextArcs,
            selectedPointIds: [],
            selectedLineIds: [],
          };
        }
      }

      let targetLine: Line | null = null;
      if (prev.selectedLineIds.length === 1)
        targetLine =
          nextLines.find((l) => l.id === prev.selectedLineIds[0]) || null;
      if (!targetLine)
        targetLine =
          nextLines.find(
            (l) =>
              (l.p1 === id1 && l.p2 === id2) || (l.p1 === id2 && l.p2 === id1)
          ) || null;
      if (!targetLine)
        targetLine =
          nextLines.find(
            (l) => (l.p1 === id1 || l.p2 === id1) && checkCoin(id2, l.id)
          ) ||
          nextLines.find(
            (l) => (l.p1 === id2 || l.p2 === id2) && checkCoin(id1, l.id)
          ) ||
          null;

      if (targetLine) {
        const l = targetLine;
        const isP1End = l.p1 === id1 || l.p2 === id1;
        const isP2End = l.p1 === id2 || l.p2 === id2;
        const isP1Coin = isP1End || checkCoin(id1, l.id);
        const isP2Coin = isP2End || checkCoin(id2, l.id);

        if (isP1Coin && isP2Coin) {
          if (isP1End && isP2End) {
            nextLines = nextLines.filter((line) => line.id !== l.id);
            nextConstraints = nextConstraints.filter(
              (c) => !c.lines.includes(l.id)
            );
          } else if (isP1End || isP2End) {
            const endPt = isP1End ? id1 : id2;
            const trimPt = isP1End ? id2 : id1;
            const keepPt = l.p1 === endPt ? l.p2 : l.p1;
            const idx = nextLines.findIndex((line) => line.id === l.id);
            nextLines[idx] = { ...l, p1: keepPt, p2: trimPt };
            nextConstraints = nextConstraints.filter(
              (c) =>
                !(
                  c.type === ConstraintType.COINCIDENT &&
                  c.points.includes(trimPt) &&
                  c.lines.includes(l.id)
                )
            );
          } else {
            const pStart = prev.points.find((p) => p.id === l.p1)!;
            const pt1 = prev.points.find((p) => p.id === id1)!;
            const pt2 = prev.points.find((p) => p.id === id2)!;
            const d1 = (pt1.x - pStart.x) ** 2 + (pt1.y - pStart.y) ** 2;
            const d2 = (pt2.x - pStart.x) ** 2 + (pt2.y - pStart.y) ** 2;
            const [first, second] = d1 < d2 ? [id1, id2] : [id2, id1];
            const lineA = {
              ...l,
              id: `l_${Math.random().toString(36).substr(2, 9)}`,
              p1: l.p1,
              p2: first,
            };
            const lineB = {
              ...l,
              id: `l_${Math.random().toString(36).substr(2, 9)}`,
              p1: second,
              p2: l.p2,
            };
            nextLines = nextLines.filter((line) => line.id !== l.id);
            nextLines.push(lineA, lineB);
            nextConstraints = nextConstraints.filter(
              (c) =>
                !(
                  c.type === ConstraintType.COINCIDENT &&
                  (c.points.includes(first) || c.points.includes(second)) &&
                  c.lines.includes(l.id)
                )
            );
            nextConstraints = nextConstraints.filter(
              (c) => !c.lines.includes(l.id)
            );
          }
          return {
            ...prev,
            lines: nextLines,
            constraints: nextConstraints,
            selectedPointIds: [],
            selectedLineIds: [],
          };
        }
      }
      return prev;
    });
    setTimeout(solveConstraints, 10);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z")
        e.shiftKey ? redo() : undo();
      else if ((e.ctrlKey || e.metaKey) && e.key === "y") redo();
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, deleteSelected]);

  const handleApplyConstraint = (type: ConstraintType, needsInput: boolean) => {
    let pIds = [...state.selectedPointIds],
      lIds = [...state.selectedLineIds],
      cIds = [...state.selectedCircleIds];
    if (
      lIds.length > 0 &&
      [
        ConstraintType.HORIZONTAL,
        ConstraintType.VERTICAL,
        ConstraintType.DISTANCE,
        ConstraintType.ANGLE,
      ].includes(type)
    ) {
      lIds.forEach((id) => {
        const line = state.lines.find((l) => l.id === id);
        if (line) {
          if (!pIds.includes(line.p1)) pIds.push(line.p1);
          if (!pIds.includes(line.p2)) pIds.push(line.p2);
        }
      });
    }

    if (needsInput) {
      let initialVal = "0";
      if (type === ConstraintType.DISTANCE) {
        if (pIds.length >= 2) {
          const p1 = state.points.find((p) => p.id === pIds[0]),
            p2 = state.points.find((p) => p.id === pIds[1]);
          if (p1 && p2)
            initialVal = Math.round(
              Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
            ).toString();
        } else if (cIds.length === 2) {
          const getC = (id: string) =>
            state.circles.find((c) => c.id === id) ||
            state.arcs.find((a) => a.id === id);
          const c1 = getC(cIds[0]);
          const c2 = getC(cIds[1]);
          if (c1 && c2) {
            const p1 = state.points.find((p) => p.id === c1.center);
            const p2 = state.points.find((p) => p.id === c2.center);
            if (p1 && p2) {
              const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
              const gapExt = dist - c1.radius - c2.radius;
              const gapInt = Math.abs(c1.radius - c2.radius) - dist;
              if (Math.abs(gapInt) < Math.abs(gapExt)) {
                initialVal = Math.round(gapInt).toString();
              } else {
                initialVal = Math.round(gapExt).toString();
              }
            }
          }
        }
      } else if (type === ConstraintType.RADIUS && cIds.length > 0) {
        const c =
          state.circles.find((cir) => cir.id === cIds[0]) ||
          state.arcs.find((a) => a.id === cIds[0]);
        if (c) initialVal = Math.round(c.radius).toString();
      }
      setPendingValueConstraint({
        type,
        pIds,
        lIds,
        cIds,
        initialValue: initialVal,
      });
    } else {
      addConstraint(type, pIds, lIds, cIds);
    }
  };

  const handleSelectElements = useCallback(
    (
      selection: { points?: string[]; lines?: string[]; circles?: string[] },
      mode: "TOGGLE" | "UNION"
    ) => {
      setState((prev) => {
        const next = { ...prev };

        const currentP = new Set(prev.selectedPointIds);
        const currentL = new Set(prev.selectedLineIds);
        const currentC = new Set(prev.selectedCircleIds);

        if (mode === "TOGGLE") {
          selection.points?.forEach((id) =>
            currentP.has(id) ? currentP.delete(id) : currentP.add(id)
          );
          selection.lines?.forEach((id) =>
            currentL.has(id) ? currentL.delete(id) : currentL.add(id)
          );
          selection.circles?.forEach((id) =>
            currentC.has(id) ? currentC.delete(id) : currentC.add(id)
          );
        } else if (mode === "UNION") {
          selection.points?.forEach((id) => currentP.add(id));
          selection.lines?.forEach((id) => currentL.add(id));
          selection.circles?.forEach((id) => currentC.add(id));
        }

        next.selectedPointIds = Array.from(currentP);
        next.selectedLineIds = Array.from(currentL);
        next.selectedCircleIds = Array.from(currentC);

        if (
          selection.points?.length ||
          selection.lines?.length ||
          selection.circles?.length
        ) {
          next.selectedConstraintIds = [];
        }

        return next;
      });
    },
    []
  );

  // Update Feature Params without closing (persistence)
  const handleUpdateFeatureParams = (id: string, updates: Partial<Feature>) => {
    setFeatures((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
  };

  // COMMIT Logic
  const handleCommitFeature = (
    depth: number,
    operation: "NEW" | "CUT",
    throughAll: boolean,
    featureType: "EXTRUDE" | "REVOLVE",
    revolveAngle?: number,
    revolveAxisId?: string
  ) => {
    const now = Date.now();
    const existingFeature = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
    
    const newFeature: Feature = {
      id: editingFeatureId || `f_${now}`,
      name: editingFeatureId
        ? existingFeature?.name ||
          (operation === "CUT"
            ? "Cut"
            : featureType === "REVOLVE"
            ? "Revolve"
            : "Extrude")
        : `${
            operation === "CUT"
              ? "Cut"
              : featureType === "REVOLVE"
              ? "Revolve"
              : "Extrude"
          } ${features.length + 1}`,
      sketch: { ...state, extrusionDepth: depth },
      extrusionDepth: depth,
      operation: operation,
      throughAll: throughAll,
      featureType: featureType,
      revolveAngle: revolveAngle,
      revolveAxisId: revolveAxisId,
      transform: currentTransform || [
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
      ],
      // Attach dependency info if available
      parentFeatureId: editingFeatureId ? existingFeature?.parentFeatureId : pendingParentInfoRef.current.parentFeatureId,
      faceSelectionData: editingFeatureId ? existingFeature?.faceSelectionData : pendingParentInfoRef.current.faceSelectionData,
      // Set projectionLastUpdated to now if this is a sketch-on-face
      projectionLastUpdated: (editingFeatureId ? existingFeature?.projectionLastUpdated : pendingParentInfoRef.current.parentFeatureId ? now : undefined),
      
      createdAt: existingFeature?.createdAt || now,
      lastModified: now,
    };
    
    // Clear pending info after consuming
    if (!editingFeatureId) {
       pendingParentInfoRef.current = {};
    }

    setFeatures((prev) => {
      if (editingFeatureId) {
        return prev.map((f) => (f.id === editingFeatureId ? newFeature : f));
      }
      return [...prev, newFeature];
    });

    // Reset after commit
    setEditingFeatureId(null);
    setCurrentTransform(undefined);
    setState(INITIAL_STATE);
    // Stay in 3D view to see result?
    setViewMode("3D");
  };

  const handleFinishSketch = () => {
    if (editingFeatureId) {
      // Automatic Update for Existing Feature
      setFeatures((prev) =>
        prev.map((f) => {
          if (f.id === editingFeatureId) {
            // Merge new sketch state into feature
            return { ...f, sketch: { ...state } };
          }
          return f;
        })
      );
      // Do NOT clear editingFeatureId or state so ThreeView can preview effectively
      // Just switch to 3D
    }
    setViewMode("3D");
  };

  const handleLoadFeature = (id: string) => {
    const feature = features.find((f) => f.id === id);
    if (feature) {
      setEditingFeatureId(feature.id);
      // Deep copy to prevent mutation of history until saved
      setState(JSON.parse(JSON.stringify(feature.sketch)));
      setCurrentTransform(feature.transform);
      setViewMode("3D"); // Switch to 3D to edit params
      setIsSidebarOpen(false); // Close mobile sidebar when editing sketch
    }
  };

  const handleDeleteFeature = (id: string) => {
    setFeatures((prev) => prev.filter((f) => f.id !== id));
    if (editingFeatureId === id) {
      setEditingFeatureId(null);
      setState(INITIAL_STATE);
      setCurrentTransform(undefined);
    }
  };

  const handleSketchOnFace = (
    lines: Line[],
    points: Point[],
    transform: number[],
    arcs: Arc[],
    circles: Circle[],
    parentFeatureId?: string,
    faceSelectionData?: { point: [number, number, number]; normal: [number, number, number]; faceIndex?: number }
  ) => {
    // We don't create the feature immediately, but we need to store these params
    // so they are included when the feature is eventually created/committed.
    // However, App.tsx currently only has 'editingFeatureId' and 'state' (sketch state).
    // The Feature object is created in handleCommitFeature.
    
    // TEMPORARY HACK: Store these in a ref or temporary state so handleCommitFeature can access them.
    // Ideally we should start editing a new Feature object immediately.
    
    // For now, let's attach them to the 'state' object if possible, or use a separate ref.
    // But 'state' is SketchState. 
    
    // Let's store them in a temporary "pendingFeatureParams" ref/state in App?
    // Or better: modify handleCommitFeature to accept optional parent info?
    // But handleCommitFeature is called from ThreeViewOverlay.
    
    // Let's rely on the fact that when we start a sketch on face, we set the sketch state.
    // We can add these properties to the initial sketch state, but SketchState is purely 2D.
    
    // Solution: Store in a ref here in App.tsx
    pendingParentInfoRef.current = { parentFeatureId, faceSelectionData };

    setEditingFeatureId(null);
    setCurrentTransform(transform);
    setState({
      ...INITIAL_STATE,
      points: points,
      lines: lines,
      arcs: arcs || [],
      circles: circles || [],
    });
    setViewMode("2D");
  };
  
  const handleReimportFaceEdges = (
    newLines: Line[],
    newPoints: Point[],
    transform: number[],
    newCircles?: Circle[],
    newArcs?: Arc[]
  ) => {
    // Update the current sketch state by:
    // 1. Remove old projected lines and points
    // 2. Match new projected points to old ones by proximity
    // 3. Update positions while preserving IDs (so constraints remain valid)
    // 4. Add any completely new projected geometry
    
    const oldProjPoints = state.points.filter(p => p.id.startsWith('p_proj_'));
    const oldProjLines = state.lines.filter(l => l.id.startsWith('l_proj_'));
    const oldProjCircles = state.circles.filter(c => c.id.startsWith('c_proj_'));
    const oldProjArcs = state.arcs.filter(a => a.id.startsWith('a_proj_'));
    const nonProjPoints = state.points.filter(p => !p.id.startsWith('p_proj_'));
    const nonProjLines = state.lines.filter(l => !l.id.startsWith('l_proj_'));
    const nonProjCircles = state.circles.filter(c => !c.id.startsWith('c_proj_'));
    const nonProjArcs = state.arcs.filter(a => !a.id.startsWith('a_proj_'));
    
    // Match old projected points to new ones by proximity (within 10mm)
    const updatedPoints: Point[] = [...nonProjPoints];
    const unmatchedNewPoints: Point[] = [];
    const newPointIdMap = new Map<string, string>(); // new ID -> old ID
    
    for (const newPoint of newPoints) {
      let closestOld: Point | null = null;
      let closestDist = Infinity;
      
      for (const oldPoint of oldProjPoints) {
        const dist = Math.sqrt(
          Math.pow(newPoint.x - oldPoint.x, 2) + 
          Math.pow(newPoint.y - oldPoint.y, 2)
        );
        
        if (dist < closestDist && dist < 10.0) { // 10mm threshold
          closestDist = dist;
          closestOld = oldPoint;
        }
      }
      
      if (closestOld) {
        // Update the old point's position
        updatedPoints.push({
          ...closestOld,
          x: newPoint.x,
          y: newPoint.y,
        });
        newPointIdMap.set(newPoint.id, closestOld.id);
      } else {
        // This is a truly new point
        unmatchedNewPoints.push(newPoint);
      }
    }
    
    // Add any unmatched new points
    updatedPoints.push(...unmatchedNewPoints);
    
    // Update lines to use old point IDs where possible
    const updatedLines: Line[] = [...nonProjLines];
    for (const newLine of newLines) {
      updatedLines.push({
        ...newLine,
        p1: newPointIdMap.get(newLine.p1) || newLine.p1,
        p2: newPointIdMap.get(newLine.p2) || newLine.p2,
      });
    }
    
    // Handle circles - match by proximity of centers and similar radii
    const updatedCircles: Circle[] = [...nonProjCircles];
    const circleIdMap = new Map<string, string>(); // new ID -> old ID
    
    if (newCircles) {
      for (const newCircle of newCircles) {
        let closestOld: Circle | null = null;
        let closestDist = Infinity;
        
        // Get the center point coordinates
        const newCenterPoint = updatedPoints.find(p => p.id === (newPointIdMap.get(newCircle.center) || newCircle.center));
        if (!newCenterPoint) continue;
        
        for (const oldCircle of oldProjCircles) {
          const oldCenterPoint = oldProjPoints.find(p => p.id === oldCircle.center);
          if (!oldCenterPoint) continue;
          
          const centerDist = Math.sqrt(
            Math.pow(newCenterPoint.x - oldCenterPoint.x, 2) + 
            Math.pow(newCenterPoint.y - oldCenterPoint.y, 2)
          );
          const radiusDiff = Math.abs(newCircle.radius - oldCircle.radius);
          
          // Match if center is within 10mm and radius within 1mm
          if (centerDist < 10.0 && radiusDiff < 1.0 && centerDist < closestDist) {
            closestDist = centerDist;
            closestOld = oldCircle;
          }
        }
        
        if (closestOld) {
          // Update the old circle with new properties
          updatedCircles.push({
            ...closestOld,
            center: newPointIdMap.get(newCircle.center) || newCircle.center,
            radius: newCircle.radius,
          });
          circleIdMap.set(newCircle.id, closestOld.id);
        } else {
          // Add as new circle
          updatedCircles.push({
            ...newCircle,
            center: newPointIdMap.get(newCircle.center) || newCircle.center,
          });
        }
      }
    }
    
    // Handle arcs - match by proximity of centers and similar radii
    const updatedArcs: Arc[] = [...nonProjArcs];
    
    if (newArcs) {
      for (const newArc of newArcs) {
        let closestOld: Arc | null = null;
        let closestDist = Infinity;
        
        // Get the center point coordinates
        const newCenterPoint = updatedPoints.find(p => p.id === (newPointIdMap.get(newArc.center) || newArc.center));
        if (!newCenterPoint) continue;
        
        for (const oldArc of oldProjArcs) {
          const oldCenterPoint = oldProjPoints.find(p => p.id === oldArc.center);
          if (!oldCenterPoint) continue;
          
          const centerDist = Math.sqrt(
            Math.pow(newCenterPoint.x - oldCenterPoint.x, 2) + 
            Math.pow(newCenterPoint.y - oldCenterPoint.y, 2)
          );
          const radiusDiff = Math.abs(newArc.radius - oldArc.radius);
          
          // Match if center is within 10mm and radius within 1mm
          if (centerDist < 10.0 && radiusDiff < 1.0 && centerDist < closestDist) {
            closestDist = centerDist;
            closestOld = oldArc;
          }
        }
        
        if (closestOld) {
          // Update the old arc with new properties
          updatedArcs.push({
            ...closestOld,
            center: newPointIdMap.get(newArc.center) || newArc.center,
            radius: newArc.radius,
            p1: newPointIdMap.get(newArc.p1) || newArc.p1,
            p2: newPointIdMap.get(newArc.p2) || newArc.p2,
          });
        } else {
          // Add as new arc
          updatedArcs.push({
            ...newArc,
            center: newPointIdMap.get(newArc.center) || newArc.center,
            p1: newPointIdMap.get(newArc.p1) || newArc.p1,
            p2: newPointIdMap.get(newArc.p2) || newArc.p2,
          });
        }
      }
    }
    
    // Update the state
    saveToHistory();
    setState(prev => ({
      ...prev,
      points: updatedPoints,
      lines: updatedLines,
      circles: updatedCircles,
      arcs: updatedArcs,
    }));
    
    // Update the transform if it changed
    setCurrentTransform(transform);
    
    // Update the feature's lastModified timestamp to dismiss the warning
    if (editingFeatureId) {
      const now = Date.now();
      setFeatures((prev) =>
        prev.map((f) =>
          f.id === editingFeatureId
            ? { ...f, lastModified: now }
            : f
        )
      );
    }
    
    console.log(`Re-imported face edges: matched ${newPointIdMap.size} points, added ${unmatchedNewPoints.length} new points, ${(newCircles || []).length} circles, ${(newArcs || []).length} arcs`);
  };
  
  // Auto-update callback: detect stale projections and auto-update them
  // This is called after geometry rebuilds complete in useHistoryCSG
  const handleAutoUpdateProjections = useCallback(() => {
    // Prevent re-entry
    if (isAutoUpdatingRef.current) {
      console.log('[Auto-Update] Already updating, skipping');
      return;
    }
    
    console.log('[Auto-Update] Callback triggered, features count:', features.length);
    console.log('[Auto-Update] Feature shapes available:', featureShapesRef.current.size);
    
    // Only run if we have feature shapes available
    if (featureShapesRef.current.size === 0) {
      console.log('[Auto-Update] No feature shapes yet, skipping');
      return;
    }
    
    // Find features that need auto-update
    const featuresToUpdate: Array<{ feature: Feature; parentShape: any }> = [];
    
    for (const feature of features) {
      console.log(`[Auto-Update] Checking feature ${feature.name}:`, {
        hasParent: !!feature.parentFeatureId,
        hasFaceData: !!feature.faceSelectionData,
        parentId: feature.parentFeatureId,
        projectionLastUpdated: feature.projectionLastUpdated,
        lastModified: feature.lastModified,
        createdAt: feature.createdAt
      });
      
      // Skip if no parent dependency
      if (!feature.parentFeatureId || !feature.faceSelectionData) {
        console.log(`[Auto-Update] Skipping ${feature.name}: no parent dependency`);
        continue;
      }
      
      // Check if parent exists and has a shape
      const parentShape = featureShapesRef.current.get(feature.parentFeatureId);
      if (!parentShape) {
        console.log(`[Auto-Update] Skipping ${feature.name}: parent shape not found`);
        continue;
      }
      
      // Check if parent was modified after this feature's projection
      const parent = features.find(f => f.id === feature.parentFeatureId);
      if (!parent) {
        console.log(`[Auto-Update] Skipping ${feature.name}: parent feature not found in list`);
        continue;
      }
      
      const lastUpdate = feature.projectionLastUpdated || feature.createdAt || 0;
      console.log(`[Auto-Update] Comparing timestamps for ${feature.name}:`, {
        parentLastModified: parent.lastModified,
        featureLastUpdate: lastUpdate,
        needsUpdate: parent.lastModified > lastUpdate
      });
      
      if (parent.lastModified <= lastUpdate) {
        console.log(`[Auto-Update] Skipping ${feature.name}: up to date`);
        continue;
      }
      
      console.log(`[Auto-Update] ✓ ${feature.name} needs update!`);
      featuresToUpdate.push({ feature, parentShape });
    }
    
    if (featuresToUpdate.length === 0) {
      console.log('[Auto-Update] No features need updating');
      return;
    }
    
    console.log(`Auto-updating ${featuresToUpdate.length} stale projection(s)`);
    
    // Set the updating flag
    isAutoUpdatingRef.current = true;
    
    // Import the face matching utility
    import('./utils/faceMatching').then(({ findMatchingFace }) => {
      // Update each stale feature
      const now = Date.now();
      
      setFeatures(prev => {
        const updated = [...prev];
        
        for (const { feature, parentShape } of featuresToUpdate) {
          const idx = updated.findIndex(f => f.id === feature.id);
          if (idx === -1) continue;
          
          // Try to find matching face
          const matchedFace = findMatchingFace(parentShape, feature.faceSelectionData!);
          
          if (!matchedFace) {
            console.warn(`Could not find matching face for feature ${feature.name} - parent topology changed`);
            // Mark as needing manual intervention
            updated[idx] = {
              ...updated[idx],
              projectionLastUpdated: 0, // Force warning
            };
            continue;
          }
          
          console.log(`Re-projecting feature ${feature.name} from updated parent`);
          
          // Re-project edges using the same logic as in ThreeView
          // We need to import and call projectFaceEdges logic here
          // For now, let's extract it inline
          
          const { boundaryEdges, normal, point: newFaceCentroid } = matchedFace;
          
          // Reconstruct the transform matrix while preserving BOTH orientation AND origin offset
          const zAxis = normal.clone().normalize();
          
          // IMPORTANT: Try to preserve the original X/Y axis orientation from the old transform
          // This prevents the sketch from rotating when the parent geometry changes
          const oldTransform = new THREE.Matrix4().fromArray(feature.transform);
          const oldOrigin = new THREE.Vector3(feature.transform[12], feature.transform[13], feature.transform[14]);
          const oldXAxis = new THREE.Vector3(feature.transform[0], feature.transform[1], feature.transform[2]).normalize();
          const oldYAxis = new THREE.Vector3(feature.transform[4], feature.transform[5], feature.transform[6]).normalize();
          const oldZAxis = new THREE.Vector3(feature.transform[8], feature.transform[9], feature.transform[10]).normalize();
          
          console.log(`  Old origin: [${oldOrigin.x.toFixed(3)}, ${oldOrigin.y.toFixed(3)}, ${oldOrigin.z.toFixed(3)}]`);
          console.log(`  Old X-axis: [${oldXAxis.x.toFixed(3)}, ${oldXAxis.y.toFixed(3)}, ${oldXAxis.z.toFixed(3)}]`);
          console.log(`  Old Y-axis: [${oldYAxis.x.toFixed(3)}, ${oldYAxis.y.toFixed(3)}, ${oldYAxis.z.toFixed(3)}]`);
          console.log(`  Old Z-axis: [${oldZAxis.x.toFixed(3)}, ${oldZAxis.y.toFixed(3)}, ${oldZAxis.z.toFixed(3)}]`);
          console.log(`  New face centroid: [${newFaceCentroid.x.toFixed(3)}, ${newFaceCentroid.y.toFixed(3)}, ${newFaceCentroid.z.toFixed(3)}]`);
          console.log(`  New Z-axis (normal): [${zAxis.x.toFixed(3)}, ${zAxis.y.toFixed(3)}, ${zAxis.z.toFixed(3)}]`);
          
          // Calculate the offset from the old face centroid to the old origin
          // The old face centroid was stored in faceSelectionData.point
          const oldFaceCentroid = new THREE.Vector3(...feature.faceSelectionData!.point);
          const originOffsetFromFace = new THREE.Vector3().subVectors(oldOrigin, oldFaceCentroid);
          console.log(`  Old face centroid: [${oldFaceCentroid.x.toFixed(3)}, ${oldFaceCentroid.y.toFixed(3)}, ${oldFaceCentroid.z.toFixed(3)}]`);
          console.log(`  Origin offset from face: [${originOffsetFromFace.x.toFixed(3)}, ${originOffsetFromFace.y.toFixed(3)}, ${originOffsetFromFace.z.toFixed(3)}]`);
          
          // Project the old X-axis onto the new face plane (perpendicular to new normal)
          let xAxis = oldXAxis.clone().sub(zAxis.clone().multiplyScalar(oldXAxis.dot(zAxis))).normalize();
          
          // If the old X-axis was nearly parallel to the new normal, try the old Y-axis
          if (xAxis.lengthSq() < 0.1) {
            console.log('  Old X-axis parallel to new normal, trying old Y-axis');
            xAxis = oldYAxis.clone().sub(zAxis.clone().multiplyScalar(oldYAxis.dot(zAxis))).normalize();
          }
          
          // If both old axes are parallel to new normal, pick an arbitrary perpendicular vector
          if (xAxis.lengthSq() < 0.1) {
            console.log('  Both old axes parallel to new normal, picking arbitrary X-axis');
            xAxis = new THREE.Vector3().crossVectors(zAxis, new THREE.Vector3(0, 1, 0)).normalize();
            if (xAxis.lengthSq() < 0.1) {
              xAxis = new THREE.Vector3().crossVectors(zAxis, new THREE.Vector3(1, 0, 0)).normalize();
            }
          }
          
          // Reconstruct Y-axis and normalize X-axis
          const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
          xAxis.crossVectors(yAxis, zAxis).normalize();
          
          console.log(`  New X-axis: [${xAxis.x.toFixed(3)}, ${xAxis.y.toFixed(3)}, ${xAxis.z.toFixed(3)}]`);
          console.log(`  New Y-axis: [${yAxis.x.toFixed(3)}, ${yAxis.y.toFixed(3)}, ${yAxis.z.toFixed(3)}]`);
          
          // Calculate the new origin while preserving the sketch's position on the face
          // Strategy: Transform the old origin through the change in face position
          // 1. Express old origin in the old face's local coordinates
          // 2. Apply to the new face's coordinate system
          
          const oldFaceToWorld = new THREE.Matrix4().makeBasis(oldXAxis, oldYAxis, oldZAxis);
          oldFaceToWorld.setPosition(oldFaceCentroid);
          const worldToOldFace = oldFaceToWorld.clone().invert();
          
          // Get the old origin in the old face's local coordinates
          const oldOriginInFaceCoords = oldOrigin.clone().applyMatrix4(worldToOldFace);
          console.log(`  Old origin in old face coords: [${oldOriginInFaceCoords.x.toFixed(3)}, ${oldOriginInFaceCoords.y.toFixed(3)}, ${oldOriginInFaceCoords.z.toFixed(3)}]`);
          
          // Now apply this to the new face's coordinate system
          const newFaceToWorld = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
          newFaceToWorld.setPosition(newFaceCentroid);
          
          const newOrigin = oldOriginInFaceCoords.clone().applyMatrix4(newFaceToWorld);
          console.log(`  New origin: [${newOrigin.x.toFixed(3)}, ${newOrigin.y.toFixed(3)}, ${newOrigin.z.toFixed(3)}]`);
          
          const localToWorld = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
          localToWorld.setPosition(newOrigin);
          const worldToLocal = localToWorld.clone().invert();
          
          // Transform edges to sketch space
          const edgesInSketchSpace = boundaryEdges.map(edge => {
            const startSketch = edge.start.clone().applyMatrix4(worldToLocal);
            const endSketch = edge.end.clone().applyMatrix4(worldToLocal);
            return new THREE.Line3(startSketch, endSketch);
          });
          
          // Convert to projected lines/points
          const projectedPoints: Point[] = [];
          const projectedLines: Line[] = [];
          
          const findPoint = (x: number, y: number) =>
            projectedPoints.find(p => Math.abs(p.x - x) < 0.001 && Math.abs(p.y - y) < 0.001);
          
          const getOrCreatePoint = (x: number, y: number): Point => {
            let p = findPoint(x, y);
            if (!p) {
              p = {
                id: `p_proj_${Math.random().toString(36).substr(2, 9)}`,
                x, y,
                fixed: true,
              };
              projectedPoints.push(p);
            }
            return p;
          };
          
          edgesInSketchSpace.forEach(edge => {
            const p1 = getOrCreatePoint(edge.start.x, edge.start.y);
            const p2 = getOrCreatePoint(edge.end.x, edge.end.y);
            projectedLines.push({
              id: `l_proj_${Math.random().toString(36).substr(2, 9)}`,
              p1: p1.id,
              p2: p2.id,
              construction: true,
            });
          });
          
          // Now merge with existing sketch (same logic as handleReimportFaceEdges)
          const oldSketch = feature.sketch;
          const oldProjPoints = oldSketch.points.filter(p => p.id.startsWith('p_proj_'));
          const oldProjLines = oldSketch.lines.filter(l => l.id.startsWith('l_proj_'));
          const nonProjPoints = oldSketch.points.filter(p => !p.id.startsWith('p_proj_'));
          const nonProjLines = oldSketch.lines.filter(l => !l.id.startsWith('l_proj_'));
          
          // Match points by proximity
          const updatedPoints: Point[] = [...nonProjPoints];
          const newPointIdMap = new Map<string, string>();
          
          for (const newPoint of projectedPoints) {
            let closestOld: Point | null = null;
            let closestDist = Infinity;
            
            for (const oldPoint of oldProjPoints) {
              const dist = Math.sqrt(
                Math.pow(newPoint.x - oldPoint.x, 2) + Math.pow(newPoint.y - oldPoint.y, 2)
              );
              if (dist < closestDist && dist < 10.0) {
                closestDist = dist;
                closestOld = oldPoint;
              }
            }
            
            if (closestOld) {
              updatedPoints.push({ ...closestOld, x: newPoint.x, y: newPoint.y });
              newPointIdMap.set(newPoint.id, closestOld.id);
            } else {
              updatedPoints.push(newPoint);
            }
          }
          
          // Match lines
          const updatedLines: Line[] = [...nonProjLines];
          for (const newLine of projectedLines) {
            const mappedP1 = newPointIdMap.get(newLine.p1) || newLine.p1;
            const mappedP2 = newPointIdMap.get(newLine.p2) || newLine.p2;
            
            // Try to find existing line with same endpoints
            const oldLine = oldProjLines.find(l => 
              (l.p1 === mappedP1 && l.p2 === mappedP2) || (l.p1 === mappedP2 && l.p2 === mappedP1)
            );
            
            if (oldLine) {
              updatedLines.push({ ...oldLine, p1: mappedP1, p2: mappedP2 });
            } else {
              updatedLines.push({ ...newLine, p1: mappedP1, p2: mappedP2 });
            }
          }
          
          // Update the feature
          updated[idx] = {
            ...updated[idx],
            sketch: {
              ...updated[idx].sketch,
              points: updatedPoints,
              lines: updatedLines,
            },
            transform: localToWorld.toArray(),
            faceSelectionData: {
              point: newFaceCentroid.toArray() as [number, number, number],
              normal: normal.toArray() as [number, number, number],
            },
            projectionLastUpdated: now,
            lastModified: now,
          };
          
          console.log(`✓ Auto-updated projection for ${feature.name}`);
        }
        
        return updated;
      });
      
      // Reset the flag after state update completes
      setTimeout(() => {
        isAutoUpdatingRef.current = false;
      }, 100);
    }).catch(err => {
      console.error("Failed to auto-update projections:", err);
      isAutoUpdatingRef.current = false;
    });
  }, [features]); // Dependency: features

  const handleSaveProject = () => {
    const project = {
      features,
      state, // Current active sketch state
      editingFeatureId,
      currentTransform,
    };
    localStorage.setItem("estrudo_project", JSON.stringify(project));
    alert("Project saved to local storage!");
  };

  const handleLoadProject = () => {
    const saved = localStorage.getItem("estrudo_project");
    if (saved) {
      try {
        const project = JSON.parse(saved);
        setFeatures(project.features || []);
        setState(project.state || INITIAL_STATE);
        setEditingFeatureId(project.editingFeatureId || null);
        setCurrentTransform(project.currentTransform);
        setPast([]);
        setFuture([]);
        setViewMode("3D");
        alert("Project loaded from local storage!");
      } catch (e) {
        console.error("Failed to load project", e);
        alert("Failed to load project from local storage.");
      }
    } else {
      alert("No saved project found.");
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#0a0a0a] text-gray-100 overflow-hidden touch-none select-none">
      <Sidebar
        isOpen={isSidebarOpen}
        state={state}
        features={features}
        editingFeatureId={editingFeatureId}
        onAddConstraint={addConstraint}
        onUpdateConstraintValue={(id, value) => {
          saveToHistory();
          setState((prev) => ({
            ...prev,
            constraints: prev.constraints.map((c) =>
              c.id === id ? { ...c, value } : c
            ),
          }));
          setTimeout(solveConstraints, 10);
        }}
        onSelectConstraints={(ids) =>
          setState((prev) => ({ ...prev, selectedConstraintIds: ids }))
        }
        onDelete={deleteSelected}
        onClose={() => setIsSidebarOpen(false)}
        onToggleConstruction={toggleConstruction}
        onEditFeature={handleLoadFeature}
        onDeleteFeature={handleDeleteFeature}
        onAutoIntersection={handleAutoIntersection}
        onSaveProject={handleSaveProject}
        onLoadProject={handleLoadProject}
      />

      <div className="flex-1 flex flex-col relative min-w-0 h-full overflow-hidden">
        <Toolbar
          activeTool={state.tool}
          onSetTool={(tool) =>
            setState((prev) => ({
              ...prev,
              tool,
              selectedPointIds: [],
              selectedLineIds: [],
              selectedCircleIds: [],
              selectedConstraintIds: [],
            }))
          }
          onToggleSidebar={() => setIsSidebarOpen(true)}
          viewMode={viewMode}
          onToggleViewMode={() =>
            setViewMode((prev) => (prev === "2D" ? "3D" : "2D"))
          }
        />

        <div className="flex-1 relative bg-[#121212] overflow-hidden">
          {viewMode === "2D" && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300">
              <div className="flex bg-[#1a1a1a]/90 backdrop-blur-md p-1 rounded-xl border border-white/10 shadow-xl gap-1">
                <button
                  onClick={undo}
                  disabled={past.length === 0}
                  className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all ${
                    past.length === 0
                      ? "text-gray-600 cursor-not-allowed"
                      : "text-gray-300 hover:bg-white/10 hover:text-white"
                  }`}
                  title="Undo (Ctrl+Z)"
                >
                  ↩
                </button>
                <button
                  onClick={redo}
                  disabled={future.length === 0}
                  className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all ${
                    future.length === 0
                      ? "text-gray-600 cursor-not-allowed"
                      : "text-gray-300 hover:bg-white/10 hover:text-white"
                  }`}
                  title="Redo (Ctrl+Y)"
                >
                  ↪
                </button>
              </div>

              <button
                onClick={handleFinishSketch}
                className="bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/40 px-4 h-11 rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-wider transition-all hover:scale-105 active:scale-95"
              >
                <span>Finish Sketch</span>
                <span className="text-lg">✓</span>
              </button>
            </div>
          )}

          <>
            <SketchCanvas
              state={state}
              onUpdatePoint={(id, x, y) =>
                setState((prev) => {
                  const existing = prev.points.find((p) => p.id === id);
                  if (existing?.fixed) return prev;
                  const up = prev.points.map((p) =>
                    p.id === id ? { ...p, x, y, fixed: true } : p
                  );
                  const mixed = [
                    ...prev.circles,
                    ...prev.arcs.map((a) => ({
                      id: a.id,
                      center: a.center,
                      radius: a.radius,
                    })),
                  ];
                  const { points: solved, circles: solvedCircles } =
                    ConstraintSolver.solve(
                      up,
                      prev.constraints,
                      prev.lines,
                      mixed
                    );
                  const origFixed = prev.points.find((p) => p.id === id)?.fixed;
                  const nextArcs = prev.arcs.map((a) => {
                    const s = solvedCircles.find((sc) => sc.id === a.id);
                    return s ? { ...a, radius: s.radius } : a;
                  });
                  const nextCircles = prev.circles.map((c) => {
                    const s = solvedCircles.find((sc) => sc.id === c.id);
                    return s ? { ...c, radius: s.radius } : c;
                  });
                  return {
                    ...prev,
                    points: solved.map((p) =>
                      p.id === id ? { ...p, fixed: origFixed } : p
                    ),
                    circles: nextCircles,
                    arcs: nextArcs,
                  };
                })
              }
              onUpdateCircleRadius={(id, radius) =>
                setState((prev) => {
                  const hasRadiusConstraint = prev.constraints.some(
                    (c) =>
                      c.type === ConstraintType.RADIUS && c.circles.includes(id)
                  );
                  if (hasRadiusConstraint) return prev;
                  const circles = prev.circles.map((c) =>
                    c.id === id ? { ...c, radius } : c
                  );
                  const arcs = prev.arcs.map((a) =>
                    a.id === id ? { ...a, radius } : a
                  );
                  const mixed = [
                    ...circles,
                    ...arcs.map((a) => ({
                      id: a.id,
                      center: a.center,
                      radius: a.radius,
                    })),
                  ];
                  const { points: solvedPoints, circles: solvedCircles } =
                    ConstraintSolver.solve(
                      prev.points,
                      prev.constraints,
                      prev.lines,
                      mixed
                    );
                  const nextArcs = arcs.map((a) => {
                    const s = solvedCircles.find((sc) => sc.id === a.id);
                    return s ? { ...a, radius: s.radius } : a;
                  });
                  const nextCircles = circles.map((c) => {
                    const s = solvedCircles.find((sc) => sc.id === c.id);
                    return s ? { ...c, radius: s.radius } : c;
                  });
                  return {
                    ...prev,
                    circles: nextCircles,
                    arcs: nextArcs,
                    points: solvedPoints,
                  };
                })
              }
              onAddPoint={(x, y) => {
                saveToHistory();
                setState((prev) => ({
                  ...prev,
                  points: [
                    ...prev.points,
                    {
                      id: `p_${Math.random().toString(36).substr(2, 9)}`,
                      x,
                      y,
                    },
                  ],
                }));
              }}
              onAddLine={(x1, y1, x2, y2, s1, s2) => {
                saveToHistory();
                const id1 =
                  s1 || `p_${Math.random().toString(36).substr(2, 9)}`;
                const id2 =
                  s2 || `p_${Math.random().toString(36).substr(2, 9)}`;
                const newPoints = [];
                if (!s1) newPoints.push({ id: id1, x: x1, y: y1 });
                if (!s2) newPoints.push({ id: id2, x: x2, y: y2 });
                setState((prev) => ({
                  ...prev,
                  points: [...prev.points, ...newPoints],
                  lines: [
                    ...prev.lines,
                    {
                      id: `l_${Math.random().toString(36).substr(2, 9)}`,
                      p1: id1,
                      p2: id2,
                    },
                  ],
                  constraints: [...prev.constraints],
                }));
                setTimeout(solveConstraints, 10);
              }}
              onAddCircle={(cx, cy, r, s) => {
                saveToHistory();
                const cid = `p_${Math.random().toString(36).substr(2, 9)}`;
                const cs = [];
                if (s)
                  cs.push({
                    id: `c_${Math.random().toString(36).substr(2, 9)}`,
                    type: ConstraintType.COINCIDENT,
                    points: [cid, s],
                    lines: [],
                    circles: [],
                  });
                setState((prev) => ({
                  ...prev,
                  points: [...prev.points, { id: cid, x: cx, y: cy }],
                  circles: [
                    ...prev.circles,
                    {
                      id: `c_geo_${Math.random().toString(36).substr(2, 9)}`,
                      center: cid,
                      radius: r,
                    },
                  ],
                  constraints: [...prev.constraints, ...cs],
                }));
                setTimeout(solveConstraints, 10);
              }}
              onAddRectangle={(x1, y1, x2, y2, s) => {
                saveToHistory();
                const ids = Array.from(
                  { length: 4 },
                  () => `p_${Math.random().toString(36).substr(2, 9)}`
                );
                const pts = [
                  { id: ids[0], x: x1, y: y1 },
                  { id: ids[1], x: x2, y: y1 },
                  { id: ids[2], x: x2, y: y2 },
                  { id: ids[3], x: x1, y: y2 },
                ];
                const lns = [
                  {
                    id: `l_${Math.random().toString(36).substr(2, 9)}`,
                    p1: ids[0],
                    p2: ids[1],
                  },
                  {
                    id: `l_${Math.random().toString(36).substr(2, 9)}`,
                    p1: ids[1],
                    p2: ids[2],
                  },
                  {
                    id: `l_${Math.random().toString(36).substr(2, 9)}`,
                    p1: ids[2],
                    p2: ids[3],
                  },
                  {
                    id: `l_${Math.random().toString(36).substr(2, 9)}`,
                    p1: ids[3],
                    p2: ids[0],
                  },
                ];
                const cs = [
                  {
                    id: `c_${Math.random().toString(36).substr(2, 9)}`,
                    type: ConstraintType.HORIZONTAL,
                    points: [ids[0], ids[1]],
                    lines: [],
                    circles: [],
                  },
                  {
                    id: `c_${Math.random().toString(36).substr(2, 9)}`,
                    type: ConstraintType.VERTICAL,
                    points: [ids[1], ids[2]],
                    lines: [],
                    circles: [],
                  },
                  {
                    id: `c_${Math.random().toString(36).substr(2, 9)}`,
                    type: ConstraintType.HORIZONTAL,
                    points: [ids[2], ids[3]],
                    lines: [],
                    circles: [],
                  },
                  {
                    id: `c_${Math.random().toString(36).substr(2, 9)}`,
                    type: ConstraintType.VERTICAL,
                    points: [ids[3], ids[0]],
                    lines: [],
                    circles: [],
                  },
                ];
                if (s)
                  cs.push({
                    id: `c_${Math.random().toString(36).substr(2, 9)}`,
                    type: ConstraintType.COINCIDENT,
                    points: [ids[0], s],
                    lines: [],
                    circles: [],
                  });
                setState((prev) => ({
                  ...prev,
                  points: [...prev.points, ...pts],
                  lines: [...prev.lines, ...lns],
                  constraints: [...prev.constraints, ...cs],
                }));
                setTimeout(solveConstraints, 10);
              }}
              onAddArc={(cx, cy, sx, sy, ex, ey, sc, ss, se) => {
                saveToHistory();
                const cId = `p_${Math.random().toString(36).substr(2, 9)}`;
                const sId = `p_${Math.random().toString(36).substr(2, 9)}`;
                const eId = `p_${Math.random().toString(36).substr(2, 9)}`;
                const r = Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2);
                const cs = [
                  {
                    id: `c_coin_${Math.random().toString(36).substr(2, 9)}`,
                    type: ConstraintType.COINCIDENT,
                    points: [sId],
                    lines: [],
                    circles: [`a_${cId}`],
                  }, // Start on Arc
                  {
                    id: `c_coin_${Math.random().toString(36).substr(2, 9)}`,
                    type: ConstraintType.COINCIDENT,
                    points: [eId],
                    lines: [],
                    circles: [`a_${cId}`],
                  }, // End on Arc
                ];
                if (sc)
                  cs.push({
                    id: `c_${Math.random().toString(36).substr(2, 9)}`,
                    type: ConstraintType.COINCIDENT,
                    points: [cId, sc],
                    lines: [],
                    circles: [],
                  });
                if (ss)
                  cs.push({
                    id: `c_${Math.random().toString(36).substr(2, 9)}`,
                    type: ConstraintType.COINCIDENT,
                    points: [sId, ss],
                    lines: [],
                    circles: [],
                  });
                if (se)
                  cs.push({
                    id: `c_${Math.random().toString(36).substr(2, 9)}`,
                    type: ConstraintType.COINCIDENT,
                    points: [eId, se],
                    lines: [],
                    circles: [],
                  });

                setState((prev) => ({
                  ...prev,
                  points: [
                    ...prev.points,
                    { id: cId, x: cx, y: cy },
                    { id: sId, x: sx, y: sy },
                    { id: eId, x: ex, y: ey },
                  ],
                  arcs: [
                    ...prev.arcs,
                    {
                      id: `a_${cId}`,
                      center: cId,
                      radius: r,
                      p1: sId,
                      p2: eId,
                    },
                  ],
                  constraints: [...prev.constraints, ...cs],
                }));
                setTimeout(solveConstraints, 10);
              }}
              onFillet={handleFillet}
              onSelectElements={handleSelectElements}
              onClearSelection={() =>
                setState((prev) => ({
                  ...prev,
                  selectedPointIds: [],
                  selectedLineIds: [],
                  selectedCircleIds: [],
                  selectedConstraintIds: [],
                }))
              }
              onInteractionStart={saveToHistory}
            />

            {viewMode === "2D" && (
              <FloatingConstraints
                state={state}
                onApplyConstraint={handleApplyConstraint}
                onDelete={deleteSelected}
                onToggleConstruction={toggleConstruction}
                onTrim={handleTrim}
                onIntersect={handleIntersection}
                onFillet={handleFillet}
              />
            )}

            {/* Constraint Input Modal */}
            {pendingValueConstraint && (
              <div
                className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-[#1a1a1a] p-4 rounded-xl border border-blue-500/50 shadow-2xl w-64 animate-in fade-in zoom-in-95"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <h3 className="text-xs font-bold text-blue-400 uppercase mb-3">
                  {pendingValueConstraint.type === ConstraintType.ANGLE
                    ? "Set Angle (Deg)"
                    : pendingValueConstraint.type === ConstraintType.DISTANCE
                    ? "Set Distance"
                    : "Set Radius"}
                </h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const val = parseFloat(
                      (
                        e.currentTarget.elements.namedItem(
                          "value"
                        ) as HTMLInputElement
                      ).value
                    );
                    if (!isNaN(val)) {
                      addConstraint(
                        pendingValueConstraint.type,
                        pendingValueConstraint.pIds,
                        pendingValueConstraint.lIds,
                        pendingValueConstraint.cIds,
                        val
                      );
                    }
                    setPendingValueConstraint(null);
                  }}
                >
                  <input
                    name="value"
                    type="number"
                    step="0.1"
                    autoFocus
                    defaultValue={pendingValueConstraint.initialValue}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:border-blue-500 focus:outline-none mb-3 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-xs font-bold uppercase shadow-lg"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingValueConstraint(null)}
                      className="flex-1 bg-[#2a2a2a] hover:bg-[#333] text-gray-300 py-2 rounded-lg text-xs font-bold uppercase"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* 3D View Overlay */}
            {viewMode === "3D" && (
              <div className="absolute inset-0 z-10 bg-[#121212]">
                <ThreeView
                  state={state}
                  features={features.filter((f) => f.id !== editingFeatureId)}
                  allFeatures={features}
                  currentTransform={currentTransform}
                  initialFeatureParams={editingFeature}
                  onCommitExtrusion={handleCommitFeature}
                  onUpdateFeatureParams={handleUpdateFeatureParams}
                  onSketchOnFace={handleSketchOnFace}
                  onReimportFaceEdges={handleReimportFaceEdges}
                  onClose={() => setViewMode("2D")}
                  onEditFeature={handleLoadFeature}
                  onFeatureShapesReady={(shapes) => {
                    featureShapesRef.current = shapes;
                  }}
                  onBuildComplete={handleAutoUpdateProjections}
                />
              </div>
            )}
          </>
        </div>
      </div>
    </div>
  );
};

export default App;
