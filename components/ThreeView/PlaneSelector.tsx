import React, { useState, useMemo, useEffect } from "react";
import * as THREE from "three";

export type PlaneType = "XY" | "XZ" | "YZ" | "FACE";

export interface FaceData {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  boundaryEdges: THREE.Line3[];
  faceVertices: Float32Array;
  matrixWorld: THREE.Matrix4;
  featureId?: string;
}

interface PlaneSelectorProps {
  onCancel?: () => void;
  onSelectPlane: (transform: number[]) => void;
  selectedFaceData?: FaceData | null;
}

type StandardPlaneType = "XY" | "XZ" | "YZ";

interface PlaneInfo {
  label: string;
  description: string;
  color: string;
  icon: string;
  normal: THREE.Vector3;
  xAxis: THREE.Vector3;
  yAxis: THREE.Vector3;
}

const STANDARD_PLANE_INFO: Record<StandardPlaneType, PlaneInfo> = {
  XY: {
    label: "XY Plane",
    description: "Top view (Z up)",
    color: "bg-blue-600",
    icon: "⬛",
    normal: new THREE.Vector3(0, 0, 1),
    xAxis: new THREE.Vector3(1, 0, 0),
    yAxis: new THREE.Vector3(0, 1, 0),
  },
  XZ: {
    label: "XZ Plane",
    description: "Front view (Y up)",
    color: "bg-green-600",
    icon: "⬜",
    normal: new THREE.Vector3(0, 1, 0),
    xAxis: new THREE.Vector3(1, 0, 0),
    yAxis: new THREE.Vector3(0, 0, 1),
  },
  YZ: {
    label: "YZ Plane",
    description: "Side view (X up)",
    color: "bg-orange-600",
    icon: "◻️",
    normal: new THREE.Vector3(1, 0, 0),
    xAxis: new THREE.Vector3(0, 1, 0),
    yAxis: new THREE.Vector3(0, 0, 1),
  },
};

const PlaneSelector: React.FC<PlaneSelectorProps> = ({ onSelectPlane, onCancel, selectedFaceData }) => {
  // Default to FACE if face data is available, otherwise XY
  const [selectedPlane, setSelectedPlane] = useState<PlaneType>(selectedFaceData ? "FACE" : "XY");
  const [offset, setOffset] = useState(0);
  const [rotationAngle, setRotationAngle] = useState(0);

  // Update selection when face data becomes available
  useEffect(() => {
    if (selectedFaceData && selectedPlane !== "FACE") {
      setSelectedPlane("FACE");
    }
  }, [selectedFaceData]);

  // Compute face plane info from face data
  const facePlaneInfo = useMemo((): PlaneInfo | null => {
    if (!selectedFaceData) return null;

    const normal = selectedFaceData.normal.clone().normalize();

    // Compute X and Y axes from the face normal
    // Use a consistent up vector to derive X axis
    let upVector = new THREE.Vector3(0, 0, 1);
    // If normal is parallel to up vector, use a different reference
    if (Math.abs(normal.dot(upVector)) > 0.99) {
      upVector = new THREE.Vector3(0, 1, 0);
    }

    const xAxis = new THREE.Vector3().crossVectors(upVector, normal).normalize();
    const yAxis = new THREE.Vector3().crossVectors(normal, xAxis).normalize();

    return {
      label: "Face Plane",
      description: "Offset from selected face",
      color: "bg-cyan-600",
      icon: "◈",
      normal,
      xAxis,
      yAxis,
    };
  }, [selectedFaceData]);

  const generateTransform = useMemo(() => {
    let info: PlaneInfo;
    let basePosition: THREE.Vector3;

    if (selectedPlane === "FACE" && facePlaneInfo && selectedFaceData) {
      info = facePlaneInfo;
      // Base position is the point on the face
      basePosition = selectedFaceData.point.clone();
    } else {
      const standardPlane = selectedPlane === "FACE" ? "XY" : selectedPlane;
      info = STANDARD_PLANE_INFO[standardPlane as StandardPlaneType];
      // Base position is origin for standard planes
      basePosition = new THREE.Vector3(0, 0, 0);
    }

    // Start with the plane's basis vectors
    let xAxis = info.xAxis.clone();
    let yAxis = info.yAxis.clone();
    const zAxis = info.normal.clone();

    // Apply rotation around the normal (Z in local space)
    if (rotationAngle !== 0) {
      const angleRad = (rotationAngle * Math.PI) / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);

      // Rotate X and Y axes around Z (normal)
      const newX = xAxis.clone().multiplyScalar(cos).add(yAxis.clone().multiplyScalar(sin));
      const newY = xAxis.clone().multiplyScalar(-sin).add(yAxis.clone().multiplyScalar(cos));
      xAxis = newX;
      yAxis = newY;
    }

    // Calculate position (base position + offset along normal)
    const position = basePosition.clone().add(zAxis.clone().multiplyScalar(offset));

    // Build the transform matrix (column-major order)
    const matrix = new THREE.Matrix4();
    matrix.makeBasis(xAxis, yAxis, zAxis);
    matrix.setPosition(position);

    return matrix.toArray();
  }, [selectedPlane, offset, rotationAngle, facePlaneInfo, selectedFaceData]);

  const handleStartSketch = () => {
    onSelectPlane(generateTransform);
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
      <div 
        className="bg-[#1a1a1a]/95 backdrop-blur-xl p-6 rounded-2xl border border-white/10 shadow-2xl w-96 pointer-events-auto animate-in zoom-in-95 fade-in duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-6">
          <span className="text-2xl">📐</span>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Start New Sketch
            </h2>
            <p className="text-[10px] text-gray-500">
              Select a plane to begin sketching
            </p>
          </div>
        </div>

        {/* Face Plane Option (when face is selected) */}
        {selectedFaceData && facePlaneInfo && (
          <div className="mb-4">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">
              Selected Face
            </label>
            <button
              onClick={() => setSelectedPlane("FACE")}
              className={`relative w-full p-3 rounded-xl border-2 transition-all ${
                selectedPlane === "FACE"
                  ? `${facePlaneInfo.color} border-white/30 shadow-lg`
                  : "bg-[#0a0a0a] border-white/5 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${
                  selectedPlane === "FACE" ? "bg-white/20" : "bg-white/5"
                }`}>
                  <svg viewBox="0 0 40 40" className="w-8 h-8">
                    <polygon
                      points="20,5 35,15 30,35 10,35 5,15"
                      fill={selectedPlane === "FACE" ? "#fff" : "#666"}
                      opacity="0.3"
                    />
                    <polygon
                      points="20,5 35,15 30,35 10,35 5,15"
                      fill="none"
                      stroke={selectedPlane === "FACE" ? "#fff" : "#666"}
                      strokeWidth="2"
                    />
                    <line x1="20" y1="20" x2="20" y2="2" stroke="#0ff" strokeWidth="2" markerEnd="url(#arrowhead)" />
                  </svg>
                </div>
                <div className="flex flex-col text-left">
                  <span className={`text-[11px] font-bold uppercase ${
                    selectedPlane === "FACE" ? "text-white" : "text-gray-400"
                  }`}>
                    Face Plane
                  </span>
                  <span className={`text-[9px] ${
                    selectedPlane === "FACE" ? "text-white/70" : "text-gray-500"
                  }`}>
                    Offset from selected face
                  </span>
                </div>
              </div>
              {selectedPlane === "FACE" && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center">
                  <span className="text-[10px]">✓</span>
                </div>
              )}
            </button>
          </div>
        )}

        {/* Standard Plane Selection */}
        <div className="space-y-2 mb-6">
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            {selectedFaceData ? "Or Select Standard Plane" : "Sketch Plane"}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(STANDARD_PLANE_INFO) as StandardPlaneType[]).map((plane) => {
              const info = STANDARD_PLANE_INFO[plane];
              const isSelected = selectedPlane === plane;
              return (
                <button
                  key={plane}
                  onClick={() => setSelectedPlane(plane)}
                  className={`relative p-3 rounded-xl border-2 transition-all ${
                    isSelected
                      ? `${info.color} border-white/30 shadow-lg`
                      : "bg-[#0a0a0a] border-white/5 hover:border-white/20"
                  }`}
                >
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${
                      isSelected ? "bg-white/20" : "bg-white/5"
                    }`}>
                      {/* SVG representation of the plane */}
                      <svg viewBox="0 0 40 40" className="w-8 h-8">
                        {plane === "XY" && (
                          <>
                            <rect x="5" y="15" width="30" height="20" fill={isSelected ? "#fff" : "#666"} opacity="0.3" />
                            <line x1="5" y1="35" x2="35" y2="35" stroke={isSelected ? "#fff" : "#666"} strokeWidth="2" />
                            <line x1="5" y1="35" x2="5" y2="15" stroke={isSelected ? "#fff" : "#666"} strokeWidth="2" />
                            <text x="37" y="37" fontSize="8" fill="#f00">X</text>
                            <text x="2" y="12" fontSize="8" fill="#0f0">Y</text>
                          </>
                        )}
                        {plane === "XZ" && (
                          <>
                            <rect x="5" y="5" width="30" height="20" fill={isSelected ? "#fff" : "#666"} opacity="0.3" transform="skewY(-10)" />
                            <line x1="5" y1="25" x2="35" y2="25" stroke={isSelected ? "#fff" : "#666"} strokeWidth="2" />
                            <line x1="5" y1="25" x2="5" y2="5" stroke={isSelected ? "#fff" : "#666"} strokeWidth="2" />
                            <text x="37" y="27" fontSize="8" fill="#f00">X</text>
                            <text x="2" y="3" fontSize="8" fill="#00f">Z</text>
                          </>
                        )}
                        {plane === "YZ" && (
                          <>
                            <rect x="10" y="5" width="20" height="30" fill={isSelected ? "#fff" : "#666"} opacity="0.3" transform="skewX(-10)" />
                            <line x1="10" y1="35" x2="30" y2="35" stroke={isSelected ? "#fff" : "#666"} strokeWidth="2" />
                            <line x1="10" y1="35" x2="10" y2="5" stroke={isSelected ? "#fff" : "#666"} strokeWidth="2" />
                            <text x="32" y="37" fontSize="8" fill="#0f0">Y</text>
                            <text x="7" y="3" fontSize="8" fill="#00f">Z</text>
                          </>
                        )}
                      </svg>
                    </div>
                    <span className={`text-[10px] font-bold uppercase ${
                      isSelected ? "text-white" : "text-gray-400"
                    }`}>
                      {plane}
                    </span>
                  </div>
                  {isSelected && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center">
                      <span className="text-[10px]">✓</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-500 text-center mt-1">
            {selectedPlane === "FACE" && facePlaneInfo
              ? facePlaneInfo.description
              : selectedPlane !== "FACE"
              ? STANDARD_PLANE_INFO[selectedPlane as StandardPlaneType].description
              : "Select a plane"
            }
          </p>
        </div>

        {/* Offset Input */}
        <div className="space-y-2 mb-4">
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            {selectedPlane === "FACE" ? "Offset from Face (mm)" : "Offset from Origin (mm)"}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={offset}
              onChange={(e) => setOffset(parseFloat(e.target.value) || 0)}
              className="flex-1 bg-[#0a0a0a] border border-white/10 rounded-lg py-2 px-3 text-sm font-mono text-blue-400 focus:outline-none focus:border-blue-500"
              placeholder="0"
            />
            <span className="text-xs text-gray-500 w-8">mm</span>
          </div>
          <input
            type="range"
            min="-500"
            max="500"
            value={offset}
            onChange={(e) => setOffset(parseFloat(e.target.value))}
            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Rotation Input */}
        <div className="space-y-2 mb-6">
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            Rotation Angle (degrees)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={rotationAngle}
              onChange={(e) => setRotationAngle(parseFloat(e.target.value) || 0)}
              className="flex-1 bg-[#0a0a0a] border border-white/10 rounded-lg py-2 px-3 text-sm font-mono text-orange-400 focus:outline-none focus:border-orange-500"
              placeholder="0"
            />
            <span className="text-xs text-gray-500 w-8">deg</span>
          </div>
          <input
            type="range"
            min="-180"
            max="180"
            value={rotationAngle}
            onChange={(e) => setRotationAngle(parseFloat(e.target.value))}
            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex-1 py-3 rounded-xl bg-[#333] hover:bg-[#444] text-gray-300 text-sm font-bold uppercase tracking-wider transition-all"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleStartSketch}
            className={`${onCancel ? 'flex-1' : 'w-full'} py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-sm font-bold uppercase tracking-wider shadow-lg shadow-blue-900/30 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2`}
          >
            <span>✎</span>
            Start Sketching
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlaneSelector;
