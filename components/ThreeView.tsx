import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { Evaluator, Brush, SUBTRACTION, ADDITION } from "three-bvh-csg";
import {
  SketchState,
  Feature,
  Line,
  ConstraintType,
  Arc,
  Circle,
  Point,
} from "../types";

interface ThreeViewProps {
  state: SketchState;
  features?: Feature[];
  currentTransform?: number[]; // Matrix4 array for current sketch plane
  initialFeatureParams?: Feature;
  onCommitExtrusion: (
    depth: number,
    operation: "NEW" | "CUT",
    throughAll: boolean,
    featureType: "EXTRUDE" | "REVOLVE",
    revolveAngle?: number,
    revolveAxisId?: string
  ) => void;
  onUpdateFeatureParams?: (id: string, updates: Partial<Feature>) => void;
  onSketchOnFace?: (
    lines: Line[],
    points: Point[],
    transform: number[],
    arcs: Arc[],
    circles: Circle[]
  ) => void;
  onClose: () => void;
  onEditFeature?: (id: string) => void;
}

const ThreeView: React.FC<ThreeViewProps> = ({
  state,
  features = [],
  currentTransform,
  initialFeatureParams,
  onCommitExtrusion,
  onUpdateFeatureParams,
  onSketchOnFace,
  onClose,
  onEditFeature,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  // Configuration State - Initialize with initialFeatureParams if available
  const [featureType, setFeatureType] = useState<"EXTRUDE" | "REVOLVE">(
    initialFeatureParams?.featureType || "EXTRUDE"
  );
  const [localDepth, setLocalDepth] = useState(
    initialFeatureParams?.extrusionDepth || state.extrusionDepth || 50
  );
  const [revolveAngle, setRevolveAngle] = useState(
    initialFeatureParams?.revolveAngle || 360
  );
  const [operation, setOperation] = useState<"NEW" | "CUT">(
    initialFeatureParams?.operation || "NEW"
  );
  const [throughAll, setThroughAll] = useState(
    initialFeatureParams?.throughAll || false
  );
  const [isConfigOpen, setIsConfigOpen] = useState(!!initialFeatureParams);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Axis Selection State
  const [activeAxisId, setActiveAxisId] = useState<string | null>(
    initialFeatureParams?.revolveAxisId || null
  );

  // Selection & Interaction State
  const [selectedSketchElements, setSelectedSketchElements] = useState<
    string[]
  >([]);
  const [hoveredSketchElement, setHoveredSketchElement] = useState<
    string | null
  >(null);

  const [selectedFaceData, setSelectedFaceData] = useState<{
    point: THREE.Vector3;
    normal: THREE.Vector3;
    boundaryEdges: THREE.Line3[];
    faceVertices: Float32Array;
    matrixWorld: THREE.Matrix4;
  } | null>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const historyGroupRef = useRef<THREE.Group | null>(null);
  const sketchVisGroupRef = useRef<THREE.Group | null>(null);
  const highlightGroupRef = useRef<THREE.Group | null>(null);
  const axisHelperGroupRef = useRef<THREE.Group | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const requestRef = useRef<number>(0);

  // Cache for feature brushes to avoid rebuilding BVH for unchanged features
  const brushCache = useRef<WeakMap<Feature, Brush>>(new WeakMap());

  // Auto-Center Camera Logic
  const fitView = useCallback(() => {
    if (
      !cameraRef.current ||
      !controlsRef.current ||
      !historyGroupRef.current ||
      !meshGroupRef.current
    )
      return;

    const box = new THREE.Box3();

    // Accumulate bounding box of history
    historyGroupRef.current.children.forEach((mesh) => {
      box.expandByObject(mesh);
    });

    // Accumulate bounding box of preview if valid
    meshGroupRef.current.children.forEach((mesh) => {
      box.expandByObject(mesh);
    });

    // Include sketch visualization in bounding box
    if (sketchVisGroupRef.current) {
      sketchVisGroupRef.current.children.forEach((mesh) => {
        box.expandByObject(mesh);
      });
    }

    console.log("fitView bounding box:", {
      isEmpty: box.isEmpty(),
      min: box.min,
      max: box.max,
      historyChildren: historyGroupRef.current.children.length,
      meshChildren: meshGroupRef.current.children.length,
      sketchChildren: sketchVisGroupRef.current?.children.length || 0,
    });

    if (box.isEmpty()) {
      // Fallback for empty scene
      if (currentTransform) {
        const mat = new THREE.Matrix4().fromArray(currentTransform);
        const pos = new THREE.Vector3();
        pos.setFromMatrixPosition(mat);
        controlsRef.current.target.copy(pos);
        cameraRef.current.position.set(pos.x + 150, pos.y - 150, pos.z + 150);
      } else {
        controlsRef.current.target.set(0, 0, 0);
        cameraRef.current.position.set(200, -300, 300);
      }
      controlsRef.current.update();
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 100;

    // Set target to center
    controlsRef.current.target.copy(center);

    // Move camera to a comfortable distance
    const fov = cameraRef.current.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 2.0; // Zoom factor padding (2.0 = comfortably visible)

    // For flat sketches (size.z is very small), position camera at an isometric angle
    if (size.z < 1) {
      // Isometric view: position camera above and to the side
      const distance = cameraZ;
      cameraRef.current.position.set(
        center.x + distance * 0.5,
        center.y - distance * 0.5,
        center.z + distance * 0.7
      );
    } else {
      // Position Camera: Maintain current direction but adjust distance
      const offset = new THREE.Vector3()
        .subVectors(cameraRef.current.position, center)
        .normalize();
      if (offset.lengthSq() < 0.001) offset.set(1, -1, 1).normalize();

      const newPos = center.clone().add(offset.multiplyScalar(cameraZ));
      cameraRef.current.position.copy(newPos);
    }

    console.log("fitView camera set:", {
      center,
      size,
      maxDim,
      cameraZ,
      cameraPosition: cameraRef.current.position,
      target: controlsRef.current.target,
    });

    cameraRef.current.updateProjectionMatrix();
    controlsRef.current.update();
  }, [currentTransform]);

  // Sync state when entering Edit Mode for an existing feature
  useEffect(() => {
    if (initialFeatureParams) {
      setFeatureType(initialFeatureParams.featureType);
      setLocalDepth(initialFeatureParams.extrusionDepth);
      setRevolveAngle(initialFeatureParams.revolveAngle || 360);
      setOperation(initialFeatureParams.operation);
      setThroughAll(initialFeatureParams.throughAll);
      setActiveAxisId(initialFeatureParams.revolveAxisId || null);
      setIsConfigOpen(true);
    }
  }, [initialFeatureParams]);

  // Initialize Axis based on selection or heuristics (Only if not already set by params)
  useEffect(() => {
    if (initialFeatureParams?.revolveAxisId) return; // Don't override if editing with existing axis

    if (state.selectedLineIds.length === 1) {
      setActiveAxisId(state.selectedLineIds[0]);
    } else if (!activeAxisId) {
      const constructionLine = state.lines.find((l) => l.construction);
      if (constructionLine) setActiveAxisId(constructionLine.id);
    }
  }, [state, initialFeatureParams, activeAxisId]);

  // 1. Initialize Scene
  useEffect(() => {
    if (!mountRef.current) return;

    // Clear any existing canvas elements (prevents duplicates from React StrictMode)
    while (mountRef.current.firstChild) {
      mountRef.current.removeChild(mountRef.current.firstChild);
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#121212");
    sceneRef.current = scene;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
    // Initial position, will be overridden by fitView shortly
    camera.position.set(200, -300, 300);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Ensure canvas is properly styled and visible
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    console.log("ThreeView initialized:", {
      width,
      height,
      canvasAdded: !!renderer.domElement.parentElement,
      cameraPosition: camera.position,
      canvasStyle: {
        width: renderer.domElement.style.width,
        height: renderer.domElement.style.height,
        display: renderer.domElement.style.display,
        position: renderer.domElement.style.position,
      },
      canvasSize: {
        width: renderer.domElement.width,
        height: renderer.domElement.height,
      },
    });

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    console.log("OrbitControls initialized:", {
      enabled: controls.enabled,
      domElement: controls.domElement.tagName,
    });

    // --- Improved Lighting Setup ---
    // 1. Hemisphere Light for natural ambient fill
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
    hemiLight.position.set(0, 0, 500);
    scene.add(hemiLight);

    // 2. Main Directional Light (Sun/Key Light)
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(150, -150, 300);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0001;
    scene.add(dirLight);

    // 3. Fill Light (Softer, from opposite side)
    const fillLight = new THREE.DirectionalLight(0xeef2ff, 1.2);
    fillLight.position.set(-150, 150, 100);
    scene.add(fillLight);

    // Grid
    const gridHelper = new THREE.GridHelper(2000, 40, 0x444444, 0x222222);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    // Groups
    const historyGroup = new THREE.Group();
    scene.add(historyGroup);
    historyGroupRef.current = historyGroup;

    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    const sketchVisGroup = new THREE.Group();
    scene.add(sketchVisGroup);
    sketchVisGroupRef.current = sketchVisGroup;

    const highlightGroup = new THREE.Group();
    scene.add(highlightGroup);
    highlightGroupRef.current = highlightGroup;

    const axisHelperGroup = new THREE.Group();
    scene.add(axisHelperGroup);
    axisHelperGroupRef.current = axisHelperGroup;

    const animate = () => {
      requestRef.current = requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current || !cameraRef.current || !rendererRef.current)
        return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    // Trigger initial fit (delayed slightly for mesh generation)
    setTimeout(fitView, 100);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(requestRef.current);
      if (rendererRef.current) {
        rendererRef.current.dispose();
        mountRef.current?.removeChild(rendererRef.current.domElement);
      }
    };
  }, [fitView]);

  // --- Geometry Helpers ---
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

  const getShapesFromSketch = (
    sketchState: SketchState,
    allowedIds?: string[]
  ) => {
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
      .filter(
        (c) => c.type === ConstraintType.COINCIDENT && c.points.length >= 2
      )
      .forEach((c) => {
        for (let i = 1; i < c.points.length; i++)
          union(c.points[0], c.points[i]);
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

    const axisId = activeAxisId;

    const lines = sketchState.lines.filter(
      (l) => !l.construction && l.id !== axisId && isAllowed(l.id)
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

  const generateExtrusionGeometry = (shapes: THREE.Shape[], depth: number) => {
    if (shapes.length === 0) return null;
    // Performance optimization: Reduced curveSegments from 64 to 32
    const extrudeSettings = {
      steps: 1,
      depth: depth,
      bevelEnabled: false,
      curveSegments: 32,
    };
    return new THREE.ExtrudeGeometry(shapes, extrudeSettings);
  };

  const generateRevolveGeometry = (
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
      const points = shape.getPoints(); // 2D points of the profile
      const lathePoints: THREE.Vector2[] = [];
      points.forEach((pt) => {
        const V = new THREE.Vector2(pt.x, pt.y);
        const vecToPt = new THREE.Vector2().subVectors(V, axisStart);
        const height = vecToPt.dot(axisVec); // Y component for Lathe
        const projection = axisVec.clone().multiplyScalar(height);
        const distVec = new THREE.Vector2().subVectors(vecToPt, projection);
        const radius = distVec.length();
        lathePoints.push(new THREE.Vector2(radius, height));
      });
      const angleRad = (angleDeg * Math.PI) / 180;
      // Optimization: 32 segments is sufficient for preview
      const geom = new THREE.LatheGeometry(lathePoints, 32, 0, angleRad);
      const alignMatrix = new THREE.Matrix4();
      const up = new THREE.Vector3(0, 1, 0);
      const targetAxis = new THREE.Vector3(axisVec.x, axisVec.y, 0); // Z is 0 in 2D plane
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

  const generateGeometryForFeature = (
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

  // 2. Render History Features using CSG
  useEffect(() => {
    if (!historyGroupRef.current) return;
    const group = historyGroupRef.current;

    // Cleanup old meshes
    while (group.children.length > 0) {
      const obj = group.children[0] as THREE.Mesh;
      if (obj.geometry) obj.geometry.dispose();
      if (Array.isArray(obj.material))
        obj.material.forEach((m: any) => m.dispose());
      else (obj.material as THREE.Material).dispose();
      group.remove(obj);
    }

    if (features.length === 0) return;

    const evaluator = new Evaluator();
    let resultBrush: Brush | null = null;

    // Improved Material: Brighter, more visible
    const material = new THREE.MeshStandardMaterial({
      color: 0xe5e7eb, // Tailwind gray-200 (Light grey/white)
      roughness: 0.5,
      metalness: 0.1, // Low metalness to look brighter/plastic-like
      side: THREE.DoubleSide,
    });

    features.forEach((feature) => {
      // Try to retrieve cached brush for this feature object
      // If the feature object reference is the same as before, we can reuse the heavy geometry/BVH construction
      let brush = brushCache.current.get(feature);

      if (!brush) {
        let actualDepth = feature.extrusionDepth;
        let zOffset = 0;

        if (feature.operation === "CUT" && feature.featureType === "EXTRUDE") {
          const overlap = 1.0;
          if (feature.throughAll) {
            actualDepth = 50000;
            zOffset = -50000 + overlap;
          } else {
            actualDepth = feature.extrusionDepth + overlap;
            zOffset = -feature.extrusionDepth;
          }
        }

        const shapes = getShapesFromSketch(feature.sketch); // Use full sketch for history features
        console.log("shapes", shapes);
        const geom = generateGeometryForFeature(
          feature.featureType,
          shapes,
          actualDepth,
          feature.revolveAngle || 360,
          feature.revolveAxisId,
          feature.sketch
        );

        if (geom) {
          if (
            feature.operation === "CUT" &&
            feature.featureType === "EXTRUDE"
          ) {
            geom.translate(0, 0, zOffset);
          }

          brush = new Brush(geom, material);
          if (feature.transform)
            brush.applyMatrix4(
              new THREE.Matrix4().fromArray(feature.transform)
            );
          brush.updateMatrixWorld();

          // Tag mesh with ID for picking
          (brush as any).userData = { featureId: feature.id };

          // Cache the newly created brush
          brushCache.current.set(feature, brush);
        }
      }

      if (brush) {
        if (!resultBrush) {
          resultBrush = brush;
        } else {
          if (feature.operation === "CUT") {
            resultBrush = evaluator.evaluate(resultBrush, brush, SUBTRACTION);
          } else {
            resultBrush = evaluator.evaluate(resultBrush, brush, ADDITION);
          }
        }
      }
    });

    if (resultBrush) {
      const mesh = resultBrush as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Important: Ensure matrixWorld is updated
      mesh.updateMatrixWorld(true);
      group.add(mesh);
    }

    // Recenter camera when features change (addition/removal)
    setTimeout(fitView, 50);
  }, [features, fitView]);

  // Visualize Active Sketch in 3D (Lines Only)
  useEffect(() => {
    if (!sketchVisGroupRef.current) return;
    const group = sketchVisGroupRef.current;
    while (group.children.length > 0) group.remove(group.children[0]);

    console.log("3D Sketch Visualization:", {
      lines: state.lines.length,
      circles: state.circles.length,
      arcs: state.arcs.length,
      points: state.points.length,
      currentTransform: currentTransform ? "YES" : "NO",
      samplePoints: state.points.slice(0, 2).map((p) => ({ x: p.x, y: p.y })),
    });

    if (currentTransform) {
      group.matrix.fromArray(currentTransform);
      group.matrixAutoUpdate = false;
      group.updateMatrixWorld(true);
    } else {
      group.matrix.identity();
      group.matrixAutoUpdate = true;
    }

    // Render Lines
    state.lines.forEach((line) => {
      const p1 = state.points.find((p) => p.id === line.p1);
      const p2 = state.points.find((p) => p.id === line.p2);
      if (p1 && p2) {
        const geom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(p1.x, p1.y, 0),
          new THREE.Vector3(p2.x, p2.y, 0),
        ]);

        const isSelected = selectedSketchElements.includes(line.id);
        let mat: THREE.Material;
        if (line.construction) {
          mat = new THREE.LineDashedMaterial({
            color: isSelected ? 0xffaa00 : 0x666666,
            dashSize: 4,
            gapSize: 2,
          });
        } else {
          mat = new THREE.LineBasicMaterial({
            color: isSelected ? 0xffaa00 : 0x3b82f6,
            linewidth: isSelected ? 2 : 1,
          });
        }

        const mesh = new THREE.Line(geom, mat);
        if (line.construction) mesh.computeLineDistances();
        mesh.userData = {
          sketchId: line.id,
          type: "line",
          construction: line.construction,
        };
        group.add(mesh);
      }
    });

    // Render Circles/Arcs
    const renderArc = (
      id: string,
      centerId: string,
      radius: number,
      p1Id?: string,
      p2Id?: string,
      construction?: boolean
    ) => {
      const center = state.points.find((p) => p.id === centerId);
      if (!center) return;

      const curve = new THREE.EllipseCurve(
        center.x,
        center.y,
        radius,
        radius,
        0,
        2 * Math.PI,
        false,
        0
      );

      if (p1Id && p2Id) {
        const p1 = state.points.find((p) => p.id === p1Id);
        const p2 = state.points.find((p) => p.id === p2Id);
        if (p1 && p2) {
          const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
          const endAngle = Math.atan2(p2.y - center.y, p2.x - center.x);
          let diff = endAngle - startAngle;
          while (diff <= -Math.PI) diff += 2 * Math.PI;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          const clockwise = diff < 0;
          curve.aStartAngle = startAngle;
          curve.aEndAngle = endAngle;
          curve.aClockwise = clockwise;
        }
      }

      const points = curve.getPoints(50);
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const isSelected = selectedSketchElements.includes(id);
      const mat = new THREE.LineBasicMaterial({
        color: isSelected ? 0xffaa00 : construction ? 0x666666 : 0x3b82f6,
        linewidth: isSelected ? 2 : 1,
      });
      const mesh = new THREE.Line(geom, mat);
      mesh.userData = {
        sketchId: id,
        type: "curve",
        construction: construction,
      };
      group.add(mesh);
    };

    state.circles.forEach((c) =>
      renderArc(c.id, c.center, c.radius, undefined, undefined, c.construction)
    );
    state.arcs.forEach((a) =>
      renderArc(a.id, a.center, a.radius, a.p1, a.p2, a.construction)
    );

    console.log("Sketch group children count:", group.children.length);
    if (group.children.length > 0) {
      console.log("First child:", group.children[0]);
      console.log("Group visible:", group.visible);
      console.log("Group matrix:", group.matrix.elements);

      // Trigger fitView to frame the sketch
      setTimeout(() => fitView(), 100);
    }
  }, [state, isConfigOpen, currentTransform, selectedSketchElements, fitView]); // Hover state removed from here to prevent full rebuilds

  // Optimized Effect for Hover/Selection Highlighting
  useEffect(() => {
    if (!sketchVisGroupRef.current) return;
    sketchVisGroupRef.current.children.forEach((obj) => {
      if (obj instanceof THREE.Line) {
        const { sketchId, construction } = obj.userData;
        if (!sketchId) return;

        const isSelected = selectedSketchElements.includes(sketchId);
        const isHovered = hoveredSketchElement === sketchId;

        const baseColor = construction ? 0x666666 : 0x3b82f6;
        // White for hover, Orange for select
        const color = isSelected ? 0xffaa00 : isHovered ? 0xffffff : baseColor;

        if (
          obj.material instanceof THREE.LineBasicMaterial ||
          obj.material instanceof THREE.LineDashedMaterial
        ) {
          obj.material.color.setHex(color);
        }
      }
    });
  }, [selectedSketchElements, hoveredSketchElement]);

  // 3. Render Active Sketch Extrusion/Revolve Preview (Solid)
  const previewShapes = useMemo(() => {
    if (!isConfigOpen) return null; // Only calculate if config is open

    if (state.lines.length === 0 && state.circles.length === 0) {
      setErrorMsg(null);
      return null;
    }

    // Pass selected IDs to filter what forms the shape
    const shapes = getShapesFromSketch(
      state,
      selectedSketchElements.length > 0 ? selectedSketchElements : undefined
    );
    if (shapes.length === 0) {
      setErrorMsg("No closed profiles found in selection.");
      return null;
    }

    let depth = localDepth;
    let zOffset = 0;

    if (featureType === "EXTRUDE" && operation === "CUT") {
      const overlap = 1.0;
      if (throughAll) {
        depth = 1000;
        zOffset = -1000 + overlap;
      } else {
        depth = localDepth + overlap;
        zOffset = -localDepth;
      }
    }

    if (featureType === "REVOLVE" && !activeAxisId) {
      setErrorMsg("No axis line selected.");
      return null;
    }

    const geom = generateGeometryForFeature(
      featureType,
      shapes,
      depth,
      revolveAngle,
      activeAxisId || undefined,
      state
    );

    if (!geom) {
      setErrorMsg("Failed to generate geometry. Check profile/axis.");
      return null;
    }

    if (featureType === "EXTRUDE" && operation === "CUT") {
      geom.translate(0, 0, zOffset);
    }

    setErrorMsg(null);
    return geom;
  }, [
    state,
    localDepth,
    throughAll,
    operation,
    featureType,
    revolveAngle,
    activeAxisId,
    isConfigOpen,
    selectedSketchElements,
  ]);

  // Visualize the Axis
  useEffect(() => {
    const group = axisHelperGroupRef.current;
    if (!group) return;
    while (group.children.length > 0) group.remove(group.children[0]);

    if (isConfigOpen && featureType === "REVOLVE" && activeAxisId) {
      const line = state.lines.find((l) => l.id === activeAxisId);
      const p1 = state.points.find((p) => p.id === line?.p1);
      const p2 = state.points.find((p) => p.id === line?.p2);

      if (p1 && p2) {
        const dir = new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, 0).normalize();
        const center = new THREE.Vector3(
          (p1.x + p2.x) / 2,
          (p1.y + p2.y) / 2,
          0
        );
        const pA = center.clone().add(dir.clone().multiplyScalar(1000));
        const pB = center.clone().add(dir.clone().multiplyScalar(-1000));

        const geometry = new THREE.BufferGeometry().setFromPoints([pA, pB]);
        const material = new THREE.LineDashedMaterial({
          color: 0xffa500,
          linewidth: 2,
          scale: 1,
          dashSize: 10,
          gapSize: 5,
        });
        const axisMesh = new THREE.Line(geometry, material);
        axisMesh.computeLineDistances();
        group.add(axisMesh);

        if (currentTransform) {
          group.matrix.fromArray(currentTransform);
          group.matrixAutoUpdate = false;
          group.updateMatrixWorld(true);
        } else {
          group.matrix.identity();
          group.matrixAutoUpdate = true;
        }
      }
    }
  }, [featureType, activeAxisId, state, currentTransform, isConfigOpen]);

  useEffect(() => {
    if (!meshGroupRef.current) return;
    const group = meshGroupRef.current;

    if (currentTransform) {
      group.matrix.fromArray(currentTransform);
      group.matrixAutoUpdate = false;
      group.updateMatrixWorld(true);
    } else {
      group.matrix.identity();
      group.matrixAutoUpdate = true;
    }

    while (group.children.length > 0) {
      const obj = group.children[0] as THREE.Mesh;
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) (obj.material as THREE.Material).dispose();
      group.remove(obj);
    }

    if (previewShapes) {
      // Brighter Preview Colors
      const color = operation === "CUT" ? 0xff6b6b : 0x60a5fa; // Brighter Red / Blue
      const mat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.2,
        metalness: 0.1,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      });
      const mesh = new THREE.Mesh(previewShapes, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }, [previewShapes, currentTransform, operation]);

  // Face Highlight & Picking Logic
  useEffect(() => {
    if (!highlightGroupRef.current) return;
    const group = highlightGroupRef.current;
    while (group.children.length > 0) {
      const obj = group.children[0];
      if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
      group.remove(obj);
    }
    if (selectedFaceData) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(selectedFaceData.faceVertices, 3)
      );
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: 0xffaa00,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.25,
          depthTest: false,
        })
      );
      mesh.matrix = selectedFaceData.matrixWorld;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }, [selectedFaceData]);

  const extractFace = (mesh: THREE.Mesh, faceIndex: number) => {
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

  const onCanvasMouseMove = (event: React.MouseEvent) => {
    if (isConfigOpen || !sketchVisGroupRef.current || !cameraRef.current)
      return;
    const rect = mountRef.current?.getBoundingClientRect();
    if (!rect) return;
    mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    raycasterRef.current.params.Line.threshold = 3.0; // Increased threshold for easier hover

    const intersects = raycasterRef.current.intersectObjects(
      sketchVisGroupRef.current.children,
      true
    );

    if (intersects.length > 0) {
      const id = intersects[0].object.userData.sketchId;
      if (id) {
        if (hoveredSketchElement !== id) setHoveredSketchElement(id);
        return;
      }
    }
    if (hoveredSketchElement !== null) setHoveredSketchElement(null);
  };

  const onCanvasClick = (event: React.MouseEvent) => {
    if (
      !meshGroupRef.current ||
      !historyGroupRef.current ||
      !sketchVisGroupRef.current ||
      !cameraRef.current
    )
      return;
    if (isConfigOpen) return; // Don't pick if config is open

    const rect = mountRef.current?.getBoundingClientRect();
    if (!rect) return;
    mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

    // 1. Check for Sketch Elements
    raycasterRef.current.params.Line.threshold = 3.0; // Increased threshold
    const sketchIntersects = raycasterRef.current.intersectObjects(
      sketchVisGroupRef.current.children,
      true
    );

    if (sketchIntersects.length > 0) {
      const hit = sketchIntersects[0];
      const sketchId = hit.object.userData.sketchId;
      if (sketchId) {
        setSelectedSketchElements((prev) => {
          if (prev.includes(sketchId))
            return prev.filter((id) => id !== sketchId);
          return [...prev, sketchId];
        });
        // Clear face selection if we picked a sketch line
        setSelectedFaceData(null);
        return;
      }
    }

    // 2. Check for Solid Faces (existing logic)
    const objectsToCheck = [...historyGroupRef.current.children];
    const intersects = raycasterRef.current.intersectObjects(
      objectsToCheck,
      true
    );

    if (intersects.length > 0) {
      const hit = intersects[0];
      const mesh = hit.object as THREE.Mesh;

      if (hit.face) {
        const faceData = extractFace(mesh, hit.faceIndex!);
        if (faceData.vertices.length > 0) {
          const normalWorld = faceData.normal
            .clone()
            .transformDirection(mesh.matrixWorld)
            .normalize();
          setSelectedFaceData({
            point: hit.point,
            normal: normalWorld,
            boundaryEdges: faceData.boundary,
            faceVertices: faceData.vertices,
            matrixWorld: mesh.matrixWorld,
          });
          // Deselect sketch elements if face picked
          setSelectedSketchElements([]);
        }
      }
    } else {
      setSelectedFaceData(null);
      // If clicked on empty space, clear all? Maybe keep sketch selection?
      // Let's clear both for consistency with most tools.
      setSelectedSketchElements([]);
    }
  };

  const handleExportSTL = () => {
    const exporter = new STLExporter();
    const result = exporter.parse(historyGroupRef.current!, { binary: true });
    const blob = new Blob([result], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "model.stl";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCommit = () => {
    if (!errorMsg) {
      onCommitExtrusion(
        localDepth,
        operation,
        throughAll,
        featureType,
        revolveAngle,
        activeAxisId || undefined
      );
      setIsConfigOpen(false); // Close config after commit
      setSelectedSketchElements([]); // Clear selection after commit
    }
  };

  // Helper to switch back to 2D but keep the session alive by updating params first
  const handleEditSketch = () => {
    if (initialFeatureParams?.id && onUpdateFeatureParams) {
      onUpdateFeatureParams(initialFeatureParams.id, {
        featureType,
        extrusionDepth: localDepth,
        revolveAngle,
        operation,
        throughAll,
        revolveAxisId: activeAxisId || undefined,
      });
    }
    onClose();
  };

  const handleCreateSketchOnFace = () => {
    if (!selectedFaceData || !onSketchOnFace) return;
    const { boundaryEdges, normal, matrixWorld } = selectedFaceData;
    if (boundaryEdges.length === 0) {
      alert("Could not detect face boundary.");
      return;
    }
    const edge = boundaryEdges[0];
    const originLocal = edge.start.clone();
    const originWorld = originLocal.clone().applyMatrix4(matrixWorld);
    const endWorld = edge.end.clone().applyMatrix4(matrixWorld);
    const zAxis = normal.clone().normalize();
    let xAxis = new THREE.Vector3()
      .subVectors(endWorld, originWorld)
      .normalize();
    if (Math.abs(xAxis.dot(zAxis)) > 0.9) {
      xAxis = new THREE.Vector3()
        .crossVectors(zAxis, new THREE.Vector3(0, 1, 0))
        .normalize();
      if (xAxis.lengthSq() < 0.1)
        xAxis = new THREE.Vector3()
          .crossVectors(zAxis, new THREE.Vector3(1, 0, 0))
          .normalize();
    }
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    xAxis.crossVectors(yAxis, zAxis).normalize();
    const localToWorld = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    localToWorld.setPosition(originWorld);
    const worldToLocal = localToWorld.clone().invert();
    const projectedPoints: Point[] = [];
    const projectedLines: Line[] = [];
    const findPoint = (x: number, y: number) =>
      projectedPoints.find(
        (p) => Math.abs(p.x - x) < 0.001 && Math.abs(p.y - y) < 0.001
      );
    boundaryEdges.forEach((edge) => {
      const startWorld = edge.start.clone().applyMatrix4(matrixWorld);
      const endWorld = edge.end.clone().applyMatrix4(matrixWorld);
      const startSketch = startWorld.applyMatrix4(worldToLocal);
      const endSketch = endWorld.applyMatrix4(worldToLocal);
      let p1 = findPoint(startSketch.x, startSketch.y);
      if (!p1) {
        p1 = {
          id: `p_proj_${Math.random().toString(36).substr(2, 9)}`,
          x: startSketch.x,
          y: startSketch.y,
          fixed: true,
        };
        projectedPoints.push(p1);
      }
      let p2 = findPoint(endSketch.x, endSketch.y);
      if (!p2) {
        p2 = {
          id: `p_proj_${Math.random().toString(36).substr(2, 9)}`,
          x: endSketch.x,
          y: endSketch.y,
          fixed: true,
        };
        projectedPoints.push(p2);
      }
      projectedLines.push({
        id: `l_proj_${Math.random().toString(36).substr(2, 9)}`,
        p1: p1.id,
        p2: p2.id,
        construction: true,
      });
    });
    onSketchOnFace(
      projectedLines,
      projectedPoints,
      localToWorld.toArray(),
      [],
      []
    );
  };

  const hasActiveSketch = state.lines.length > 0 || state.circles.length > 0;

  return (
    <div
      className="relative w-full h-full bg-[#121212]"
      style={{ cursor: hoveredSketchElement ? "pointer" : "crosshair" }}
    >
      <div
        ref={mountRef}
        className="absolute inset-0 w-full h-full"
        onClick={onCanvasClick}
        onMouseMove={onCanvasMouseMove}
      />
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <button
          onClick={fitView}
          className="bg-[#1a1a1a]/90 border border-white/10 text-white px-3 py-2 rounded-xl text-xs font-bold uppercase hover:bg-white/10"
          title="Recenter View"
        >
          ⛶
        </button>
        <button
          onClick={handleExportSTL}
          className="bg-[#1a1a1a]/90 border border-white/10 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase hover:bg-white/10 flex items-center gap-2"
        >
          <span className="text-lg">⬇</span> Export STL
        </button>
      </div>

      {/* Main Action Bar (When no config open) */}
      {!isConfigOpen && hasActiveSketch && (
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 animate-in fade-in">
          {/* Operations Menu */}
          <div className="flex flex-col gap-1 mt-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-2">
              Operations
            </span>
            <button
              onClick={() => {
                setFeatureType("EXTRUDE");
                setIsConfigOpen(true);
              }}
              className="flex items-center gap-3 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg transition-all text-left"
            >
              <span className="text-xl">⬆</span>
              <div className="flex flex-col">
                <span className="text-xs font-bold uppercase">Extrude</span>
                <span className="text-[9px] opacity-80">
                  {selectedSketchElements.length > 0
                    ? `${selectedSketchElements.length} selected items`
                    : "Pull entire sketch"}
                </span>
              </div>
            </button>
            <button
              onClick={() => {
                setFeatureType("REVOLVE");
                setIsConfigOpen(true);
              }}
              className="flex items-center gap-3 px-4 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl shadow-lg transition-all text-left"
            >
              <span className="text-xl">↻</span>
              <div className="flex flex-col">
                <span className="text-xs font-bold uppercase">Revolve</span>
                <span className="text-[9px] opacity-80">
                  {selectedSketchElements.length > 0
                    ? `${selectedSketchElements.length} selected items`
                    : "Spin entire sketch"}
                </span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Config Panel (Extrude/Revolve) */}
      {isConfigOpen && (
        <div
          className="absolute top-4 left-4 z-10 bg-[#1a1a1a]/95 backdrop-blur-xl p-5 rounded-2xl border border-white/10 shadow-2xl w-72 flex flex-col gap-4 animate-in slide-in-from-left-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="text-lg">⚙️</span>{" "}
              {initialFeatureParams ? "Edit Feature" : "Feature Properties"}
            </h3>
          </div>

          {/* Feature Type Toggle */}
          <div className="flex bg-[#000] p-1 rounded-lg mb-2">
            <button
              onClick={() => setFeatureType("EXTRUDE")}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-md transition-colors ${
                featureType === "EXTRUDE"
                  ? "bg-purple-600 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Extrude
            </button>
            <button
              onClick={() => setFeatureType("REVOLVE")}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-md transition-colors ${
                featureType === "REVOLVE"
                  ? "bg-orange-600 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Revolve
            </button>
          </div>

          {/* Operation Toggle */}
          <div className="flex bg-[#000] p-1 rounded-lg">
            <button
              onClick={() => setOperation("NEW")}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-md transition-colors ${
                operation === "NEW"
                  ? "bg-blue-600 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              New
            </button>
            <button
              onClick={() => setOperation("CUT")}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-md transition-colors ${
                operation === "CUT"
                  ? "bg-red-600 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Cut
            </button>
          </div>

          {featureType === "EXTRUDE" && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="throughAll"
                  checked={throughAll}
                  onChange={(e) => setThroughAll(e.target.checked)}
                  className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <label
                  htmlFor="throughAll"
                  className="text-xs text-gray-300 font-medium select-none"
                >
                  Through All
                </label>
              </div>
              <div
                className={`space-y-2 transition-opacity ${
                  throughAll ? "opacity-40 pointer-events-none" : "opacity-100"
                }`}
              >
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                  Depth (mm)
                </label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={localDepth}
                      onChange={(e) =>
                        setLocalDepth(parseFloat(e.target.value))
                      }
                      className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg py-2 px-3 text-sm font-mono text-blue-400 focus:outline-none focus:border-blue-500"
                    />
                    <span className="absolute right-3 top-2 text-xs text-gray-600 pointer-events-none">
                      mm
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min="1"
                  max="500"
                  value={localDepth}
                  onChange={(e) => setLocalDepth(parseFloat(e.target.value))}
                  className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </>
          )}

          {featureType === "REVOLVE" && (
            <>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                  Angle (Deg)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    max="360"
                    value={revolveAngle}
                    onChange={(e) =>
                      setRevolveAngle(parseFloat(e.target.value))
                    }
                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg py-2 px-3 text-sm font-mono text-orange-400 focus:outline-none focus:border-orange-500"
                  />
                </div>
                <input
                  type="range"
                  min="1"
                  max="360"
                  value={revolveAngle}
                  onChange={(e) => setRevolveAngle(parseFloat(e.target.value))}
                  className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                  Axis Line
                </label>
                <select
                  value={activeAxisId || ""}
                  onChange={(e) => setActiveAxisId(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg py-2 px-3 text-xs text-gray-300 focus:outline-none"
                >
                  <option value="" disabled>
                    Select Axis...
                  </option>
                  {state.lines.map((l, i) => (
                    <option key={l.id} value={l.id}>
                      Line {i + 1} {l.construction ? "(Constr)" : ""}{" "}
                      {l.id === activeAxisId ? "(Selected)" : ""}
                    </option>
                  ))}
                </select>
                {!activeAxisId && (
                  <p className="text-[10px] text-red-400">
                    Please select a line to revolve around.
                  </p>
                )}
              </div>
            </>
          )}

          {initialFeatureParams && (
            <div className="pt-2 border-t border-white/5">
              <button
                onClick={handleEditSketch}
                className="w-full py-2 mb-2 rounded-lg bg-[#2a2a2a] hover:bg-[#333] border border-white/5 text-xs font-bold text-purple-400 uppercase flex items-center justify-center gap-2"
              >
                <span>✎</span> Edit Sketch Geometry
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-[10px] text-red-400 font-bold">{errorMsg}</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setIsConfigOpen(false)}
              className="flex-1 py-2 rounded-lg bg-[#333] hover:bg-[#444] text-xs font-bold text-gray-300 uppercase"
            >
              Cancel
            </button>
            <button
              onClick={handleCommit}
              disabled={!!errorMsg}
              className={`flex-1 py-2 rounded-lg text-xs font-bold text-white uppercase shadow-lg ${
                errorMsg ? "bg-gray-700" : "bg-blue-600 hover:bg-blue-500"
              }`}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {selectedFaceData && !isConfigOpen && (
        <div
          className="absolute z-20 bg-black/80 backdrop-blur border border-blue-500/50 text-white p-2 rounded-lg shadow-lg pointer-events-none"
          style={{
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="text-xs font-bold mb-1 text-blue-300 text-center">
            Face Selected
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCreateSketchOnFace();
            }}
            className="pointer-events-auto bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold uppercase px-3 py-1.5 rounded shadow-lg"
          >
            Sketch on Face
          </button>
        </div>
      )}
    </div>
  );
};

export default ThreeView;
