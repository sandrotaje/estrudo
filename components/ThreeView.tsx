import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
} from "react";
import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { SketchState, Feature, Line, Arc, Circle, Point } from "../types";
import {
  generateGeometryForFeature,
  getShapesFromSketch,
} from "./ThreeView/sketchGeometry";
import {
  pickFaceData,
  pickSketchElementId,
  setRayFromMouseEvent,
} from "./ThreeView/picking";
import ThreeViewOverlay from "./ThreeView/Overlay";
import { useThreeScene } from "./ThreeView/useThreeScene";
import { useHistoryCSG } from "./ThreeView/useHistoryCSG";
import { useSketchVisualization } from "./ThreeView/useSketchVisualization";
import { useAxisVisualization } from "./ThreeView/useAxisVisualization";
import { usePreviewMesh } from "./ThreeView/usePreviewMesh";
import { useFaceHighlight } from "./ThreeView/useFaceHighlight";
import { shouldShowProjectionWarning } from "../utils/projectionUtils";
import { groupConnectedEdges, detectCircularSequence } from "../utils/circleDetection";

interface ThreeViewProps {
  state: AppState;
  features?: Feature[];
  allFeatures?: Feature[];
  currentTransform: THREE.Matrix4 | null;
  initialFeatureParams?: InitialFeatureParams;
  onCommitExtrusion: (
    params: Omit<FeatureParams, "id">,
    sketch?: ConstrainedSketch,
    attachedToFaceIndex?: number
  ) => void;
  onUpdateFeatureParams?: (featureId: string, params: FeatureParams) => void;
  onSketchOnFace?: (
    lines: Line[],
    points: Point[],
    transform: number[],
    arcs: Arc[],
    circles: Circle[]
  ) => void;
  onReimportFaceEdges?: (
    newLines: Line[],
    newPoints: Point[],
    transform: number[],
    newCircles?: Circle[],
    newArcs?: Arc[]
  ) => void;
  onClose: () => void;
  onEditFeature?: (id: string) => void;
}

const ThreeView: React.FC<ThreeViewProps> = ({
  state,
  features = [],
  allFeatures = [],
  currentTransform,
  initialFeatureParams,
  onCommitExtrusion,
  onUpdateFeatureParams,
  onSketchOnFace,
  onReimportFaceEdges,
  onClose,
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
  
  // Re-import mode for updating projected face edges
  const [isReimportMode, setIsReimportMode] = useState(false);

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
  const controlsRef = useRef<any>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const historyGroupRef = useRef<THREE.Group | null>(null);
  const sketchVisGroupRef = useRef<THREE.Group | null>(null);
  const highlightGroupRef = useRef<THREE.Group | null>(null);
  const axisHelperGroupRef = useRef<THREE.Group | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const requestRef = useRef<number>(0);

  // Cache for feature shapes to avoid rebuilding for unchanged features
  const brushCache = useRef<WeakMap<Feature, any>>(new WeakMap());

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

  useThreeScene({
    mountRef,
    fitView,
    sceneRef,
    cameraRef,
    rendererRef,
    controlsRef,
    historyGroupRef,
    meshGroupRef,
    sketchVisGroupRef,
    highlightGroupRef,
    axisHelperGroupRef,
    requestRef,
  });

  // --- Geometry Helpers ---

  useHistoryCSG({
    features,
    historyGroupRef,
    brushCache,
    activeAxisId,
    fitView,
  });

  useSketchVisualization({
    sketchVisGroupRef,
    state,
    currentTransform,
    selectedSketchElements,
    fitView,
    isConfigOpen,
  });

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
  const { geometry: previewGeometry, error: previewError } = useMemo(() => {
    if (!isConfigOpen) return { geometry: null, error: null };

    if (state.lines.length === 0 && state.circles.length === 0) {
      return { geometry: null, error: null };
    }

    const shapes = getShapesFromSketch(state, {
      allowedIds:
        selectedSketchElements.length > 0 ? selectedSketchElements : undefined,
      axisLineId: activeAxisId,
    });
    if (shapes.length === 0) {
      return {
        geometry: null,
        error: "No closed profiles found in selection.",
      };
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
      return { geometry: null, error: "No axis line selected." };
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
      return {
        geometry: null,
        error: "Failed to generate geometry. Check profile/axis.",
      };
    }

    if (featureType === "EXTRUDE" && operation === "CUT") {
      geom.translate(0, 0, zOffset);
    }

    return { geometry: geom as THREE.BufferGeometry, error: null };
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

  useEffect(() => {
    setErrorMsg(previewError);
  }, [previewError]);

  useAxisVisualization({
    axisHelperGroupRef,
    state,
    currentTransform,
    isConfigOpen,
    featureType,
    activeAxisId,
  });

  usePreviewMesh({
    meshGroupRef,
    previewGeometry,
    currentTransform,
    operation,
  });

  useFaceHighlight({
    highlightGroupRef,
    selectedFaceData,
  });

  const setRayFromEvent = useCallback((event: React.MouseEvent) => {
    if (!cameraRef.current) return false;
    const rect = mountRef.current?.getBoundingClientRect();
    if (!rect) return false;
    setRayFromMouseEvent(
      raycasterRef.current,
      mouseRef.current,
      event,
      rect,
      cameraRef.current
    );
    return true;
  }, []);

  const tryPickSketchElement = useCallback(() => {
    if (!sketchVisGroupRef.current) return null;
    return pickSketchElementId(
      raycasterRef.current,
      sketchVisGroupRef.current.children
    );
  }, []);

  const tryPickFace = useCallback((objectsToCheck: THREE.Object3D[]) => {
    const face = pickFaceData(raycasterRef.current, objectsToCheck);
    if (!face) return false;
    setSelectedFaceData(face);
    setSelectedSketchElements([]);
    return true;
  }, []);
  
  // Face projection helper function
  const projectFaceEdges = useCallback((faceData: {
    boundaryEdges: THREE.Line3[];
    normal: THREE.Vector3;
    matrixWorld: THREE.Matrix4;
  }) => {
    const { boundaryEdges, normal, matrixWorld } = faceData;
    if (boundaryEdges.length === 0) {
      alert("Could not detect face boundary.");
      throw new Error("No boundary edges");
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
    
    // Transform edges to sketch coordinate system
    const edgesInSketchSpace = boundaryEdges.map((edge) => {
      const startWorld = edge.start.clone().applyMatrix4(matrixWorld);
      const endWorld = edge.end.clone().applyMatrix4(matrixWorld);
      const startSketch = startWorld.applyMatrix4(worldToLocal);
      const endSketch = endWorld.applyMatrix4(worldToLocal);
      return new THREE.Line3(startSketch, endSketch);
    });

    const projectedPoints: Point[] = [];
    const projectedLines: Line[] = [];
    const projectedCircles: Circle[] = [];
    const projectedArcs: Arc[] = [];
    
    const findPoint = (x: number, y: number) =>
      projectedPoints.find(
        (p) => Math.abs(p.x - x) < 0.001 && Math.abs(p.y - y) < 0.001
      );
    
    const getOrCreatePoint = (x: number, y: number): Point => {
      let p = findPoint(x, y);
      if (!p) {
        p = {
          id: `p_proj_${Math.random().toString(36).substr(2, 9)}`,
          x,
          y,
          fixed: true,
        };
        projectedPoints.push(p);
      }
      return p;
    };

    // Group edges and detect circles/arcs
    const edgeGroups = groupConnectedEdges(edgesInSketchSpace);
    const usedEdges = new Set<THREE.Line3>();

    for (const group of edgeGroups) {
      const detection = detectCircularSequence(group);
      
      if (detection && detection.rmsError <= 0.1) {
        // Found a circle or arc!
        const centerPoint = getOrCreatePoint(detection.center.x, detection.center.y);
        
        if (detection.isFullCircle) {
          // Create a construction circle
          const circle = {
            id: `c_proj_${Math.random().toString(36).substr(2, 9)}`,
            center: centerPoint.id,
            radius: detection.radius,
            construction: true,
          };
          projectedCircles.push(circle);
        } else if (detection.startAngle !== undefined && detection.endAngle !== undefined) {
          // Create a construction arc
          // Calculate start and end points on the arc
          const startX = detection.center.x + detection.radius * Math.cos(detection.startAngle);
          const startY = detection.center.y + detection.radius * Math.sin(detection.startAngle);
          const endX = detection.center.x + detection.radius * Math.cos(detection.endAngle);
          const endY = detection.center.y + detection.radius * Math.sin(detection.endAngle);
          
          const p1 = getOrCreatePoint(startX, startY);
          const p2 = getOrCreatePoint(endX, endY);
          
          const arc = {
            id: `a_proj_${Math.random().toString(36).substr(2, 9)}`,
            center: centerPoint.id,
            radius: detection.radius,
            p1: p1.id,
            p2: p2.id,
            construction: true,
          };
          projectedArcs.push(arc);
        }
        
        // Mark these edges as used (don't create line segments for them)
        group.forEach(edge => usedEdges.add(edge));
      }
    }

    // Create line segments for edges that weren't detected as circles/arcs
    edgesInSketchSpace.forEach((edge) => {
      if (usedEdges.has(edge)) return; // Skip edges that are part of circles/arcs
      
      const p1 = getOrCreatePoint(edge.start.x, edge.start.y);
      const p2 = getOrCreatePoint(edge.end.x, edge.end.y);
      
      projectedLines.push({
        id: `l_proj_${Math.random().toString(36).substr(2, 9)}`,
        p1: p1.id,
        p2: p2.id,
        construction: true,
      });
    });
    
    return { 
      projectedLines, 
      projectedPoints, 
      projectedCircles, 
      projectedArcs, 
      localToWorld 
    };
  }, []);
  
  const handleReimportFaceEdges = useCallback((faceData: {
    point: THREE.Vector3;
    normal: THREE.Vector3;
    boundaryEdges: THREE.Line3[];
    faceVertices: Float32Array;
    matrixWorld: THREE.Matrix4;
  }) => {
    if (!onReimportFaceEdges) return;
    const { projectedLines, projectedPoints, projectedCircles, projectedArcs, localToWorld } = projectFaceEdges(faceData);
    onReimportFaceEdges(
      projectedLines,
      projectedPoints,
      localToWorld.toArray(),
      projectedCircles,
      projectedArcs
    );
    setIsReimportMode(false);
    setSelectedFaceData(null);
  }, [onReimportFaceEdges, projectFaceEdges]);

  const onCanvasMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (isConfigOpen || !sketchVisGroupRef.current) return;
      if (!setRayFromEvent(event)) return;

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
    },
    [hoveredSketchElement, isConfigOpen, setRayFromEvent]
  );

  const onCanvasClick = useCallback(
    (event: React.MouseEvent) => {
      if (
        !meshGroupRef.current ||
        !historyGroupRef.current ||
        !sketchVisGroupRef.current ||
        !cameraRef.current
      )
        return;
      
      // Allow clicks in reimport mode even if config is open
      if (isConfigOpen && !isReimportMode) return;

      if (!setRayFromEvent(event)) return;

      // If in reimport mode, only allow face picking
      if (isReimportMode) {
        const objectsToCheck = [...historyGroupRef.current.children];
        raycasterRef.current.params.Line.threshold = 0.1;
        const face = pickFaceData(raycasterRef.current, objectsToCheck);
        if (face) {
          // Face selected, trigger reimport immediately with the face data
          handleReimportFaceEdges(face);
          setSelectedFaceData(face);
        }
        return;
      }

      // 1. Check for Sketch Elements
      const sketchId = tryPickSketchElement();
      if (sketchId) {
        setSelectedSketchElements((prev) => {
          if (prev.includes(sketchId))
            return prev.filter((id) => id !== sketchId);
          return [...prev, sketchId];
        });
        setSelectedFaceData(null);
        return;
      }

      // 2. Check for Solid Faces
      const objectsToCheck = [...historyGroupRef.current.children];
      const didPickFace = tryPickFace(objectsToCheck);
      if (!didPickFace) {
        setSelectedFaceData(null);
        setSelectedSketchElements([]);
      }
    },
    [isConfigOpen, isReimportMode, setRayFromEvent, tryPickFace, tryPickSketchElement, handleReimportFaceEdges]
  );

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
    const { projectedLines, projectedPoints, projectedCircles, projectedArcs, localToWorld } = projectFaceEdges(selectedFaceData);
    onSketchOnFace(
      projectedLines,
      projectedPoints,
      localToWorld.toArray(),
      projectedArcs || [],
      projectedCircles || []
    );
  };

  const hasActiveSketch = state.lines.length > 0 || state.circles.length > 0;
  
  // Determine if warning should be shown
  const showProjectionWarning = initialFeatureParams && allFeatures.length > 0
    ? shouldShowProjectionWarning(initialFeatureParams, allFeatures)
    : false;

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
      <ThreeViewOverlay
        hasActiveSketch={hasActiveSketch}
        isConfigOpen={isConfigOpen}
        selectedSketchElements={selectedSketchElements}
        featureType={featureType}
        operation={operation}
        throughAll={throughAll}
        localDepth={localDepth}
        revolveAngle={revolveAngle}
        activeAxisId={activeAxisId}
        lines={state.lines}
        initialFeatureParams={initialFeatureParams}
        errorMsg={errorMsg}
        selectedFaceData={selectedFaceData}
        showProjectionWarning={showProjectionWarning}
        isReimportMode={isReimportMode}
        onFitView={fitView}
        onExportSTL={handleExportSTL}
        onSetFeatureType={setFeatureType}
        onSetIsConfigOpen={setIsConfigOpen}
        onSetOperation={setOperation}
        onSetThroughAll={setThroughAll}
        onSetLocalDepth={setLocalDepth}
        onSetRevolveAngle={setRevolveAngle}
        onSetActiveAxisId={(value) => setActiveAxisId(value)}
        onCommit={handleCommit}
        onEditSketch={handleEditSketch}
        onCreateSketchOnFace={handleCreateSketchOnFace}
        onStartReimport={() => setIsReimportMode(true)}
        onCancelReimport={() => setIsReimportMode(false)}
      />
    </div>
  );
};

export default ThreeView;
