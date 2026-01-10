
import React from 'react';
import { SketchState, ConstraintType } from '../types';

interface FloatingConstraintsProps {
  state: SketchState;
  onApplyConstraint: (type: ConstraintType, needsInput: boolean) => void;
  onDelete: () => void;
  onToggleConstruction: () => void;
  onTrim: (id1: string, id2: string) => void;
  onIntersect?: () => void;
  onFillet?: (pointId: string) => void;
}

const FloatingConstraints: React.FC<FloatingConstraintsProps> = ({ state, onApplyConstraint, onDelete, onToggleConstruction, onTrim, onIntersect, onFillet }) => {
  const { selectedPointIds: p, selectedLineIds: l, selectedCircleIds: c, constraints, lines, circles, points } = state;
  const selectionCount = p.length + l.length + c.length;

  if (selectionCount === 0) return null;

  const possibleConstraints: { label: string; type: ConstraintType | 'TRIM' | 'INTERSECT' | 'FILLET'; icon: string; needsInput?: boolean; action?: () => void }[] = [];

  // Helper to check coincident constraint between a point and a line/point
  const isCoincident = (pId: string, lId: string) => {
    return constraints.some(con => 
      con.type === ConstraintType.COINCIDENT && 
      con.points.includes(pId) && 
      con.lines.includes(lId)
    );
  };

  // Helper to find all points coincident with a given point (Cluster)
  const getCoincidentCluster = (startId: string): string[] => {
      const cluster = new Set<string>([startId]);
      const queue = [startId];
      const visited = new Set<string>([startId]);
      
      while (queue.length > 0) {
          const curr = queue.shift()!;
          constraints.filter(c => c.type === ConstraintType.COINCIDENT && c.points.includes(curr)).forEach(c => {
              c.points.forEach(pt => {
                  if (!visited.has(pt)) {
                      visited.add(pt);
                      cluster.add(pt);
                      queue.push(pt);
                  }
              });
          });
      }
      return Array.from(cluster);
  };

  // 1 Point Selected
  if (p.length === 1 && l.length === 0 && c.length === 0) {
    const pointId = p[0];
    
    // FILLET LOGIC: Point (or its coincident cluster) connected to exactly 2 lines
    const cluster = getCoincidentCluster(pointId);
    const connectedLines = lines.filter(ln => 
        cluster.includes(ln.p1) || cluster.includes(ln.p2)
    );

    // Ensure we are looking at unique lines
    const uniqueLineIds = new Set(connectedLines.map(ln => ln.id));
    
    if (uniqueLineIds.size === 2 && onFillet) {
        possibleConstraints.push({ 
            label: 'Fillet Vertex', 
            type: 'FILLET', 
            icon: '╭', 
            action: () => onFillet(pointId) 
        });
    }

    possibleConstraints.push({ label: 'Fix Point', type: ConstraintType.FIXED, icon: '⚓' });
  } 
  // 2 Points Selected
  else if (p.length === 2 && l.length === 0 && c.length === 0) {
    possibleConstraints.push({ label: 'Coincident', type: ConstraintType.COINCIDENT, icon: '⦿' });
    possibleConstraints.push({ label: 'Horizontal', type: ConstraintType.HORIZONTAL, icon: '—' });
    possibleConstraints.push({ label: 'Vertical', type: ConstraintType.VERTICAL, icon: '｜' });
    possibleConstraints.push({ label: 'Distance', type: ConstraintType.DISTANCE, icon: '📏', needsInput: true });

    // TRIM LOGIC
    const [id1, id2] = p;
    // 1. Direct Line Exists?
    const hasLine = lines.some(ln => (ln.p1 === id1 && ln.p2 === id2) || (ln.p1 === id2 && ln.p2 === id1));
    
    // 2. Trim Segment (Point coincident to line ending at other point)
    const lineConnectedTo1 = lines.find(ln => ln.p1 === id1 || ln.p2 === id1);
    const canTrim1 = lineConnectedTo1 && isCoincident(id2, lineConnectedTo1.id);

    const lineConnectedTo2 = lines.find(ln => ln.p1 === id2 || ln.p2 === id2);
    const canTrim2 = lineConnectedTo2 && isCoincident(id1, lineConnectedTo2.id);

    // 3. Trim Circle (Both points on circle)
    const p1Obj = points.find(pt => pt.id === id1);
    const p2Obj = points.find(pt => pt.id === id2);
    const onCircle = circles.some(cir => {
        const center = points.find(pt => pt.id === cir.center);
        if(!center || !p1Obj || !p2Obj) return false;
        const d1 = Math.sqrt((p1Obj.x-center.x)**2 + (p1Obj.y-center.y)**2);
        const d2 = Math.sqrt((p2Obj.x-center.x)**2 + (p2Obj.y-center.y)**2);
        return Math.abs(d1 - cir.radius) < 1 && Math.abs(d2 - cir.radius) < 1;
    });

    if (hasLine || canTrim1 || canTrim2 || onCircle) {
       possibleConstraints.push({ 
         label: 'Trim Segment', 
         type: 'TRIM', 
         icon: '✂️', 
         action: () => onTrim(id1, id2)
       });
    }
  } 
  // 1 Line Selected
  else if (l.length === 1 && p.length === 0 && c.length === 0) {
    possibleConstraints.push({ label: 'Horizontal', type: ConstraintType.HORIZONTAL, icon: '—' });
    possibleConstraints.push({ label: 'Vertical', type: ConstraintType.VERTICAL, icon: '｜' });
    possibleConstraints.push({ label: 'Length', type: ConstraintType.DISTANCE, icon: '📏', needsInput: true });
    possibleConstraints.push({ label: 'Angle', type: ConstraintType.ANGLE, icon: '∠', needsInput: true });
  } 
  // 2 Lines Selected
  else if (l.length === 2 && p.length === 0 && c.length === 0) {
    possibleConstraints.push({ label: 'Parallel', type: ConstraintType.PARALLEL, icon: '//' });
    possibleConstraints.push({ label: 'Equal Length', type: ConstraintType.EQUAL_LENGTH, icon: '=' });
    possibleConstraints.push({ label: 'Angle Between', type: ConstraintType.ANGLE, icon: '∠', needsInput: true });
    
    // Check for shared point for Fillet (Direct or via Coincident)
    const line1 = lines.find(ln => ln.id === l[0]);
    const line2 = lines.find(ln => ln.id === l[1]);
    
    if (line1 && line2 && onFillet) {
       // Check if they share a direct point
       let sharedPoint = [line1.p1, line1.p2].find(pt => pt === line2.p1 || pt === line2.p2);
       
       // If no direct point, check clusters
       if (!sharedPoint) {
           const cluster1a = getCoincidentCluster(line1.p1);
           const cluster1b = getCoincidentCluster(line1.p2);
           
           if (cluster1a.includes(line2.p1) || cluster1a.includes(line2.p2)) sharedPoint = line1.p1;
           else if (cluster1b.includes(line2.p1) || cluster1b.includes(line2.p2)) sharedPoint = line1.p2;
       }

       if (sharedPoint) {
           possibleConstraints.push({ 
             label: 'Fillet Corner', 
             type: 'FILLET', 
             icon: '╭', 
             action: () => onFillet(sharedPoint!) 
           });
       }
    }
  } 
  // 1 Circle Selected
  else if (c.length === 1 && p.length === 0 && l.length === 0) {
    possibleConstraints.push({ label: 'Radius', type: ConstraintType.RADIUS, icon: 'R', needsInput: true });
    possibleConstraints.push({ label: 'Fix Center', type: ConstraintType.FIXED, icon: '⚓' });
  }
  // 2 Circles Selected
  else if (c.length === 2 && p.length === 0 && l.length === 0) {
     possibleConstraints.push({ label: 'Tangent', type: ConstraintType.TANGENT, icon: 'T' });
     possibleConstraints.push({ label: 'Concentric', type: ConstraintType.COINCIDENT, icon: '◎' });
     possibleConstraints.push({ label: 'Distance', type: ConstraintType.DISTANCE, icon: '📏', needsInput: true });
  }
  // 1 Line + 1 Circle
  else if (l.length === 1 && c.length === 1 && p.length === 0) {
    possibleConstraints.push({ label: 'Tangent', type: ConstraintType.TANGENT, icon: 'T' });
    possibleConstraints.push({ label: 'Distance', type: ConstraintType.DISTANCE, icon: '📏', needsInput: true });
    possibleConstraints.push({ label: 'Coincident', type: ConstraintType.COINCIDENT, icon: '◎' });
  }
  // 1 Point + 1 Circle
  else if (p.length === 1 && c.length === 1 && l.length === 0) {
      possibleConstraints.push({ label: 'Point on Circle', type: ConstraintType.TANGENT, icon: '⌾' });
      possibleConstraints.push({ label: 'Center', type: ConstraintType.COINCIDENT, icon: '◎' });
  }
  // 1 Point + 1 Line
  else if (p.length === 1 && l.length === 1 && c.length === 0) {
      possibleConstraints.push({ label: 'Point on Line', type: ConstraintType.COINCIDENT, icon: '◎' });
      possibleConstraints.push({ label: 'Midpoint', type: ConstraintType.MIDPOINT, icon: '⫯' });
  }
  // 2 Points + 1 Line Selected (For Trim/Split)
  else if (p.length === 2 && l.length === 1 && c.length === 0) {
      const line = lines.find(ln => ln.id === l[0]);
      const [id1, id2] = p;
      let showTrim = false;
      if (line) {
         const onL = (pid: string) => (line.p1 === pid || line.p2 === pid) || isCoincident(pid, line.id);
         if (onL(id1) && onL(id2)) showTrim = true;
      }
      if (showTrim) {
           possibleConstraints.push({ 
             label: 'Trim Segment', 
             type: 'TRIM', 
             icon: '✂️', 
             action: () => onTrim(id1, id2)
           });
      }
      possibleConstraints.push({ label: 'Coincident', type: ConstraintType.COINCIDENT, icon: '⦿' });
      possibleConstraints.push({ label: 'Distance', type: ConstraintType.DISTANCE, icon: '📏', needsInput: true });
  }
  
  // Intersection Check
  if (l.length + c.length === 2 && p.length === 0 && onIntersect) {
      possibleConstraints.push({
          label: 'Intersect',
          type: 'INTERSECT',
          icon: '╳',
          action: onIntersect
      });
  }

  const showDelete = selectionCount > 0;
  const showConstruction = l.length > 0 || c.length > 0;

  if (possibleConstraints.length === 0 && !showDelete && !showConstruction) return null;

  return (
    <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-end gap-3 z-40 animate-in fade-in slide-in-from-right-4 duration-300 pointer-events-none">
      {possibleConstraints.map((item) => (
        <button
          key={item.label}
          onClick={(e) => { 
            e.stopPropagation(); 
            if (item.action) item.action();
            else onApplyConstraint(item.type as ConstraintType, !!item.needsInput); 
          }}
          className="group relative flex items-center justify-center pointer-events-auto"
        >
          <span className="absolute right-14 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 text-white text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border border-white/10 whitespace-nowrap shadow-xl pointer-events-none">
            {item.label}
          </span>
          <div className="w-12 h-12 rounded-full bg-[#111]/90 backdrop-blur-xl border border-white/20 flex items-center justify-center text-xl font-bold text-blue-400 hover:bg-blue-600 hover:text-white hover:scale-110 active:scale-95 transition-all shadow-2xl">
            {item.icon}
          </div>
        </button>
      ))}

      {showConstruction && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleConstruction(); }}
            className="group relative flex items-center justify-center pointer-events-auto mt-2"
          >
            <span className="absolute right-14 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900/90 text-white text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border border-gray-500/30 whitespace-nowrap shadow-xl pointer-events-none">
              Construction
            </span>
            <div className="w-12 h-12 rounded-full bg-gray-500/10 backdrop-blur-xl border border-gray-500/50 flex items-center justify-center text-xl font-bold text-gray-300 hover:bg-gray-600 hover:text-white hover:scale-110 active:scale-95 transition-all shadow-2xl">
              ╌
            </div>
          </button>
      )}

      {showDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="group relative flex items-center justify-center pointer-events-auto mt-2"
        >
          <span className="absolute right-14 opacity-0 group-hover:opacity-100 transition-opacity bg-red-900/90 text-white text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border border-red-500/30 whitespace-nowrap shadow-xl pointer-events-none">
            Delete
          </span>
          <div className="w-12 h-12 rounded-full bg-red-500/10 backdrop-blur-xl border border-red-500/50 flex items-center justify-center text-xl font-bold text-red-500 hover:bg-red-600 hover:text-white hover:scale-110 active:scale-95 transition-all shadow-2xl">
            🗑
          </div>
        </button>
      )}
    </div>
  );
};

export default FloatingConstraints;
