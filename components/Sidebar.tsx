
import React, { useState, useRef, useEffect } from 'react';
import { SketchState, ConstraintType, Feature } from '../types';

interface SidebarProps {
  isOpen: boolean;
  state: SketchState;
  features?: Feature[];
  editingFeatureId?: string | null;
  onAddConstraint: (type: ConstraintType, pointIds: string[], lineIds: string[], circleIds: string[], value?: number) => void;
  onUpdateConstraintValue: (id: string, value: number) => void;
  onSelectConstraints: (ids: string[]) => void;
  aiAdvice: string | null;
  onRefreshAdvice: () => void;
  onDelete: () => void;
  onClose: () => void;
  onToggleConstruction: () => void;
  onEditFeature?: (id: string) => void;
  onDeleteFeature?: (id: string) => void;
  onAutoIntersection?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  isOpen, state, features = [], editingFeatureId,
  onAddConstraint, onUpdateConstraintValue, onSelectConstraints, 
  aiAdvice, onRefreshAdvice, onDelete, onClose, onToggleConstruction,
  onEditFeature, onDeleteFeature, onAutoIntersection
}) => {
  const selectedCount = state.selectedPointIds.length + state.selectedLineIds.length + state.selectedCircleIds.length + state.selectedConstraintIds.length;
  
  const [pendingConstraint, setPendingConstraint] = useState<{
    id?: string;
    type: ConstraintType;
    pIds: string[];
    lIds: string[];
    cIds: string[];
    initialValue: string;
  } | null>(null);
  
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pendingConstraint && inputRef.current) {
      setInputValue(pendingConstraint.initialValue);
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [pendingConstraint]);

  const handleConstraintClick = (type: ConstraintType, needsInput: boolean) => {
    let pIds = [...state.selectedPointIds];
    let lIds = [...state.selectedLineIds];
    let cIds = [...state.selectedCircleIds];
    
    if (state.selectedLineIds.length > 0 && 
       (type === ConstraintType.HORIZONTAL || type === ConstraintType.VERTICAL || type === ConstraintType.DISTANCE)) {
      state.selectedLineIds.forEach(lId => {
        const line = state.lines.find(l => l.id === lId);
        if (line) {
          if (!pIds.includes(line.p1)) pIds.push(line.p1);
          if (!pIds.includes(line.p2)) pIds.push(line.p2);
        }
      });
    }

    const isLineCircleDist = (type === ConstraintType.DISTANCE && lIds.length === 1 && cIds.length === 1);
    const isCircleCircleDist = (type === ConstraintType.DISTANCE && cIds.length === 2);
    const isLineCircleCoincident = (type === ConstraintType.COINCIDENT && lIds.length === 1 && cIds.length === 1);
    const isPointLineCoincident = (type === ConstraintType.COINCIDENT && lIds.length === 1 && pIds.length === 1);
    const isPointLineMidpoint = (type === ConstraintType.MIDPOINT && lIds.length === 1 && pIds.length === 1);

    if ((type === ConstraintType.HORIZONTAL || type === ConstraintType.VERTICAL || type === ConstraintType.DISTANCE || type === ConstraintType.COINCIDENT || type === ConstraintType.MIDPOINT) 
        && pIds.length < 2 
        && !isLineCircleDist 
        && !isCircleCircleDist
        && !isLineCircleCoincident 
        && !isPointLineCoincident
        && !isPointLineMidpoint
    ) {
        alert("Select at least two points or a line");
        return;
    }

    if (type === ConstraintType.ANGLE) {
      if (lIds.length !== 1 && lIds.length !== 2) {
        alert("Select exactly one line (angle with horizontal) or two lines (angle between lines)");
        return;
      }
    }

    if (type === ConstraintType.PARALLEL) {
      if (lIds.length !== 2) {
        alert("Select exactly two lines to make them parallel");
        return;
      }
    }

    if (type === ConstraintType.EQUAL_LENGTH) {
      if (lIds.length !== 2) {
        alert("Select exactly two lines to make their lengths equal");
        return;
      }
    }

    if (type === ConstraintType.TANGENT) {
      const isLineCircle = lIds.length === 1 && cIds.length === 1;
      const isCircleCircle = cIds.length === 2 && lIds.length === 0 && pIds.length === 0;
      const isPointCircle = pIds.length === 1 && cIds.length === 1 && lIds.length === 0;

      if (!isLineCircle && !isCircleCircle && !isPointCircle) {
        alert("Select (1 Line + 1 Circle) OR (2 Circles) OR (1 Point + 1 Circle) to apply tangent");
        return;
      }
    }

    if (needsInput) {
      let defaultVal = '0';
      if (type === ConstraintType.DISTANCE) {
         if (lIds.length === 1 && cIds.length === 1) {
            const line = state.lines.find(l => l.id === lIds[0]);
            const circle = state.circles.find(cir => cir.id === cIds[0]);
            if (line && circle) {
                const p1 = state.points.find(p => p.id === line.p1)!;
                const p2 = state.points.find(p => p.id === line.p2)!;
                const center = state.points.find(p => p.id === circle.center)!;
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const l2 = dx*dx + dy*dy;
                if (l2 > 0) {
                    const distToCenter = Math.abs(dy*center.x - dx*center.y + p2.x*p1.y - p2.y*p1.x) / Math.sqrt(l2);
                    defaultVal = Math.round(distToCenter - circle.radius).toString();
                }
            }
         } else if (cIds.length === 2) {
            const getC = (id: string) => state.circles.find(c => c.id === id) || state.arcs.find(a => a.id === id);
            const c1 = getC(cIds[0]);
            const c2 = getC(cIds[1]);
            if (c1 && c2) {
               const p1 = state.points.find(p => p.id === c1.center);
               const p2 = state.points.find(p => p.id === c2.center);
               if (p1 && p2) {
                   const dist = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
                   const gapExt = dist - c1.radius - c2.radius;
                   const gapInt = Math.abs(c1.radius - c2.radius) - dist;

                   if (Math.abs(gapInt) < Math.abs(gapExt)) {
                       defaultVal = Math.round(gapInt).toString();
                   } else {
                       defaultVal = Math.round(gapExt).toString();
                   }
               }
            }
         } else if (pIds.length >= 2) {
            const p1 = state.points.find(p => p.id === pIds[0]);
            const p2 = state.points.find(p => p.id === pIds[1]);
            if (p1 && p2) {
              const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
              defaultVal = Math.round(dist).toString();
            }
         }
      } else if (type === ConstraintType.RADIUS && cIds.length > 0) {
        const c = state.circles.find(cir => cir.id === cIds[0]) || state.arcs.find(a => a.id === cIds[0]);
        if (c) defaultVal = Math.round(c.radius).toString();
      } else if (type === ConstraintType.ANGLE) {
        if (lIds.length === 2) {
           const l1 = state.lines.find(l => l.id === lIds[0]);
           const l2 = state.lines.find(l => l.id === lIds[1]);
           if (l1 && l2) {
             const p1 = state.points.find(p => p.id === l1.p1)!;
             const p2 = state.points.find(p => p.id === l1.p2)!;
             const p3 = state.points.find(p => p.id === l2.p1)!;
             const p4 = state.points.find(p => p.id === l2.p2)!;
             
             const v1x = p2.x - p1.x, v1y = p2.y - p1.y;
             const v2x = p4.x - p3.x, v2y = p4.y - p3.y;
             const dot = v1x * v2x + v1y * v2y;
             const mag1 = Math.sqrt(v1x*v1x + v1y*v1y);
             const mag2 = Math.sqrt(v2x*v2x + v2y*v2y);
             if (mag1 > 0 && mag2 > 0) {
                let angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
                defaultVal = Math.round(angleRad * 180 / Math.PI).toString();
             }
           }
        } else if (lIds.length === 1) {
           const l1 = state.lines.find(l => l.id === lIds[0]);
           if (l1) {
             const p1 = state.points.find(p => p.id === l1.p1)!;
             const p2 = state.points.find(p => p.id === l1.p2)!;
             const dy = p2.y - p1.y;
             const dx = p2.x - p1.x;
             defaultVal = Math.round(Math.atan2(dy, dx) * 180 / Math.PI).toString();
           }
        }
      }
      
      setPendingConstraint({ type, pIds, lIds, cIds, initialValue: defaultVal });
    } else {
      onAddConstraint(type, pIds, lIds, cIds);
    }
  };

  const handleEditConstraint = (e: React.MouseEvent, cId: string) => {
    e.stopPropagation();
    const c = state.constraints.find(con => con.id === cId);
    if (!c || c.value === undefined) return;
    setPendingConstraint({
      id: c.id,
      type: c.type,
      pIds: c.points,
      lIds: c.lines,
      cIds: c.circles,
      initialValue: c.value.toString()
    });
  };

  const confirmInput = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (pendingConstraint) {
      const val = parseFloat(inputValue);
      if (!isNaN(val)) {
        if (pendingConstraint.id) {
          onUpdateConstraintValue(pendingConstraint.id, val);
        } else {
          onAddConstraint(pendingConstraint.type, pendingConstraint.pIds, pendingConstraint.lIds, pendingConstraint.cIds, val);
        }
      }
      setPendingConstraint(null);
    }
  };

  return (
    <>
      <div className={`fixed inset-0 bg-black/60 z-[90] transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <div className={`fixed inset-y-0 left-0 w-80 bg-[#1a1a1a] z-[100] transform transition-transform duration-300 shadow-2xl flex flex-col ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        
        <div className="p-4 border-b border-white/5 flex items-center justify-between shrink-0">
          <span className="font-bold text-sm tracking-tighter uppercase text-blue-400">Sketcher Properties</span>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          <section>
            <h2 className="text-[10px] font-bold text-gray-600 uppercase mb-2">Solids History</h2>
            <div className="space-y-1 bg-[#111] rounded-lg p-2 max-h-48 overflow-y-auto">
               {features.length === 0 && <div className="text-[10px] text-gray-600 italic p-2">No extruded features yet</div>}
               {features.map((feature, i) => (
                  <div key={feature.id} className={`p-2 rounded flex items-center justify-between group ${editingFeatureId === feature.id ? 'bg-blue-900/20 border border-blue-500/50' : 'bg-[#1a1a1a] hover:bg-[#222]'}`}>
                      <div className="flex items-center gap-2">
                          <span className="text-lg">🧊</span>
                          <div className="flex flex-col">
                             <span className="text-[10px] font-bold text-gray-300">{feature.name}</span>
                             <span className="text-[8px] text-gray-600">Depth: {feature.extrusionDepth}mm</span>
                          </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                         {editingFeatureId !== feature.id && (
                             <button onClick={() => onEditFeature?.(feature.id)} className="px-2 py-1 bg-blue-600 text-white text-[8px] font-bold uppercase rounded hover:bg-blue-500">Edit</button>
                         )}
                         <button onClick={() => onDeleteFeature?.(feature.id)} className="px-2 py-1 bg-red-600 text-white text-[8px] font-bold uppercase rounded hover:bg-red-500">Del</button>
                      </div>
                  </div>
               ))}
               
               {editingFeatureId && (
                   <div className="mt-2 text-[10px] text-blue-400 font-bold text-center animate-pulse">
                       Editing Feature...
                   </div>
               )}
            </div>
          </section>

          <hr className="border-white/5 my-2" />
          
          {pendingConstraint ? (
            <div className="bg-[#222] p-4 rounded-lg border border-blue-500/30 animate-in fade-in slide-in-from-left-4">
              <h3 className="text-xs font-bold text-blue-400 uppercase mb-3">
                {pendingConstraint.id ? 'Edit Value' : 
                 (pendingConstraint.type === ConstraintType.ANGLE ? 'Set Angle (Deg)' : 
                 pendingConstraint.type === ConstraintType.DISTANCE ? 'Set Distance' : 'Set Radius')}
              </h3>
              <form onSubmit={confirmInput}>
                <div className="flex gap-2 mb-3">
                  <input
                    ref={inputRef}
                    type="number"
                    step="0.1"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="w-full bg-[#111] border border-white/10 rounded px-3 py-2 text-white font-mono focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded text-xs font-bold uppercase">Apply</button>
                  <button 
                    type="button" 
                    onClick={() => setPendingConstraint(null)}
                    className="flex-1 bg-[#333] hover:bg-[#444] text-gray-300 py-2 rounded text-xs font-bold uppercase"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <>
            <section className="mb-4">
              <h2 className="text-[10px] font-bold text-gray-600 uppercase mb-2">Tools</h2>
              <div className="grid grid-cols-2 gap-2">
                 <button 
                   onClick={onAutoIntersection}
                   className="p-3 bg-[#222] rounded-lg text-xs font-medium border border-white/5 hover:bg-[#333] active:bg-blue-900/20 transition-colors text-left flex items-center gap-2"
                 >
                    <span className="text-lg">✖</span> Find Intersections
                 </button>
              </div>
            </section>

            <section>
              <h2 className="text-[10px] font-bold text-gray-600 uppercase mb-2">Apply Constraints</h2>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Horizontal', type: ConstraintType.HORIZONTAL },
                  { label: 'Vertical', type: ConstraintType.VERTICAL },
                  { label: 'Distance', type: ConstraintType.DISTANCE, prompt: true },
                  { label: 'Radius', type: ConstraintType.RADIUS, prompt: true },
                  { label: 'Angle', type: ConstraintType.ANGLE, prompt: true },
                  { label: 'Parallel', type: ConstraintType.PARALLEL },
                  { label: 'Equal Length', type: ConstraintType.EQUAL_LENGTH },
                  { label: 'Tangent', type: ConstraintType.TANGENT },
                  { label: 'Fix Point', type: ConstraintType.FIXED },
                  { label: 'Coincident', type: ConstraintType.COINCIDENT },
                  { label: 'Midpoint', type: ConstraintType.MIDPOINT },
                ].map(c => (
                  <button
                    key={c.label}
                    onClick={() => handleConstraintClick(c.type, !!c.prompt)}
                    className="p-3 bg-[#222] rounded-lg text-xs font-medium border border-white/5 hover:bg-[#333] active:bg-blue-900/20 transition-colors text-left"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </section>
            </>
          )}

          <section>
            <h2 className="text-[10px] font-bold text-gray-600 uppercase mb-2">Constraints</h2>
            <div className="space-y-1 bg-[#111] rounded-lg p-2 max-h-48 overflow-y-auto">
               {state.constraints.length === 0 && <div className="text-[10px] text-gray-600 italic p-2">No constraints defined</div>}
               {state.constraints.map((c, i) => {
                 const isSelected = state.selectedConstraintIds.includes(c.id);
                 const hasValue = c.value !== undefined;
                 return (
                    <div 
                      key={c.id} 
                      onClick={() => onSelectConstraints([c.id])}
                      className={`p-2 text-[10px] rounded flex items-center justify-between cursor-pointer group ${isSelected ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'text-gray-400 border border-transparent hover:bg-[#222]'}`}
                    >
                      <div className="flex items-center gap-2">
                         <span className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold ${isSelected ? 'bg-blue-500 text-black' : 'bg-gray-700 text-gray-300'}`}>
                           {c.type[0]}
                         </span>
                         <span>{c.type.toLowerCase()}</span>
                         {hasValue && <span className="font-mono text-white ml-1">{Math.round(c.value! * 10)/10}</span>}
                      </div>
                      
                      {hasValue && (
                        <button 
                          onClick={(e) => handleEditConstraint(e, c.id)}
                          className={`w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 ${isSelected ? 'text-blue-200' : 'text-gray-500 opacity-0 group-hover:opacity-100'}`}
                        >
                          ✎
                        </button>
                      )}
                    </div>
                 );
               })}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[10px] font-bold text-gray-600 uppercase">Elements</h2>
              <div className="flex gap-2">
                {(state.selectedLineIds.length > 0 || state.selectedCircleIds.length > 0) && (
                   <button onClick={onToggleConstruction} className="text-[10px] text-gray-400 hover:text-white font-bold uppercase transition-colors">Toggle Const.</button>
                )}
                {selectedCount > 0 && <button onClick={onDelete} className="text-[10px] text-red-500 font-bold uppercase">Delete</button>}
              </div>
            </div>
            <div className="space-y-1 bg-[#111] rounded-lg p-2 max-h-48 overflow-y-auto">
              {state.points.map((p, i) => (
                <div key={p.id} className={`p-2 text-[10px] rounded ${state.selectedPointIds.includes(p.id) ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400'}`}>
                  • Point {i+1} ({Math.round(p.x)}, {Math.round(p.y)})
                </div>
              ))}
              {state.lines.map((l, i) => (
                <div key={l.id} className={`p-2 text-[10px] rounded ${state.selectedLineIds.includes(l.id) ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400'}`}>
                  / Line {i+1} {l.construction ? '(Constr.)' : ''}
                </div>
              ))}
              {state.circles.map((c, i) => (
                <div key={c.id} className={`p-2 text-[10px] rounded ${state.selectedCircleIds.includes(c.id) ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400'}`}>
                  ○ Circle {i+1} (R: {Math.round(c.radius)}) {c.construction ? '(Constr.)' : ''}
                </div>
              ))}
              {state.arcs?.map((a, i) => (
                <div key={a.id} className={`p-2 text-[10px] rounded ${state.selectedCircleIds.includes(a.id) ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400'}`}>
                  ⌒ Arc {i+1} (R: {Math.round(a.radius)}) {a.construction ? '(Constr.)' : ''}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="p-4 bg-purple-500/5 border-t border-purple-500/10 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">Engineering AI</span>
            <button onClick={onRefreshAdvice} className="text-[10px] text-purple-300 underline">Refresh</button>
          </div>
          <p className="text-xs italic text-gray-400 leading-tight">"{aiAdvice || "Ask for advice to check your sketch degrees of freedom."}"</p>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
