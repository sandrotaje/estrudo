
import { Point, Constraint, ConstraintType, Circle, Line } from '../types';

/**
 * Enhanced Geometric Constraint Solver (GCS).
 * Uses a Damped Gauss-Newton method for solving the non-linear system.
 * Now supports solving for Radii as variables.
 */
export class ConstraintSolver {
  private static MAX_ITERATIONS = 50; 
  private static CONVERGENCE_THRESHOLD = 0.0001;
  private static LAMBDA = 0.01; // Levenberg-Marquardt damping
  private static ANGLE_STIFFNESS = 100.0; 

  static solve(points: Point[], constraints: Constraint[], lines: Line[], circles: Circle[]): { points: Point[], circles: Circle[] } {
    if (constraints.length === 0) return { points, circles };

    // Mark points as fixed if they are constrained by FIXED type
    const effectivePoints = points.map(p => {
        const isFixedConstraint = constraints.some(c => c.type === ConstraintType.FIXED && c.points.includes(p.id));
        if (isFixedConstraint) {
            return { ...p, fixed: true };
        }
        return p;
    });

    const numPoints = effectivePoints.length;
    const numCircles = circles.length;
    
    // System Variables X: [x0, y0, x1, y1, ..., r0, r1, ...]
    const X = new Float64Array(numPoints * 2 + numCircles);
    
    // Initialize X
    for (let i = 0; i < numPoints; i++) {
      X[i * 2] = effectivePoints[i].x;
      X[i * 2 + 1] = effectivePoints[i].y;
    }
    for (let i = 0; i < numCircles; i++) {
      X[numPoints * 2 + i] = circles[i].radius;
    }

    for (let iter = 0; iter < this.MAX_ITERATIONS; iter++) {
      const R = this.calculateResiduals(X, constraints, effectivePoints, circles, lines);
      const totalError = R.reduce((sum, r) => sum + r * r, 0);

      if (Math.sqrt(totalError) < this.CONVERGENCE_THRESHOLD) break;

      const J = this.calculateJacobian(X, constraints, effectivePoints, circles, lines);
      const deltaX = this.solveGaussNewton(J, R, X, effectivePoints);

      let hasNaN = false;
      for (let i = 0; i < X.length; i++) {
        if (isNaN(deltaX[i])) {
            hasNaN = true;
            break;
        }
        X[i] += deltaX[i];
      }
      if (hasNaN) break; // Divergence check
      
      // Enforce positive radii
      for (let i = 0; i < numCircles; i++) {
          if (X[numPoints * 2 + i] < 0.1) X[numPoints * 2 + i] = 0.1;
      }
    }

    const nextPoints = points.map((p, i) => ({
      ...p,
      x: isNaN(X[i * 2]) ? p.x : X[i * 2],
      y: isNaN(X[i * 2 + 1]) ? p.y : X[i * 2 + 1]
    }));

    const nextCircles = circles.map((c, i) => ({
      ...c,
      radius: isNaN(X[numPoints * 2 + i]) ? c.radius : X[numPoints * 2 + i]
    }));

    return { points: nextPoints, circles: nextCircles };
  }

  private static calculateResiduals(X: Float64Array, constraints: Constraint[], points: Point[], circles: Circle[], lines: Line[]): number[] {
    const residuals: number[] = [];
    const pointMap = new Map(points.map((p, i) => [p.id, i]));
    const circleMap = new Map(circles.map((c, i) => [c.id, i]));
    
    const numPoints = points.length;
    const getR = (id: string) => {
        const idx = circleMap.get(id);
        return idx !== undefined ? X[numPoints * 2 + idx] : 10;
    };

    for (const c of constraints) {
      switch (c.type) {
        case ConstraintType.HORIZONTAL: {
          const i1 = pointMap.get(c.points[0]), i2 = pointMap.get(c.points[1]);
          if (i1 !== undefined && i2 !== undefined) {
             residuals.push(X[i2 * 2 + 1] - X[i1 * 2 + 1]);
          }
          break;
        }
        case ConstraintType.VERTICAL: {
          const i1 = pointMap.get(c.points[0]), i2 = pointMap.get(c.points[1]);
          if (i1 !== undefined && i2 !== undefined) {
             residuals.push(X[i2 * 2] - X[i1 * 2]);
          }
          break;
        }
        case ConstraintType.MIDPOINT: {
          // Point - Line
          if (c.points.length === 1 && c.lines.length === 1) {
             const line = lines.find(l => l.id === c.lines[0]);
             if (line) {
                 const ip = pointMap.get(c.points[0]);
                 const i1 = pointMap.get(line.p1);
                 const i2 = pointMap.get(line.p2);
                 if (ip !== undefined && i1 !== undefined && i2 !== undefined) {
                     // Midpoint M = (P1 + P2) / 2
                     const mx = (X[i1 * 2] + X[i2 * 2]) / 2;
                     const my = (X[i1 * 2 + 1] + X[i2 * 2 + 1]) / 2;
                     
                     // Residual = P - M
                     residuals.push(X[ip * 2] - mx);
                     residuals.push(X[ip * 2 + 1] - my);
                 }
             }
          }
          break;
        }
        case ConstraintType.DISTANCE: {
          // Case 1: Line - Circle
          if (c.lines.length === 1 && c.circles.length === 1) {
             const line = lines.find(l => l.id === c.lines[0]);
             const circle = circles.find(cir => cir.id === c.circles[0]);
             if (line && circle) {
               const i1 = pointMap.get(line.p1), i2 = pointMap.get(line.p2);
               const ic = pointMap.get(circle.center);
               
               if (i1 !== undefined && i2 !== undefined && ic !== undefined) {
                   const x1 = X[i1*2], y1 = X[i1*2+1];
                   const x2 = X[i2*2], y2 = X[i2*2+1];
                   const xc = X[ic*2], yc = X[ic*2+1];
                   const r = getR(circle.id);
                   
                   const dx = x2 - x1, dy = y2 - y1;
                   const l_squared = dx*dx + dy*dy;
                   if (l_squared > 1e-9) {
                     const distToCenter = Math.abs(dy*xc - dx*yc + x2*y1 - y2*x1) / Math.sqrt(l_squared);
                     residuals.push((distToCenter - r) - (c.value || 0));
                   } else {
                     residuals.push(0);
                   }
               }
             }
          } 
          // Case 2: Circle - Circle
          else if (c.circles.length === 2) {
             const c1 = circles.find(cir => cir.id === c.circles[0]);
             const c2 = circles.find(cir => cir.id === c.circles[1]);
             if (c1 && c2) {
                 const i1 = pointMap.get(c1.center), i2 = pointMap.get(c2.center);
                 if (i1 !== undefined && i2 !== undefined) {
                     const dx = X[i2 * 2] - X[i1 * 2];
                     const dy = X[i2 * 2 + 1] - X[i1 * 2 + 1];
                     const distCenters = Math.sqrt(dx * dx + dy * dy);
                     
                     const r1 = getR(c1.id);
                     const r2 = getR(c2.id);
                     const val = c.value || 0;

                     // Internal Check: If gap between centers is significantly smaller than radius sum, check if it's nested
                     // Heuristic: If they are closer to being nested than external, enforce Concentric + Radial Gap
                     
                     const rDiff = Math.abs(r1 - r2);
                     const rSum = r1 + r2;
                     
                     const errExternal = Math.abs((distCenters - rSum) - val); // External touching
                     const errInternal = Math.abs((rDiff - distCenters) - val); // Internal nested

                     // Note: We use the current state to determine intent.
                     // If user wants internal distance (concentric offset), errInternal will be smaller or they are already nested.
                     
                     if (errInternal < errExternal) {
                         // INTERNAL MODE: Enforce Concentricity + Radius Difference
                         // 3 Residuals: X-align, Y-align, Radius-Gap
                         residuals.push(dx); // Force Center X coincident
                         residuals.push(dy); // Force Center Y coincident
                         residuals.push(rDiff - val); // Force Radius Difference to match Value
                     } else {
                         // EXTERNAL MODE: Minimum Distance
                         residuals.push(distCenters - rSum - val);
                     }
                 }
             }
          }
          // Case 3: Point - Point
          else if (c.points.length >= 2) {
             const i1 = pointMap.get(c.points[0]), i2 = pointMap.get(c.points[1]);
             if (i1 !== undefined && i2 !== undefined) {
                 const dx = X[i2 * 2] - X[i1 * 2];
                 const dy = X[i2 * 2 + 1] - X[i1 * 2 + 1];
                 const dist = Math.sqrt(dx * dx + dy * dy);
                 residuals.push(dist - (c.value || 0));
             }
          }
          break;
        }
        case ConstraintType.EQUAL_LENGTH: {
          const l1 = lines.find(l => l.id === c.lines[0]);
          const l2 = lines.find(l => l.id === c.lines[1]);
          if (l1 && l2) {
            const i1 = pointMap.get(l1.p1), i2 = pointMap.get(l1.p2);
            const i3 = pointMap.get(l2.p1), i4 = pointMap.get(l2.p2);
            if (i1 !== undefined && i2 !== undefined && i3 !== undefined && i4 !== undefined) {
                const len1 = Math.sqrt(Math.pow(X[i2 * 2] - X[i1 * 2], 2) + Math.pow(X[i2 * 2 + 1] - X[i1 * 2 + 1], 2));
                const len2 = Math.sqrt(Math.pow(X[i4 * 2] - X[i3 * 2], 2) + Math.pow(X[i4 * 2 + 1] - X[i3 * 2 + 1], 2));
                residuals.push(len1 - len2);
            }
          }
          break;
        }
        case ConstraintType.COINCIDENT: {
          // Case 1: Point - Point
          if (c.points.length === 2) {
            const i1 = pointMap.get(c.points[0]), i2 = pointMap.get(c.points[1]);
            if (i1 !== undefined && i2 !== undefined) {
                residuals.push(X[i2 * 2] - X[i1 * 2]);
                residuals.push(X[i2 * 2 + 1] - X[i1 * 2 + 1]);
            }
          }
          // Case 2: Point - Line (Point on Line)
          else if (c.points.length === 1 && c.lines.length === 1) {
             const line = lines.find(l => l.id === c.lines[0]);
             if (line) {
                 const ip = pointMap.get(c.points[0]);
                 const i1 = pointMap.get(line.p1);
                 const i2 = pointMap.get(line.p2);
                 if (ip !== undefined && i1 !== undefined && i2 !== undefined) {
                     const x = X[ip*2], y = X[ip*2+1];
                     const x1 = X[i1*2], y1 = X[i1*2+1];
                     const x2 = X[i2*2], y2 = X[i2*2+1];
                     // Equation of line through (x1,y1) and (x2,y2) is (y1-y2)x + (x2-x1)y + x1y2 - x2y1 = 0
                     const A = y1 - y2;
                     const B = x2 - x1;
                     const C = x1*y2 - x2*y1;
                     residuals.push(A*x + B*y + C);
                 }
             }
          }
          // Case 3: Circle - Line (Center on Line)
          else if (c.circles.length === 1 && c.lines.length === 1) {
             const circle = circles.find(cir => cir.id === c.circles[0]);
             const line = lines.find(l => l.id === c.lines[0]);
             if (circle && line) {
                 const ic = pointMap.get(circle.center);
                 const i1 = pointMap.get(line.p1);
                 const i2 = pointMap.get(line.p2);
                 if (ic !== undefined && i1 !== undefined && i2 !== undefined) {
                     const xc = X[ic*2], yc = X[ic*2+1];
                     const x1 = X[i1*2], y1 = X[i1*2+1];
                     const x2 = X[i2*2], y2 = X[i2*2+1];
                     const A = y1 - y2;
                     const B = x2 - x1;
                     const C = x1*y2 - x2*y1;
                     residuals.push(A*xc + B*yc + C);
                 }
             }
          }
          // Case 4: Point - Circle (Point on Circle)
          else if (c.points.length === 1 && c.circles.length === 1) {
              const pt = points.find(p => p.id === c.points[0]);
              const circle = circles.find(cir => cir.id === c.circles[0]);
              if (pt && circle) {
                  const ip = pointMap.get(pt.id), ic = pointMap.get(circle.center);
                  if (ip !== undefined && ic !== undefined) {
                      const dx = X[ip*2] - X[ic*2];
                      const dy = X[ip*2+1] - X[ic*2+1];
                      const dist = Math.sqrt(dx*dx + dy*dy);
                      const r = getR(circle.id);
                      residuals.push(dist - r);
                  }
              }
          }
          break;
        }
        case ConstraintType.RADIUS: {
          const circle = circles.find(cir => cir.id === c.circles[0]);
          if (circle) {
              const r = getR(circle.id);
              residuals.push(r - (c.value || 0));
          }
          break;
        }
        case ConstraintType.ANGLE: {
            if (c.lines.length > 0) {
              const l1 = lines.find(l => l.id === c.lines[0]);
              if (l1) {
                const i1 = pointMap.get(l1.p1), i2 = pointMap.get(l1.p2);
                if (i1 !== undefined && i2 !== undefined) {
                    const v1x = X[i2 * 2] - X[i1 * 2], v1y = X[i2 * 2 + 1] - X[i1 * 2 + 1];
  
                    let currentAngle = 0;
                    if (c.lines.length === 2) {
                      const l2 = lines.find(l => l.id === c.lines[1]);
                      if (l2) {
                        const i3 = pointMap.get(l2.p1), i4 = pointMap.get(l2.p2);
                        if (i3 !== undefined && i4 !== undefined) {
                            const v2x = X[i4 * 2] - X[i3 * 2], v2y = X[i4 * 2 + 1] - X[i3 * 2 + 1];
                            const dot = v1x * v2x + v1y * v2y;
                            const mag1 = Math.sqrt(v1x*v1x + v1y*v1y), mag2 = Math.sqrt(v2x*v2x + v2y*v2y);
                            if (mag1 > 1e-9 && mag2 > 1e-9) {
                              currentAngle = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2)))) * 180 / Math.PI;
                            }
                        }
                      }
                    } else {
                      currentAngle = Math.atan2(v1y, v1x) * 180 / Math.PI;
                    }
                    residuals.push((currentAngle - (c.value || 0)) * (this.ANGLE_STIFFNESS / 57.3));
                }
              }
            }
            break;
        }
        case ConstraintType.PARALLEL: {
          const l1 = lines.find(l => l.id === c.lines[0]);
          const l2 = lines.find(l => l.id === c.lines[1]);
          if (l1 && l2) {
            const i1 = pointMap.get(l1.p1), i2 = pointMap.get(l1.p2);
            const i3 = pointMap.get(l2.p1), i4 = pointMap.get(l2.p2);
            if (i1 !== undefined && i2 !== undefined && i3 !== undefined && i4 !== undefined) {
                const v1x = X[i2 * 2] - X[i1 * 2], v1y = X[i2 * 2 + 1] - X[i1 * 2 + 1];
                const v2x = X[i4 * 2] - X[i3 * 2], v2y = X[i4 * 2 + 1] - X[i3 * 2 + 1];
                const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
                const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
                if (mag1 > 1e-7 && mag2 > 1e-7) {
                  const sinTheta = (v1x * v2y - v1y * v2x) / (mag1 * mag2);
                  residuals.push(sinTheta * this.ANGLE_STIFFNESS);
                }
            }
          }
          break;
        }
        case ConstraintType.TANGENT: {
          // Case 1: Line - Circle
          if (c.lines.length === 1 && c.circles.length === 1) {
            const line = lines.find(l => l.id === c.lines[0]);
            const circle = circles.find(cir => cir.id === c.circles[0]);
            if (line && circle) {
              const i1 = pointMap.get(line.p1), i2 = pointMap.get(line.p2);
              const ic = pointMap.get(circle.center);
              if (i1 !== undefined && i2 !== undefined && ic !== undefined) {
                  const x1 = X[i1 * 2], y1 = X[i1 * 2 + 1];
                  const x2 = X[i2 * 2], y2 = X[i2 * 2 + 1];
                  const xc = X[ic * 2], yc = X[ic * 2 + 1];
                  const r = getR(circle.id);
                  
                  const dx = x2 - x1;
                  const dy = y2 - y1;
                  const l2 = dx * dx + dy * dy;
                  if (l2 > 1e-7) {
                    const dist = Math.abs(dy * xc - dx * yc + x2 * y1 - y2 * x1) / Math.sqrt(l2);
                    residuals.push(dist - r);
                  }
              }
            }
          }
          // Case 2: Circle - Circle
          else if (c.circles.length === 2) {
             const c1 = circles.find(cir => cir.id === c.circles[0]);
             const c2 = circles.find(cir => cir.id === c.circles[1]);
             if (c1 && c2) {
                 const i1 = pointMap.get(c1.center), i2 = pointMap.get(c2.center);
                 if (i1 !== undefined && i2 !== undefined) {
                     const dx = X[i2*2] - X[i1*2];
                     const dy = X[i2*2+1] - X[i1*2+1];
                     const dist = Math.sqrt(dx*dx + dy*dy);
                     const r1 = getR(c1.id);
                     const r2 = getR(c2.id);
                     
                     const rSum = r1 + r2;
                     const rDiff = Math.abs(r1 - r2);
                     
                     if (Math.abs(dist - rSum) < Math.abs(dist - rDiff)) {
                         residuals.push(dist - rSum);
                     } else {
                         // Internal Tangency: dist should be rDiff.
                         // For concentric circles (rDiff=0), dist should be 0.
                         if (Math.abs(rDiff) < 0.001) {
                            residuals.push(dx);
                            residuals.push(dy);
                         } else {
                            residuals.push(dist - rDiff);
                         }
                     }
                 }
             }
          }
          // Case 3: Point - Circle
          else if (c.points.length === 1 && c.circles.length === 1) {
              const pt = points.find(p => p.id === c.points[0]);
              const circle = circles.find(cir => cir.id === c.circles[0]);
              if (pt && circle) {
                  const ip = pointMap.get(pt.id), ic = pointMap.get(circle.center);
                  if (ip !== undefined && ic !== undefined) {
                      const dx = X[ip*2] - X[ic*2];
                      const dy = X[ip*2+1] - X[ic*2+1];
                      const dist = Math.sqrt(dx*dx + dy*dy);
                      const r = getR(circle.id);
                      residuals.push(dist - r);
                  }
              }
          }
          break;
        }
        case ConstraintType.FIXED: {
           break;
        }
      }
    }
    return residuals;
  }

  private static calculateJacobian(X: Float64Array, constraints: Constraint[], points: Point[], circles: Circle[], lines: Line[]): number[][] {
    const h = 0.0001;
    const residualsBase = this.calculateResiduals(X, constraints, points, circles, lines);
    const J: number[][] = Array.from({ length: residualsBase.length }, () => Array(X.length).fill(0));

    for (let j = 0; j < X.length; j++) {
      const originalVal = X[j];
      X[j] += h;
      const residualsStep = this.calculateResiduals(X, constraints, points, circles, lines);
      X[j] = originalVal;

      for (let i = 0; i < residualsBase.length; i++) {
        J[i][j] = (residualsStep[i] - residualsBase[i]) / h;
      }
    }
    return J;
  }

  private static solveGaussNewton(J: number[][], R: number[], X: Float64Array, points: Point[]): number[] {
    const n = X.length;
    const m = R.length;

    const AtA = Array.from({ length: n }, () => new Float64Array(n));
    const Atb = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < m; k++) {
          sum += J[k][i] * J[k][j];
        }
        AtA[i][j] = sum;
      }
      let bSum = 0;
      for (let k = 0; k < m; k++) {
        bSum += J[k][i] * -R[k];
      }
      Atb[i] = bSum;
    }

    const numPoints = points.length;

    for (let i = 0; i < n; i++) {
      // Damping for points
      if (i < numPoints * 2) {
          const ptIdx = Math.floor(i / 2);
          if (points[ptIdx].fixed) {
            for (let j = 0; j < n; j++) AtA[i][j] = 0;
            for (let j = 0; j < n; j++) AtA[j][i] = 0;
            AtA[i][i] = 1;
            Atb[i] = 0;
          } else {
            AtA[i][i] += this.LAMBDA;
          }
      } else {
          // Damping for radii (index >= numPoints*2)
          // Radii are free to move unless constrained, but we add damping to prevent drift
          AtA[i][i] += this.LAMBDA; 
      }
    }

    const deltaX = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let pivot = AtA[i][i];
      if (Math.abs(pivot) < 1e-12) continue;
      
      for (let j = i + 1; j < n; j++) {
        const factor = AtA[j][i] / pivot;
        for (let k = i; k < n; k++) AtA[j][k] -= factor * AtA[i][k];
        Atb[j] -= factor * Atb[i];
      }
    }

    for (let i = n - 1; i >= 0; i--) {
      let sum = 0;
      for (let j = i + 1; j < n; j++) sum += AtA[i][j] * deltaX[j];
      if (Math.abs(AtA[i][i]) > 1e-12) {
        deltaX[i] = (Atb[i] - sum) / AtA[i][i];
      }
    }

    return deltaX;
  }
}
