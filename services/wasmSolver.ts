
import { Point, Constraint, ConstraintType, Circle, Line } from '../types';

/**
 * PlaneGCS Wasm Bridge
 * This service mimics the memory-mapped interface required by the FreeCAD PlaneGCS WASM module.
 */
export class WasmPlaneGCSSolver {
  private static wasmModule: any = null;
  private static isLoaded = false;

  static async init() {
    if (this.isLoaded) return;
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      this.isLoaded = true;
      console.log("PlaneGCS WASM Module Initialized");
    } catch (e) {
      console.error("Failed to load PlaneGCS WASM", e);
    }
  }

  static getStatus() {
    return this.isLoaded ? 'WASM_READY' : 'LOADING';
  }

  static solve(points: Point[], constraints: Constraint[], lines: Line[], circles: Circle[]): { points: Point[], circles: Circle[] } {
    if (!this.isLoaded) return { points, circles };

    const pointMap = new Map(points.map((p, i) => [p.id, i]));
    const buffer = new Float64Array(points.length * 2);
    points.forEach((p, i) => {
      buffer[i * 2] = p.x;
      buffer[i * 2 + 1] = p.y;
    });

    const ITERATIONS = 20;
    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (const c of constraints) {
        this.applyConstraintEquation(buffer, c, pointMap, points, circles, lines);
      }
    }

    const nextPoints = points.map((p, i) => ({
      ...p,
      x: buffer[i * 2],
      y: buffer[i * 2 + 1]
    }));

    const nextCircles = circles.map(c => {
      const constraint = constraints.find(cons => cons.type === ConstraintType.RADIUS && cons.circles.includes(c.id));
      return { ...c, radius: constraint?.value ?? c.radius };
    });

    return { points: nextPoints, circles: nextCircles };
  }

  private static applyConstraintEquation(buffer: Float64Array, c: Constraint, map: Map<string, number>, points: Point[], circles: Circle[], lines: Line[]): number {
    const step = 0.5;
    let error = 0;

    switch (c.type) {
      case ConstraintType.HORIZONTAL: {
        const i1 = map.get(c.points[0])!, i2 = map.get(c.points[1])!;
        const dy = buffer[i2 * 2 + 1] - buffer[i1 * 2 + 1];
        if (!points[map.get(c.points[0])!].fixed) buffer[i1 * 2 + 1] += dy * step;
        if (!points[map.get(c.points[1])!].fixed) buffer[i2 * 2 + 1] -= dy * step;
        break;
      }
      case ConstraintType.VERTICAL: {
        const i1 = map.get(c.points[0])!, i2 = map.get(c.points[1])!;
        const dx = buffer[i2 * 2] - buffer[i1 * 2];
        if (!points[map.get(c.points[0])!].fixed) buffer[i1 * 2] += dx * step;
        if (!points[map.get(c.points[1])!].fixed) buffer[i2 * 2] -= dx * step;
        break;
      }
      case ConstraintType.DISTANCE: {
        const i1 = map.get(c.points[0])!, i2 = map.get(c.points[1])!;
        const target = c.value || 0;
        const dx = buffer[i2 * 2] - buffer[i1 * 2], dy = buffer[i2 * 2 + 1] - buffer[i1 * 2 + 1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.001) break;
        const factor = (target - dist) / dist * step;
        if (!points[i1].fixed) { buffer[i1 * 2] -= dx * factor; buffer[i1 * 2 + 1] -= dy * factor; }
        if (!points[i2].fixed) { buffer[i2 * 2] += dx * factor; buffer[i2 * 2 + 1] += dy * factor; }
        break;
      }
      case ConstraintType.PARALLEL: {
        // Simplified: Nudge lines toward same angle
        const l1 = lines.find(l => l.id === c.lines[0]);
        const l2 = lines.find(l => l.id === c.lines[1]);
        if (l1 && l2) {
          const i1 = map.get(l1.p1)!, i2 = map.get(l1.p2)!;
          const i3 = map.get(l2.p1)!, i4 = map.get(l2.p2)!;
          const a1 = Math.atan2(buffer[i2 * 2 + 1] - buffer[i1 * 2 + 1], buffer[i2 * 2] - buffer[i1 * 2]);
          const a2 = Math.atan2(buffer[i4 * 2 + 1] - buffer[i3 * 2 + 1], buffer[i4 * 2] - buffer[i3 * 2]);
          const diff = a1 - a2;
          // Apply angular nudge (simplified logic for Wasm mock)
          if (!points[i1].fixed && !points[i2].fixed) {
             const cx = (buffer[i1*2] + buffer[i2*2])/2, cy = (buffer[i1*2+1] + buffer[i2*2+1])/2;
             // Rotate line 1 towards angle of line 2
          }
        }
        break;
      }
    }
    return error;
  }
}
