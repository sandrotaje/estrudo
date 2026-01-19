import React from "react";
import { Feature, Line } from "../../types";

type ThreeViewOverlayProps = {
  hasActiveSketch: boolean;
  isConfigOpen: boolean;
  selectedSketchElements: string[];
  featureType: "EXTRUDE" | "REVOLVE" | "LOFT";
  operation: "NEW" | "CUT";
  throughAll: boolean;
  localDepth: number;
  revolveAngle: number;
  activeAxisId: string | null;
  lines: Line[];
  initialFeatureParams?: Feature;
  errorMsg: string | null;
  isGeneratingPreview?: boolean;
  selectedFaceData: unknown | null;
  showProjectionWarning: boolean;
  isReimportMode: boolean;
  // Loft props
  availableSketches: Feature[];
  selectedLoftSketchIds: string[];
  onToggleLoftSketch: (sketchId: string) => void;
  // Callbacks
  onFitView: () => void;
  onExportSTL: () => void;
  onSetFeatureType: (value: "EXTRUDE" | "REVOLVE" | "LOFT") => void;
  onSetIsConfigOpen: (value: boolean) => void;
  onSetOperation: (value: "NEW" | "CUT") => void;
  onSetThroughAll: (value: boolean) => void;
  onSetLocalDepth: (value: number) => void;
  onSetRevolveAngle: (value: number) => void;
  onSetActiveAxisId: (value: string) => void;
  onCommit: () => void;
  onEditSketch: () => void;
  onCreateSketchOnFace: () => void;
  onExtrudeFace: () => void;
  onStartReimport: () => void;
  onCancelReimport: () => void;
  hasFeatures: boolean;
  onCommitSketchOnly?: () => void;
  onNewSketchOnPlane?: () => void;
};

const ThreeViewOverlay: React.FC<ThreeViewOverlayProps> = ({
  hasActiveSketch,
  isConfigOpen,
  selectedSketchElements,
  featureType,
  operation,
  throughAll,
  localDepth,
  revolveAngle,
  activeAxisId,
  lines,
  initialFeatureParams,
  errorMsg,
  isGeneratingPreview,
  selectedFaceData,
  showProjectionWarning,
  isReimportMode,
  availableSketches,
  selectedLoftSketchIds,
  onToggleLoftSketch,
  onFitView,
  onExportSTL,
  onSetFeatureType,
  onSetIsConfigOpen,
  onSetOperation,
  onSetThroughAll,
  onSetLocalDepth,
  onSetRevolveAngle,
  onSetActiveAxisId,
  onCommit,
  onEditSketch,
  onCreateSketchOnFace,
  onExtrudeFace,
  onStartReimport,
  onCancelReimport,
  hasFeatures,
  onCommitSketchOnly,
  onNewSketchOnPlane,
}) => {
  const canLoft = availableSketches.length >= 2;
  
  return (
    <>
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <button
          onClick={onFitView}
          className="bg-[#1a1a1a]/90 border border-white/10 text-white px-3 py-2 rounded-xl text-xs font-bold uppercase hover:bg-white/10"
          title="Recenter View"
        >
          ⛶
        </button>
        <button
          onClick={onExportSTL}
          className="bg-[#1a1a1a]/90 border border-white/10 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase hover:bg-white/10 flex items-center gap-2"
        >
          <span className="text-lg">⬇</span> Export STL
        </button>
      </div>
      
      {/* Warning banner for features with projected lines */}
      {showProjectionWarning && initialFeatureParams && !isReimportMode && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-amber-600/90 backdrop-blur-md px-4 py-3 rounded-xl border border-amber-400/20 shadow-xl max-w-md animate-in slide-in-from-top-4 fade-in">
          <div className="flex items-start gap-3">
            <span className="text-xl flex-shrink-0">⚠️</span>
            <div className="flex-1">
              <div className="text-xs font-bold text-white mb-1">
                Projected Face Edges May Be Outdated
              </div>
              <div className="text-[10px] text-white/90 mb-2">
                This feature was created on a face. If you modified earlier features, the imported construction lines may not match the current geometry.
              </div>
              <button
                onClick={onStartReimport}
                className="bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all border border-white/20"
              >
                Update Face Projection
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Reimport mode instructions */}
      {isReimportMode && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-blue-600/90 backdrop-blur-md px-4 py-3 rounded-xl border border-blue-400/20 shadow-xl max-w-md animate-in slide-in-from-top-4 fade-in">
          <div className="flex items-start gap-3">
            <span className="text-xl flex-shrink-0">👆</span>
            <div className="flex-1">
              <div className="text-xs font-bold text-white mb-1">
                Select Face to Re-import Edges
              </div>
              <div className="text-[10px] text-white/90 mb-2">
                Click on a face to project its edges onto your sketch. The imported construction lines will be updated.
              </div>
              <button
                onClick={onCancelReimport}
                className="bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all border border-white/20"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
                onSetFeatureType("EXTRUDE");
                onSetIsConfigOpen(true);
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
                onSetFeatureType("REVOLVE");
                onSetIsConfigOpen(true);
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
            {onCommitSketchOnly && (
              <button
                onClick={onCommitSketchOnly}
                className="flex items-center gap-3 px-4 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl shadow-lg transition-all text-left"
              >
                <span className="text-xl">📝</span>
                <div className="flex flex-col">
                  <span className="text-xs font-bold uppercase">Sketch Only</span>
                  <span className="text-[9px] opacity-80">
                    Save for loft/sweep
                  </span>
                </div>
              </button>
            )}
          </div>
        </div>
      )}


      {/* New Sketch / Face Actions / Loft Buttons (When features exist but no active sketch) */}
      {!isConfigOpen && !hasActiveSketch && hasFeatures && onNewSketchOnPlane && (
        <div className="absolute top-4 left-4 z-10 animate-in fade-in flex flex-col gap-2">
          <button
            onClick={onNewSketchOnPlane}
            className="flex items-center gap-3 px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl shadow-lg transition-all"
          >
            <span className="text-xl">📐</span>
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold uppercase">New Sketch</span>
              <span className="text-[9px] opacity-80">On plane (XY, XZ, YZ)</span>
            </div>
          </button>
          {selectedFaceData && (
            <>
              <button
                onClick={onCreateSketchOnFace}
                className="flex items-center gap-3 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg transition-all"
              >
                <span className="text-xl">✏️</span>
                <div className="flex flex-col text-left">
                  <span className="text-xs font-bold uppercase">Sketch on Face</span>
                  <span className="text-[9px] opacity-80">Draw on selected face</span>
                </div>
              </button>
              <button
                onClick={onExtrudeFace}
                className="flex items-center gap-3 px-4 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl shadow-lg transition-all"
              >
                <span className="text-xl">⬆</span>
                <div className="flex flex-col text-left">
                  <span className="text-xs font-bold uppercase">Extrude</span>
                  <span className="text-[9px] opacity-80">Extrude selected face</span>
                </div>
              </button>
            </>
          )}
          {canLoft && (
            <button
              onClick={() => {
                onSetFeatureType("LOFT");
                onSetIsConfigOpen(true);
              }}
              className="flex items-center gap-3 px-4 py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-xl shadow-lg transition-all"
            >
              <span className="text-xl">🔗</span>
              <div className="flex flex-col text-left">
                <span className="text-xs font-bold uppercase">Loft</span>
                <span className="text-[9px] opacity-80">Between {availableSketches.length} sketches</span>
              </div>
            </button>
          )}
        </div>
      )}
      {/* Config Panel (Extrude/Revolve/Loft) */}
      {isConfigOpen && (
        <div
          className={`absolute top-4 left-4 z-10 bg-[#1a1a1a]/95 backdrop-blur-xl p-5 rounded-2xl border border-white/10 shadow-2xl w-72 flex flex-col gap-4 animate-in slide-in-from-left-4 transition-opacity ${
            isReimportMode ? 'opacity-50 pointer-events-none' : ''
          }`}
          onClick={(e) => {
            // Don't stop propagation in reimport mode so clicks can reach the canvas
            if (!isReimportMode) {
              e.stopPropagation();
            }
          }}
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
              onClick={() => onSetFeatureType("EXTRUDE")}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-md transition-colors ${
                featureType === "EXTRUDE"
                  ? "bg-purple-600 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Extrude
            </button>
            <button
              onClick={() => onSetFeatureType("REVOLVE")}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-md transition-colors ${
                featureType === "REVOLVE"
                  ? "bg-orange-600 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Revolve
            </button>
            {canLoft && (
              <button
                onClick={() => onSetFeatureType("LOFT")}
                className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-md transition-colors ${
                  featureType === "LOFT"
                    ? "bg-teal-600 text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                Loft
              </button>
            )}
          </div>

          {/* Operation Toggle (not for Loft) */}
          {featureType !== "LOFT" && (
            <div className="flex bg-[#000] p-1 rounded-lg">
              <button
                onClick={() => onSetOperation("NEW")}
                className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-md transition-colors ${
                  operation === "NEW"
                    ? "bg-blue-600 text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                New
              </button>
              <button
                onClick={() => onSetOperation("CUT")}
                className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-md transition-colors ${
                  operation === "CUT"
                    ? "bg-red-600 text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                Cut
              </button>
            </div>
          )}

          {featureType === "EXTRUDE" && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="throughAll"
                  checked={throughAll}
                  onChange={(e) => onSetThroughAll(e.target.checked)}
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
                        onSetLocalDepth(parseFloat(e.target.value))
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
                  onChange={(e) => onSetLocalDepth(parseFloat(e.target.value))}
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
                      onSetRevolveAngle(parseFloat(e.target.value))
                    }
                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg py-2 px-3 text-sm font-mono text-orange-400 focus:outline-none focus:border-orange-500"
                  />
                </div>
                <input
                  type="range"
                  min="1"
                  max="360"
                  value={revolveAngle}
                  onChange={(e) =>
                    onSetRevolveAngle(parseFloat(e.target.value))
                  }
                  className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                  Axis Line
                </label>
                <select
                  value={activeAxisId || ""}
                  onChange={(e) => onSetActiveAxisId(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg py-2 px-3 text-xs text-gray-300 focus:outline-none"
                >
                  <option value="" disabled>
                    Select Axis...
                  </option>
                  {lines.map((l, i) => (
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

          {featureType === "LOFT" && (
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                Select Sketches to Loft (in order)
              </label>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {availableSketches.map((sketch, i) => {
                  const isSelected = selectedLoftSketchIds.includes(sketch.id);
                  const selectionIndex = selectedLoftSketchIds.indexOf(sketch.id);
                  return (
                    <button
                      key={sketch.id}
                      onClick={() => onToggleLoftSketch(sketch.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all ${
                        isSelected
                          ? "bg-teal-600/20 border border-teal-500/50 text-teal-300"
                          : "bg-[#0a0a0a] border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20"
                      }`}
                    >
                      <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold ${
                        isSelected ? "bg-teal-600 text-white" : "bg-gray-700 text-gray-500"
                      }`}>
                        {isSelected ? selectionIndex + 1 : i + 1}
                      </span>
                      <span className="text-xs font-medium">{sketch.name}</span>
                    </button>
                  );
                })}
              </div>
              {selectedLoftSketchIds.length < 2 && (
                <p className="text-[10px] text-amber-400">
                  Select at least 2 sketches to create a loft
                </p>
              )}
              {selectedLoftSketchIds.length >= 2 && (
                <p className="text-[10px] text-teal-400">
                  Will loft between {selectedLoftSketchIds.length} sketches
                </p>
              )}
            </div>
          )}

          {initialFeatureParams && featureType !== "LOFT" && (
            <div className="pt-2 border-t border-white/5">
              <button
                onClick={onEditSketch}
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

          {isGeneratingPreview && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-[10px] text-blue-400 font-bold">Generating preview...</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => onSetIsConfigOpen(false)}
              className="flex-1 py-2 rounded-lg bg-[#333] hover:bg-[#444] text-xs font-bold text-gray-300 uppercase"
            >
              Cancel
            </button>
            <button
              onClick={onCommit}
              disabled={!!errorMsg || isGeneratingPreview || (featureType === "LOFT" && selectedLoftSketchIds.length < 2)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold text-white uppercase shadow-lg ${
                errorMsg || isGeneratingPreview || (featureType === "LOFT" && selectedLoftSketchIds.length < 2)
                  ? "bg-gray-700"
                  : featureType === "LOFT" ? "bg-teal-600 hover:bg-teal-500" : "bg-blue-600 hover:bg-blue-500"
              }`}
            >
              OK
            </button>
          </div>
        </div>
      )}

    </>
  );
};

export default ThreeViewOverlay;
