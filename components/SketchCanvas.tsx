
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { SketchState, Point, Line, Circle, ConstraintType } from '../types';

interface SketchCanvasProps {
  state: SketchState;
  onUpdatePoint: (id: string, x: number, y: number) => void;
  onUpdateCircleRadius?: (id: string, radius: number) => void;
  onAddPoint: (x: number, y: number) => void;
  onAddLine: (x1: number, y1: number, x2: number, y2: number, p1SnapId?: string, p2SnapId?: string) => void;
  onAddCircle: (centerX: number, centerY: number, radius: number, centerSnapId?: string) => void;
  onAddRectangle: (x1: number, y1: number, x2: number, y2: number, p1SnapId?: string) => void;
  onAddArc?: (centerX: number, centerY: number, startX: number, startY: number, endX: number, endY: number, centerSnapId?: string, startSnapId?: string, endSnapId?: string) => void;
  onSelectElements: (selection: { points?: string[], lines?: string[], circles?: string[] }, mode: 'TOGGLE' | 'UNION') => void;
  onClearSelection: () => void;
  onInteractionStart?: () => void;
}

const GRID_SIZE = 50;
const SNAP_THRESHOLD = 30; // Screen pixels

// Utility to check if line segment intersects a box
const segmentIntersectsBox = (p1: {x:number, y:number}, p2: {x:number, y:number}, minX: number, minY: number, maxX: number, maxY: number) => {
  // 1. Trivial Rejection
  if (Math.max(p1.x, p2.x) < minX || Math.min(p1.x, p2.x) > maxX || Math.max(p1.y, p2.y) < minY || Math.min(p1.y, p2.y) > maxY) return false;
  
  // 2. Trivial Acceptance (One point inside)
  if ((p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY) || (p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY)) return true;

  // 3. Line Intersection
  const sides = [
      [{x: minX, y: minY}, {x: maxX, y: minY}], // Top
      [{x: maxX, y: minY}, {x: maxX, y: maxY}], // Right
      [{x: maxX, y: maxY}, {x: minX, y: maxY}], // Bottom
      [{x: minX, y: maxY}, {x: minX, y: minY}]  // Left
  ];

  const segmentsIntersect = (a: {x:number,y:number}, b: {x:number,y:number}, c: {x:number,y:number}, d: {x:number,y:number}) => {
      const det = (b.x - a.x) * (d.y - c.y) - (d.x - c.x) * (b.y - a.y);
      if (det === 0) return false;
      const lambda = ((d.y - c.y) * (d.x - a.x) + (c.x - d.x) * (d.y - a.y)) / det;
      const gamma = ((a.y - b.y) * (d.x - a.x) + (b.x - a.x) * (d.y - a.y)) / det;
      return (0 <= lambda && lambda <= 1) && (0 <= gamma && gamma <= 1);
  };

  return sides.some(side => segmentsIntersect(p1, p2, side[0], side[1]));
};

const SketchCanvas: React.FC<SketchCanvasProps> = ({ 
  state, onUpdatePoint, onUpdateCircleRadius, onAddPoint, onAddLine, onAddCircle, onAddRectangle, onAddArc,
  onSelectElements, onClearSelection,
  onInteractionStart
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [draggingPointId, setDraggingPointId] = useState<string | null>(null);
  const [draggingCircleRadiusId, setDraggingCircleRadiusId] = useState<string | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ start: {x:number, y:number}, end: {x:number, y:number} } | null>(null);
  const [hasCentered, setHasCentered] = useState(false);
  
  // Interaction State
  const [interactionStart, setInteractionStart] = useState<{ x: number, y: number, snapId?: string } | null>(null);
  const [interactionSecond, setInteractionSecond] = useState<{ x: number, y: number, snapId?: string } | null>(null); // For 3-point tools like Arc
  
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  
  const activePointers = useRef<Map<number, { x: number, y: number }>>(new Map());

  const fitView = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas || !canvas.parentElement) return;

      const width = canvas.parentElement.clientWidth;
      const height = canvas.parentElement.clientHeight;
      
      canvas.width = width;
      canvas.height = height;

      if (state.points.length > 0) {
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          
          state.points.forEach(p => {
              if (p.x < minX) minX = p.x;
              if (p.x > maxX) maxX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.y > maxY) maxY = p.y;
          });

          // Include circles in bounds
          state.circles.forEach(c => {
             const p = state.points.find(pt => pt.id === c.center);
             if (p) {
                 minX = Math.min(minX, p.x - c.radius);
                 maxX = Math.max(maxX, p.x + c.radius);
                 minY = Math.min(minY, p.y - c.radius);
                 maxY = Math.max(maxY, p.y + c.radius);
             }
          });

           // Include arcs in bounds
           state.arcs?.forEach(a => {
             const p = state.points.find(pt => pt.id === a.center);
             if (p) {
                 minX = Math.min(minX, p.x - a.radius);
                 maxX = Math.max(maxX, p.x + a.radius);
                 minY = Math.min(minY, p.y - a.radius);
                 maxY = Math.max(maxY, p.y + a.radius);
             }
          });

          const padding = 80;
          const w = maxX - minX;
          const h = maxY - minY;

          if (w > 0 && h > 0) {
              const scaleX = (width - padding * 2) / w;
              const scaleY = (height - padding * 2) / h;
              // Fit within screen, but don't zoom out too far or in too close
              const fitZoom = Math.min(scaleX, scaleY);
              const finalZoom = Math.min(Math.max(fitZoom, 0.2), 2.0);

              const midX = (minX + maxX) / 2;
              const midY = (minY + maxY) / 2;
              
              const offX = width / 2 - midX * finalZoom;
              const offY = height / 2 - midY * finalZoom;
              
              setZoom(finalZoom);
              setOffset({ x: offX, y: offY });
          } else {
               // Points exist but negligible size
               const midX = minX !== Infinity ? minX : 0;
               const midY = minY !== Infinity ? minY : 0;
               setZoom(1);
               setOffset({ x: width / 2 - midX, y: height / 2 - midY });
          }
      } else {
          // Empty sketch: Center Origin (0,0) on screen
          setZoom(1);
          setOffset({ x: width / 2, y: height / 2 });
      }
  }, [state.points, state.circles, state.arcs]);

  // Auto-center on mount
  useEffect(() => {
      if (hasCentered) return;
      fitView();
      setHasCentered(true);
  }, [hasCentered, fitView]);


  const toWorld = (screenX: number, screenY: number) => ({
    x: (screenX - offset.x) / zoom,
    y: (screenY - offset.y) / zoom
  });

  const toScreen = (worldX: number, worldY: number) => ({
    x: worldX * zoom + offset.x,
    y: worldY * zoom + offset.y
  });

  const getDist = (p1: {x:number,y:number}, p2: {x:number,y:number}) => Math.sqrt((p1.x-p2.x)**2 + (p1.y-p2.y)**2);

  const findNearbyPoint = (worldX: number, worldY: number) => {
    const threshold = SNAP_THRESHOLD / zoom;
    return state.points.find(p => getDist(p, { x: worldX, y: worldY }) < threshold);
  };

  const findNearbyLine = (worldX: number, worldY: number) => {
    const threshold = SNAP_THRESHOLD / zoom;
    return state.lines.find(line => {
      const p1 = state.points.find(p => p.id === line.p1);
      const p2 = state.points.find(p => p.id === line.p2);
      if (!p1 || !p2) return false;
      const l2 = getDist(p1, p2)**2;
      if (l2 === 0) return false;
      let t = ((worldX - p1.x) * (p2.x - p1.x) + (worldY - p1.y) * (p2.y - p1.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      const dist = getDist({x: worldX, y: worldY}, {x: p1.x + t*(p2.x-p1.x), y: p1.y + t*(p2.y-p1.y)});
      return dist < threshold;
    });
  };

  const findNearbyCircle = (worldX: number, worldY: number) => {
    const threshold = SNAP_THRESHOLD / zoom;
    // Check Circles
    const circle = state.circles.find(circle => {
      const center = state.points.find(p => p.id === circle.center);
      if (!center) return false;
      const distToCenter = getDist({ x: worldX, y: worldY }, center);
      return Math.abs(distToCenter - circle.radius) < threshold;
    });
    if (circle) return circle;

    // Check Arcs
    const arc = state.arcs.find(a => {
        const center = state.points.find(p => p.id === a.center);
        const p1 = state.points.find(p => p.id === a.p1);
        const p2 = state.points.find(p => p.id === a.p2);
        if (!center || !p1 || !p2) return false;
        
        const distToCenter = getDist({ x: worldX, y: worldY }, center);
        if (Math.abs(distToCenter - a.radius) > threshold) return false;

        // Check if within angles
        const angle = Math.atan2(worldY - center.y, worldX - center.x);
        const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
        const a2 = Math.atan2(p2.y - center.y, p2.x - center.x);
        
        let diff = a2 - a1;
        while (diff <= -Math.PI) diff += 2 * Math.PI;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        
        let dTarget = angle - a1;
        while (dTarget <= -Math.PI) dTarget += 2 * Math.PI;
        while (dTarget > Math.PI) dTarget -= 2 * Math.PI;

        if (diff > 0) {
            return dTarget >= 0 && dTarget <= diff;
        } else {
            return dTarget <= 0 && dTarget >= diff;
        }
    });
    return arc;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleResize = () => {
      canvas.width = canvas.parentElement?.clientWidth || 0;
      canvas.height = canvas.parentElement?.clientHeight || 0;
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const drawBadge = (x: number, y: number, text: string, isSelected: boolean) => {
      const padding = 6;
      ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      const textMetrics = ctx.measureText(text);
      const width = textMetrics.width + padding * 2;
      const height = 18;

      ctx.fillStyle = isSelected ? '#3b82f6' : 'rgba(30, 30, 30, 0.85)';
      ctx.strokeStyle = isSelected ? '#fff' : '#ef4444';
      ctx.lineWidth = 1;
      
      const rx = x - width / 2;
      const ry = y - height / 2;

      ctx.beginPath();
      ctx.roundRect(rx, ry, width, height, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isSelected ? '#fff' : '#ef4444';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y);
    };

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw Grid
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      const startX = Math.floor((-offset.x / zoom) / GRID_SIZE) * GRID_SIZE;
      const startY = Math.floor((-offset.y / zoom) / GRID_SIZE) * GRID_SIZE;
      for (let x = startX; x < startX + canvas.width/zoom + GRID_SIZE*2; x += GRID_SIZE) {
        const s = toScreen(x, 0); ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, canvas.height); ctx.stroke();
      }
      for (let y = startY; y < startY + canvas.height/zoom + GRID_SIZE*2; y += GRID_SIZE) {
        const s = toScreen(0, y); ctx.beginPath(); ctx.moveTo(0, s.y); ctx.lineTo(canvas.width, s.y); ctx.stroke();
      }

      // Draw Lines
      state.lines.forEach(line => {
        const p1 = state.points.find(p => p.id === line.p1);
        const p2 = state.points.find(p => p.id === line.p2);
        if (p1 && p2) {
          const s1 = toScreen(p1.x, p1.y), s2 = toScreen(p2.x, p2.y);
          ctx.beginPath();
          const isSelected = state.selectedLineIds.includes(line.id);
          
          if (line.construction) {
            ctx.strokeStyle = isSelected ? '#60a5fa' : '#888'; 
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = isSelected ? 2 : 1;
          } else {
            ctx.strokeStyle = isSelected ? '#3b82f6' : '#fff';
            ctx.setLineDash([]);
            ctx.lineWidth = isSelected ? 4 : 2;
          }
          
          ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
          ctx.setLineDash([]); // Reset
        }
      });

      // Draw Circles
      state.circles.forEach(circle => {
        const center = state.points.find(p => p.id === circle.center);
        if (center) {
          const s = toScreen(center.x, center.y);
          ctx.beginPath();
          const isSelected = state.selectedCircleIds.includes(circle.id);
          
          if (circle.construction) {
            ctx.strokeStyle = isSelected ? '#60a5fa' : '#888'; 
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = isSelected ? 2 : 1;
          } else {
            ctx.strokeStyle = isSelected ? '#3b82f6' : '#fff';
            ctx.setLineDash([]);
            ctx.lineWidth = isSelected ? 4 : 2;
          }

          ctx.arc(s.x, s.y, circle.radius * zoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });

      // Draw Arcs
      state.arcs.forEach(arc => {
        const center = state.points.find(p => p.id === arc.center);
        const p1 = state.points.find(p => p.id === arc.p1);
        const p2 = state.points.find(p => p.id === arc.p2);

        if (center && p1 && p2) {
          const s = toScreen(center.x, center.y);
          const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
          const endAngle = Math.atan2(p2.y - center.y, p2.x - center.x);
          
          ctx.beginPath();
          const isSelected = state.selectedCircleIds.includes(arc.id); 
          
          if (arc.construction) {
            ctx.strokeStyle = isSelected ? '#60a5fa' : '#888';
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = isSelected ? 2 : 1;
          } else {
            ctx.strokeStyle = isSelected ? '#3b82f6' : '#fff';
            ctx.setLineDash([]);
            ctx.lineWidth = isSelected ? 4 : 2;
          }

          // Draw Arc: Always choose the shortest path (< 180 degrees)
          let diff = endAngle - startAngle;
          while (diff <= -Math.PI) diff += 2 * Math.PI;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          const anticlockwise = diff < 0;

          ctx.arc(s.x, s.y, arc.radius * zoom, startAngle, endAngle, anticlockwise);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });

      // Draw Constraint Badges
      state.constraints.forEach(c => {
        const isSelected = state.selectedConstraintIds.includes(c.id);
        if (c.points.length === 2 && (c.type === ConstraintType.HORIZONTAL || c.type === ConstraintType.VERTICAL || c.type === ConstraintType.DISTANCE)) {
           const p1 = state.points.find(p => p.id === c.points[0]), p2 = state.points.find(p => p.id === c.points[1]);
           if (p1 && p2) {
             const s = toScreen((p1.x + p2.x)/2, (p1.y + p2.y)/2);
             let label = c.type === ConstraintType.HORIZONTAL ? 'H' : c.type === ConstraintType.VERTICAL ? 'V' : `${Math.round(c.value || 0)}`;
             drawBadge(s.x, s.y - (c.type === ConstraintType.DISTANCE ? 12 : 0), label, isSelected);
           }
        }
      });

      // Draw Selection Box
      if (selectionBox) {
        const s = toScreen(selectionBox.start.x, selectionBox.start.y);
        const e = toScreen(selectionBox.end.x, selectionBox.end.y);
        const isCrossing = selectionBox.end.x < selectionBox.start.x;

        ctx.fillStyle = isCrossing ? 'rgba(34, 197, 94, 0.15)' : 'rgba(59, 130, 246, 0.15)'; 
        ctx.strokeStyle = isCrossing ? '#22c55e' : '#3b82f6';
        ctx.setLineDash(isCrossing ? [6, 4] : []);
        ctx.lineWidth = 1;
        
        const x = Math.min(s.x, e.x);
        const y = Math.min(s.y, e.y);
        const w = Math.abs(e.x - s.x);
        const h = Math.abs(e.y - s.y);
        
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }

      // Drawing Tool Preview
      if (interactionStart) {
        const s1 = toScreen(interactionStart.x, interactionStart.y);
        const nearPt = findNearbyPoint(mousePos.x, mousePos.y);
        const currentPos = nearPt ? { x: nearPt.x, y: nearPt.y } : mousePos;
        const s2 = toScreen(currentPos.x, currentPos.y);
        
        ctx.beginPath();
        ctx.fillStyle = '#3b82f6'; 
        ctx.arc(s1.x, s1.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        
        if (state.tool === 'LINE') { ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); }
        else if (state.tool === 'RECTANGLE') { ctx.strokeRect(s1.x, s1.y, s2.x - s1.x, s2.y - s1.y); }
        else if (state.tool === 'CIRCLE') { ctx.arc(s1.x, s1.y, getDist(interactionStart, currentPos) * zoom, 0, Math.PI * 2); }
        else if (state.tool === 'ARC') {
            if (!interactionSecond) {
                // Drawing P1 (Radius preview)
                ctx.strokeStyle = '#888';
                ctx.setLineDash([5, 5]);
                ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.arc(s1.x, s1.y, getDist(interactionStart, currentPos) * zoom, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.4)';
                ctx.stroke();
            } else {
                // Drawing P2 (Arc preview)
                const sSecond = toScreen(interactionSecond.x, interactionSecond.y);
                const radius = getDist(interactionStart, interactionSecond) * zoom;
                const startAngle = Math.atan2(sSecond.y - s1.y, sSecond.x - s1.x);
                const endAngle = Math.atan2(s2.y - s1.y, s2.x - s1.x);
                
                // Draw radius lines
                ctx.beginPath();
                ctx.moveTo(s1.x, s1.y); ctx.lineTo(sSecond.x, sSecond.y);
                ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y);
                ctx.strokeStyle = '#888';
                ctx.setLineDash([5, 5]);
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw Arc Preview - also shortest path
                let diff = endAngle - startAngle;
                while (diff <= -Math.PI) diff += 2 * Math.PI;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                const anticlockwise = diff < 0;

                ctx.beginPath();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.arc(s1.x, s1.y, radius, startAngle, endAngle, anticlockwise);
                ctx.stroke();
            }
        }
        ctx.stroke();
      }

      // Draw Points
      state.points.forEach(p => {
        const s = toScreen(p.x, p.y);
        const isSelected = state.selectedPointIds.includes(p.id);
        const isFixed = state.constraints.some(c => c.type === ConstraintType.FIXED && c.points.includes(p.id)) || p.fixed;
        
        ctx.beginPath();
        ctx.fillStyle = isSelected ? '#3b82f6' : (p.fixed ? '#555' : '#9ca3af');
        ctx.arc(s.x, s.y, isSelected ? 7 : (p.fixed ? 3 : 4), 0, Math.PI * 2); ctx.fill();
        if (isSelected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
        
        if (isFixed) { 
            ctx.strokeStyle = '#ef4444'; 
            ctx.lineWidth = 1.5; 
            if (isSelected) ctx.strokeRect(s.x-7, s.y-7, 14, 14); 
        }
      });

      requestAnimationFrame(render);
    };

    const animId = requestAnimationFrame(render);
    return () => { window.removeEventListener('resize', handleResize); cancelAnimationFrame(animId); };
  }, [state, offset, zoom, interactionStart, interactionSecond, mousePos, selectionBox]);

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    activePointers.current.set(e.pointerId, { x, y });
    const world = toWorld(x, y);

    if (activePointers.current.size === 2) {
      setSelectionBox(null); setInteractionStart(null); setInteractionSecond(null); setDraggingPointId(null); setDraggingCircleRadiusId(null);
      return;
    }

    if (state.tool === 'PAN') { setIsPanning(true); return; }

    if (state.tool === 'SELECT') {
      const nearPt = findNearbyPoint(world.x, world.y);
      const nearLn = findNearbyLine(world.x, world.y);
      const nearCr = findNearbyCircle(world.x, world.y);

      if (nearPt) { 
        onInteractionStart?.(); onSelectElements({ points: [nearPt.id] }, 'TOGGLE'); setDraggingPointId(nearPt.id); 
      } else if (nearCr) {
        onSelectElements({ circles: [nearCr.id] }, 'TOGGLE');
        setDraggingCircleRadiusId(nearCr.id);
      } else if (nearLn) { 
        onSelectElements({ lines: [nearLn.id] }, 'TOGGLE'); 
      } else {
        setSelectionBox({ start: world, end: world });
      }
    } else {
      const nearPt = findNearbyPoint(world.x, world.y);
      const finalWorld = nearPt ? { x: nearPt.x, y: nearPt.y } : world;
      if (state.tool === 'POINT') { onAddPoint(world.x, world.y); }
      else if (['LINE', 'RECTANGLE', 'CIRCLE'].includes(state.tool)) {
        if (interactionStart) {
          if (state.tool === 'LINE') onAddLine(interactionStart.x, interactionStart.y, finalWorld.x, finalWorld.y, interactionStart.snapId, nearPt?.id);
          else if (state.tool === 'RECTANGLE') onAddRectangle(interactionStart.x, interactionStart.y, finalWorld.x, finalWorld.y, interactionStart.snapId);
          else if (state.tool === 'CIRCLE') onAddCircle(interactionStart.x, interactionStart.y, getDist(interactionStart, finalWorld), interactionStart.snapId);
          setInteractionStart(null);
        } else { setInteractionStart({ ...finalWorld, snapId: nearPt?.id }); }
      } else if (state.tool === 'ARC') {
          if (!interactionStart) {
              // Set Center
              setInteractionStart({ ...finalWorld, snapId: nearPt?.id });
          } else if (!interactionSecond) {
              // Set Start Point
              setInteractionSecond({ ...finalWorld, snapId: nearPt?.id });
          } else {
              // Set End Point and Finish
              if (onAddArc) {
                  onAddArc(
                      interactionStart.x, interactionStart.y, 
                      interactionSecond.x, interactionSecond.y, 
                      finalWorld.x, finalWorld.y,
                      interactionStart.snapId, interactionSecond.snapId, nearPt?.id
                  );
              }
              setInteractionStart(null);
              setInteractionSecond(null);
          }
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const prevPos = activePointers.current.get(e.pointerId);
    activePointers.current.set(e.pointerId, { x, y });
    const world = toWorld(x, y);
    setMousePos(world);

    if (activePointers.current.size === 2) {
      const ids = Array.from(activePointers.current.keys());
      const otherId = ids.find(id => id !== e.pointerId);
      if (otherId !== undefined && prevPos) {
        const otherPos = activePointers.current.get(otherId)!;
        const oldDist = Math.hypot(prevPos.x - otherPos.x, prevPos.y - otherPos.y);
        const newDist = Math.hypot(x - otherPos.x, y - otherPos.y);
        if (oldDist > 5 && newDist > 5) {
          const zoomFactor = newDist / oldDist;
          const oldMidX = (prevPos.x + otherPos.x) / 2;
          const oldMidY = (prevPos.y + otherPos.y) / 2;
          const newMidX = (x + otherPos.x) / 2;
          const newMidY = (y + otherPos.y) / 2;
          setZoom(prevZoom => {
             const nextZoom = Math.max(0.1, Math.min(50, prevZoom * zoomFactor));
             setOffset(prevOffset => {
                const wx = (oldMidX - prevOffset.x) / prevZoom;
                const wy = (oldMidY - prevOffset.y) / prevZoom;
                const newOx = newMidX - wx * nextZoom;
                const newOy = newMidY - wy * nextZoom;
                return { x: newOx, y: newOy };
             });
             return nextZoom;
          });
        }
      }
      return;
    }

    if (isPanning && prevPos && activePointers.current.size === 1) {
      setOffset(o => ({ x: o.x + (x - prevPos.x), y: o.y + (y - prevPos.y) }));
    } else if (draggingPointId) {
      onUpdatePoint(draggingPointId, world.x, world.y);
    } else if (draggingCircleRadiusId && onUpdateCircleRadius) {
      const circle = state.circles.find(c => c.id === draggingCircleRadiusId);
      const arc = state.arcs.find(a => a.id === draggingCircleRadiusId);
      
      const entity = circle || arc;
      const center = entity ? state.points.find(p => p.id === entity.center) : null;
      if (center) {
        const newRadius = getDist(center, world);
        onUpdateCircleRadius(draggingCircleRadiusId, newRadius);
      }
    } else if (selectionBox) {
      setSelectionBox(prev => prev ? { ...prev, end: world } : null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (selectionBox) {
      const x1 = Math.min(selectionBox.start.x, selectionBox.end.x);
      const x2 = Math.max(selectionBox.start.x, selectionBox.end.x);
      const y1 = Math.min(selectionBox.start.y, selectionBox.end.y);
      const y2 = Math.max(selectionBox.start.y, selectionBox.end.y);
      const width = x2 - x1, height = y2 - y1;
      const isCrossing = selectionBox.end.x < selectionBox.start.x;
      
      if (width < 0.5 && height < 0.5) {
        onClearSelection();
      } else {
        const pts = state.points.filter(p => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2).map(p => p.id);
        const lns = state.lines.filter(l => {
          const p1 = state.points.find(p => p.id === l.p1);
          const p2 = state.points.find(p => p.id === l.p2);
          if (!p1 || !p2) return false;
          if (isCrossing) {
             return segmentIntersectsBox(p1, p2, x1, y1, x2, y2);
          } else {
             return p1.x >= x1 && p1.x <= x2 && p1.y >= y1 && p1.y <= y2 && p2.x >= x1 && p2.x <= x2 && p2.y >= y1 && p2.y <= y2;
          }
        }).map(l => l.id);
        const crs = state.circles.filter(c => {
          const center = state.points.find(p => p.id === c.center);
          if (!center) return false;
          if (isCrossing) {
             const closeX = Math.max(x1, Math.min(center.x, x2));
             const closeY = Math.max(y1, Math.min(center.y, y2));
             const dx = center.x - closeX;
             const dy = center.y - closeY;
             return (dx*dx + dy*dy) <= (c.radius * c.radius);
          } else {
             return center.x >= x1 && center.x <= x2 && center.y >= y1 && center.y <= y2;
          }
        }).map(c => c.id);
        
        const ars = state.arcs.filter(a => {
            const center = state.points.find(p => p.id === a.center);
            if (!center) return false;
            return center.x >= x1 && center.x <= x2 && center.y >= y1 && center.y <= y2;
        }).map(a => a.id);

        onSelectElements({ points: pts, lines: lns, circles: [...crs, ...ars] }, 'UNION');
      }
      setSelectionBox(null);
    }
    activePointers.current.delete(e.pointerId);
    setIsPanning(false); setDraggingPointId(null); setDraggingCircleRadiusId(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(prevZoom => {
      const nextZoom = Math.max(0.1, Math.min(50, prevZoom * zoomFactor));
      setOffset(prevOffset => {
        const wx = (mx - prevOffset.x) / prevZoom;
        const wy = (my - prevOffset.y) / prevZoom;
        return { x: mx - wx * nextZoom, y: my - wy * nextZoom };
      });
      return nextZoom;
    });
  };

  return (
    <div className="w-full h-full relative overflow-hidden">
      <div className="absolute top-4 right-4 z-10">
         <button onClick={fitView} className="bg-[#1a1a1a]/90 border border-white/10 text-white px-3 py-2 rounded-xl text-xs font-bold uppercase hover:bg-white/10 shadow-lg" title="Recenter View">
            ⛶
         </button>
      </div>
      <canvas 
        ref={canvasRef} 
        onPointerDown={handlePointerDown} 
        onPointerMove={handlePointerMove} 
        onPointerUp={handlePointerUp} 
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={e => e.preventDefault()} 
        className="w-full h-full touch-none" 
      />
    </div>
  );
};

export default SketchCanvas;
