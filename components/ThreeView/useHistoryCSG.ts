import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { Feature } from "../../types";
import { clearThreeGroup } from "./threeUtils";
import { createReplicadProfiles } from "./replicadUtils";
import { generateRevolveGeometry, getShapesFromSketch } from "./sketchGeometry";
import { initReplicad } from "../../services/replicad";
import { replicadToThree } from "./replicadThreeUtils";
import { revolution, loft } from "replicad";

type UseHistoryCSGParams = {
  features: Feature[];
  historyGroupRef: MutableRefObject<THREE.Group | null>;
  brushCache: MutableRefObject<Map<string, {
    shape: any;
    signature: string;
  }>>;
  activeAxisId: string | null;
  fitView: () => void;
  onLastResultShapeReady?: (shape: any) => void;
  onFeatureShapesReady?: (shapesByFeatureId: Map<string, any>) => void;
  onBuildComplete?: () => void;
};

export const useHistoryCSG = ({
  features,
  historyGroupRef,
  brushCache,
  activeAxisId,
  fitView,
  onLastResultShapeReady,
  onFeatureShapesReady,
  onBuildComplete,
}: UseHistoryCSGParams) => {
  useEffect(() => {
    let active = true;

    const buildGeometry = async () => {
      if (!historyGroupRef.current) return;
      const group = historyGroupRef.current;

      // Ensure Replicad is ready
      await initReplicad();
      if (!active) return;

      clearThreeGroup(group);
      if (features.length === 0) {
        if (onLastResultShapeReady) onLastResultShapeReady(null);
        return;
      }

      let resultShape: any = null;

      const material = new THREE.MeshStandardMaterial({
        color: 0xe5e7eb,
        roughness: 0.5,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });

      // Track if any upstream feature was rebuilt, forcing later features to rebuild
      let upstreamDirty = false;
      
      // Track all individual feature shapes (before booleans) for face extraction
      const featureShapesMap = new Map<string, any>();

      for (const feature of features) {
        // Render SKETCH features as 3D line visualization (no solid geometry)
        if (feature.featureType === "SKETCH") {
          console.log(`Rendering SKETCH feature ${feature.name} as line visualization`);
          
          // Create a group for this sketch feature
          const sketchGroup = new THREE.Group();
          sketchGroup.userData.featureId = feature.id;
          sketchGroup.userData.featureType = "SKETCH";
          
          // Apply the feature transform
          if (feature.transform) {
            sketchGroup.matrix.fromArray(feature.transform);
            sketchGroup.matrixAutoUpdate = false;
            sketchGroup.updateMatrixWorld(true);
          }
          
          const lineMaterial = new THREE.LineBasicMaterial({ color: 0x22c55e, linewidth: 2 });
          const constructionMaterial = new THREE.LineDashedMaterial({ 
            color: 0x666666, 
            dashSize: 4, 
            gapSize: 2 
          });
          
          // Render lines
          feature.sketch.lines.forEach((line) => {
            const p1 = feature.sketch.points.find((p) => p.id === line.p1);
            const p2 = feature.sketch.points.find((p) => p.id === line.p2);
            if (p1 && p2) {
              const geom = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(p1.x, p1.y, 0),
                new THREE.Vector3(p2.x, p2.y, 0),
              ]);
              const mat = line.construction ? constructionMaterial.clone() : lineMaterial.clone();
              const mesh = new THREE.Line(geom, mat);
              if (line.construction) mesh.computeLineDistances();
              sketchGroup.add(mesh);
            }
          });
          
          // Render circles
          feature.sketch.circles.forEach((circle) => {
            const center = feature.sketch.points.find((p) => p.id === circle.center);
            if (center) {
              const curve = new THREE.EllipseCurve(center.x, center.y, circle.radius, circle.radius, 0, 2 * Math.PI, false, 0);
              const points = curve.getPoints(50);
              const geom = new THREE.BufferGeometry().setFromPoints(points);
              const mat = circle.construction ? constructionMaterial.clone() : lineMaterial.clone();
              const mesh = new THREE.Line(geom, mat);
              sketchGroup.add(mesh);
            }
          });
          
          // Render arcs
          (feature.sketch.arcs || []).forEach((arc) => {
            const center = feature.sketch.points.find((p) => p.id === arc.center);
            const p1 = feature.sketch.points.find((p) => p.id === arc.p1);
            const p2 = feature.sketch.points.find((p) => p.id === arc.p2);
            if (center && p1 && p2) {
              const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
              const endAngle = Math.atan2(p2.y - center.y, p2.x - center.x);
              let diff = endAngle - startAngle;
              while (diff <= -Math.PI) diff += 2 * Math.PI;
              while (diff > Math.PI) diff -= 2 * Math.PI;
              const clockwise = diff < 0;
              const curve = new THREE.EllipseCurve(center.x, center.y, arc.radius, arc.radius, startAngle, endAngle, clockwise, 0);
              const points = curve.getPoints(50);
              const geom = new THREE.BufferGeometry().setFromPoints(points);
              const mat = arc.construction ? constructionMaterial.clone() : lineMaterial.clone();
              const mesh = new THREE.Line(geom, mat);
              sketchGroup.add(mesh);
            }
          });
          
          // Render points as small spheres
          const pointGeom = new THREE.SphereGeometry(1.5, 8, 8);
          const pointMaterial = new THREE.MeshBasicMaterial({ color: 0x22c55e });
          feature.sketch.points.forEach((point) => {
            // Skip projected points (construction reference)
            if (point.id.startsWith('p_proj_')) return;
            const sphere = new THREE.Mesh(pointGeom, pointMaterial);
            sphere.position.set(point.x, point.y, 0);
            sketchGroup.add(sphere);
          });
          
          group.add(sketchGroup);
          continue;
        }

        // Generate a signature for the feature to detect changes
        const signature = JSON.stringify({
          id: feature.id,
          featureType: feature.featureType,
          operation: feature.operation,
          extrusionDepth: feature.extrusionDepth,
          revolveAngle: feature.revolveAngle,
          revolveAxisId: feature.revolveAxisId,
          loftSketchIds: feature.loftSketchIds,
          transform: feature.transform,
          lastModified: feature.lastModified,
          // Light-weight sketch signature
          sketch: {
            points: feature.sketch.points.length,
            lines: feature.sketch.lines.length,
            circles: feature.sketch.circles.length,
            arcs: feature.sketch.arcs?.length || 0,
            constraints: feature.sketch.constraints.length,
          }
        });

        const cached = brushCache.current.get(feature.id);
        let featureShape: any;

        if (cached && cached.signature === signature && !upstreamDirty) {
          // Cache hit and safe to reuse
          featureShape = cached.shape;
          // console.log(`Cache hit for feature ${feature.name}`);
        } else {
          // Cache miss or forced rebuild
          console.log(`Rebuilding feature ${feature.name} (dirty=${upstreamDirty}, reason=${!cached ? 'no-cache' : cached.signature !== signature ? 'signature-mismatch' : 'upstream-change'})`);
          
          let currentFeatureShape: any;
          
          // Handle LOFT feature type separately
          if (feature.featureType === "LOFT") {
            console.log(`Processing LOFT feature ${feature.name}`);
            
            if (!feature.loftSketchIds || feature.loftSketchIds.length < 2) {
              console.error(`LOFT feature ${feature.name} requires at least 2 sketch references`);
              continue;
            }
            
            // Collect sketches to loft between
            const sketchFeatures = feature.loftSketchIds
              .map(id => features.find(f => f.id === id))
              .filter((f): f is Feature => f !== undefined && f.featureType === "SKETCH");
            
            if (sketchFeatures.length < 2) {
              console.error(`LOFT feature ${feature.name}: could not find enough valid sketch features`);
              continue;
            }
            
            console.log(`Found ${sketchFeatures.length} sketch features for loft`);
            
            try {
              // Create wires from each sketch
              const wires: any[] = [];
              
              for (const sketchFeature of sketchFeatures) {
                // Create drawing from sketch
                const drawings = createReplicadProfiles(sketchFeature.sketch, {});
                
                if (drawings.length === 0) {
                  console.warn(`No drawings created for sketch ${sketchFeature.name}, skipping`);
                  continue;
                }
                
                // Use the first drawing (main profile)
                const drawing = drawings[0];
                
                // Get the sketch's transformation matrix
                const sketchMatrix = new THREE.Matrix4();
                sketchMatrix.fromArray(sketchFeature.transform);
                
                // Decompose the matrix
                const position = new THREE.Vector3();
                const quaternion = new THREE.Quaternion();
                const scale = new THREE.Vector3();
                sketchMatrix.decompose(position, quaternion, scale);
                
                // Create wire from drawing
                const sketchForWire = drawing.sketchOnPlane();
                let wire = sketchForWire.wire;
                
                // Convert quaternion to axis-angle for Replicad
                const angle = 2 * Math.acos(Math.min(1, Math.max(-1, quaternion.w)));
                const s = Math.sqrt(Math.max(0, 1 - quaternion.w * quaternion.w));
                let axis: [number, number, number] = [0, 0, 1];
                if (s > 0.001) {
                  axis = [quaternion.x / s, quaternion.y / s, quaternion.z / s];
                }
                
                const angleDeg = angle * 180 / Math.PI;
                
                // Apply transformation to position the wire in 3D space
                if (angleDeg > 0.1) {
                  wire = wire.rotate(angleDeg, [0, 0, 0], axis);
                }
                if (position.length() > 0.001) {
                  wire = wire.translate(position.x, position.y, position.z);
                }
                
                wires.push(wire);
                console.log(`  Added wire from sketch ${sketchFeature.name} at position [${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}]`);
              }
              
              if (wires.length < 2) {
                console.error(`LOFT feature ${feature.name}: need at least 2 wires, got ${wires.length}`);
                continue;
              }
              
              // Create lofted solid
              console.log(`Lofting between ${wires.length} wires`);
              currentFeatureShape = loft(wires, { ruled: true });
              console.log(`Loft succeeded`);
              
            } catch (e) {
              console.error(`Failed to create loft for feature ${feature.name}:`, e);
              continue;
            }
          } else {
            // Standard EXTRUDE/REVOLVE processing
            const drawings = createReplicadProfiles(feature.sketch, {
              axisLineId: activeAxisId,
            });

            console.log(`Created ${drawings.length} drawings`);
            if (drawings.length === 0) {
              console.warn(`No drawings created for feature ${feature.name}, skipping`);
              continue;
            }

            // Handle holes by sorting by area and checking containment
            // This is a simplified version of the logic in sketchGeometry.ts
            const drawingData = drawings.map(d => {
              const bbox = d.boundingBox;
              const [[xMin, yMin], [xMax, yMax]] = bbox.bounds;
              const area = (xMax - xMin) * (yMax - yMin);
              return { drawing: d, area, xMin, xMax, yMin, yMax };
            });
            drawingData.sort((a, b) => b.area - a.area);

            console.log(`Feature ${feature.name}: Processing ${drawingData.length} drawings`);
            drawingData.forEach((d, i) => {
              console.log(`  Drawing ${i}: area=${d.area.toFixed(2)}, bounds=[${d.xMin.toFixed(2)},${d.yMin.toFixed(2)} to ${d.xMax.toFixed(2)},${d.yMax.toFixed(2)}]`);
            });

            let combinedDrawing = drawingData[0].drawing;
            for (let i = 1; i < drawingData.length; i++) {
              const current = drawingData[i];
              const parent = drawingData.find((p, idx) => idx < i && 
                current.xMin > p.xMin && current.xMax < p.xMax &&
                current.yMin > p.yMin && current.yMax < p.yMax
              );

              if (parent) {
                console.log(`  Drawing ${i} is inside drawing ${drawingData.indexOf(parent)}, cutting`);
                combinedDrawing = combinedDrawing.cut(current.drawing);
              } else {
                console.log(`  Drawing ${i} is separate, fusing`);
                combinedDrawing = combinedDrawing.fuse(current.drawing);
              }
            }

            console.log(`Creating sketch from combined drawing`);
            const sketch = combinedDrawing.sketchOnPlane();

            if (feature.featureType === "EXTRUDE") {
              let actualDepth = feature.extrusionDepth;
              let zOffset = 0;
              
              if (feature.operation === "CUT") {
                const overlap = 1.0;
                if (feature.throughAll) {
                  actualDepth = 1000;
                  zOffset = overlap;
                } else {
                  actualDepth = feature.extrusionDepth + overlap;
                  zOffset = overlap;
                }
                currentFeatureShape = sketch.extrude(-actualDepth).translateZ(zOffset);
              } else {
                currentFeatureShape = sketch.extrude(actualDepth);
              }
            } else if (feature.featureType === "REVOLVE") {
              // Find the axis line and its position
              let axisVector: [number, number, number] = [0, 1, 0];
              let axisOrigin: [number, number] = [0, 0];
              const axisId = feature.revolveAxisId || activeAxisId;
              const axisLine = feature.sketch.lines.find(l => l.id === axisId);
              
              if (axisLine) {
                const p1 = feature.sketch.points.find(p => p.id === axisLine.p1);
                const p2 = feature.sketch.points.find(p => p.id === axisLine.p2);
                if (p1 && p2) {
                  axisOrigin = [p1.x, p1.y];
                  const dx = p2.x - p1.x;
                  const dy = p2.y - p1.y;
                  const len = Math.sqrt(dx*dx + dy*dy);
                  if (len > 1e-6) {
                    axisVector = [dx/len, dy/len, 0];
                  }
                }
              }
              
              console.log(`Revolving around axis: [${axisVector.join(', ')}] at origin [${axisOrigin.join(', ')}]`);
              console.log(`Sketch has ${feature.sketch.circles.length} circles, ${feature.sketch.lines.length} lines, ${feature.sketch.arcs?.length || 0} arcs`);
              console.log(`Axis line ID: ${axisId}`);
              
              // Check if the axis vector is valid (not zero length)
              const axisLen = Math.sqrt(axisVector[0]**2 + axisVector[1]**2 + axisVector[2]**2);
              if (axisLen < 1e-6) {
                console.error(`Revolve axis has zero length, using default Y axis`);
                axisVector = [0, 1, 0];
              }
              
              // Translate the drawing so the axis passes through the origin
              const translatedDrawing = combinedDrawing.translate(-axisOrigin[0], -axisOrigin[1]);
              const translatedSketch = translatedDrawing.sketchOnPlane();
              
              // Log the translated drawing info before revolve
              const bounds = translatedDrawing.boundingBox.bounds;
              console.log(`Translated drawing bounds:`, bounds);
              const [[xMin, yMin], [xMax, yMax]] = bounds;
              
              // Check if profile crosses the revolve axis
              // For a vertical axis (0, ±1, 0), the axis is at X=0
              // For a horizontal axis (±1, 0, 0), the axis is at Y=0
              const isVerticalAxis = Math.abs(axisVector[0]) < 0.01 && Math.abs(axisVector[1]) > 0.99;
              const isHorizontalAxis = Math.abs(axisVector[0]) > 0.99 && Math.abs(axisVector[1]) < 0.01;
              
              if (isVerticalAxis && xMin < -0.001 && xMax > 0.001) {
                console.error(`ERROR: Profile crosses the vertical revolve axis!`);
                console.error(`Profile X range: [${xMin.toFixed(2)}, ${xMax.toFixed(2)}] crosses X=0`);
                console.error(`Replicad cannot revolve profiles that cross the axis`);
                console.error(`Please ensure your profile is entirely on one side of the axis`);
                continue;
              }
              
              if (isHorizontalAxis && yMin < -0.001 && yMax > 0.001) {
                console.error(`ERROR: Profile crosses the horizontal revolve axis!`);
                console.error(`Profile Y range: [${yMin.toFixed(2)}, ${yMax.toFixed(2)}] crosses Y=0`);
                console.error(`Replicad cannot revolve profiles that cross the axis`);
                console.error(`Please ensure your profile is entirely on one side of the axis`);
                continue;
              }
              
              console.log(`Calling revolution() with angle: ${feature.revolveAngle || 360}`);
              
              // Revolve around the axis (now passing through origin)
              // @ts-ignore
              const face = translatedSketch.face();
              let revolvedShape = revolution(face, [0, 0, 0], axisVector, feature.revolveAngle || 360);
              
              // Translate back to original position
              currentFeatureShape = revolvedShape.translate(axisOrigin[0], axisOrigin[1], 0);
              console.log(`Revolve succeeded`);
            }
          }

          featureShape = currentFeatureShape;
          
          // Apply the feature's transformation matrix (skip for LOFT as transforms are applied per-sketch)
          if (feature.featureType !== "LOFT" && featureShape) {
            const matrix = new THREE.Matrix4();
            matrix.fromArray(feature.transform);
            
            // Check if this is not the default identity matrix
            const isIdentity = feature.transform.every((v, i) => 
              (i % 5 === 0 && Math.abs(v - 1) < 1e-10) || (i % 5 !== 0 && Math.abs(v) < 1e-10)
            );
            
            console.log(`Feature ${feature.name} transform matrix:`, feature.transform);
            console.log(`Is identity: ${isIdentity}`);
            
            if (!isIdentity) {
              // The transformation matrix transforms points from local sketch space to world space
              // For Replicad, we need to transform the shape the same way
              
              // Extract basis vectors and origin from the matrix
              const xAxis = new THREE.Vector3(feature.transform[0], feature.transform[1], feature.transform[2]);
              const yAxis = new THREE.Vector3(feature.transform[4], feature.transform[5], feature.transform[6]);
              const zAxis = new THREE.Vector3(feature.transform[8], feature.transform[9], feature.transform[10]);
              const origin = new THREE.Vector3(feature.transform[12], feature.transform[13], feature.transform[14]);
              
              console.log(`  Origin: [${origin.x}, ${origin.y}, ${origin.z}]`);
              console.log(`  X-axis: [${xAxis.x}, ${xAxis.y}, ${xAxis.z}]`);
              console.log(`  Y-axis: [${yAxis.x}, ${yAxis.y}, ${yAxis.z}]`);
              console.log(`  Z-axis: [${zAxis.x}, ${zAxis.y}, ${zAxis.z}]`);
              
              // Decompose for rotation
              const position = new THREE.Vector3();
              const quaternion = new THREE.Quaternion();
              const scale = new THREE.Vector3();
              matrix.decompose(position, quaternion, scale);
              
              // Convert quaternion to axis-angle for Replicad
              const angle = 2 * Math.acos(Math.min(1, Math.max(-1, quaternion.w)));
              const s = Math.sqrt(Math.max(0, 1 - quaternion.w * quaternion.w));
              let axis: [number, number, number] = [0, 0, 1];
              if (s > 0.001) {
                axis = [quaternion.x / s, quaternion.y / s, quaternion.z / s];
              }
              
              const angleDeg = angle * 180 / Math.PI;
              console.log(`  Rotation: ${angleDeg.toFixed(2)} degrees around axis [${axis.map(v => v.toFixed(3)).join(', ')}]`);
              
              // Apply rotation first (around origin), then translation
              if (angleDeg > 0.1) {
                featureShape = featureShape.rotate(angleDeg, [0, 0, 0], axis);
                console.log(`  Applied rotation`);
              }
              
              // Then translate
              if (position.length() > 0.001) {
                featureShape = featureShape.translate(position.x, position.y, position.z);
                console.log(`  Applied translation to [${position.x}, ${position.y}, ${position.z}]`);
              }
              
              // Log bounding box after transformation
              const bbox = featureShape.boundingBox;
              console.log(`  After transform bounding box:`, {
                min: [bbox.center[0] - bbox.width/2, bbox.center[1] - bbox.height/2, bbox.center[2] - bbox.depth/2],
                max: [bbox.center[0] + bbox.width/2, bbox.center[1] + bbox.height/2, bbox.center[2] + bbox.depth/2]
              });
            }
          }
          
          // Update cache
          if (featureShape) {
            brushCache.current.set(feature.id, { shape: featureShape, signature });
          }
          upstreamDirty = true; // Mark downstream as dirty
        }
        
        // Store this feature's shape for later face extraction
        if (featureShape) {
          featureShapesMap.set(feature.id, featureShape);
        }

        if (featureShape) {
          if (!resultShape) {
            resultShape = featureShape;
            const bb = featureShape.boundingBox;
            console.log(`First feature ${feature.name}, bounding box:`, {
              min: [bb.center[0] - bb.width/2, bb.center[1] - bb.height/2, bb.center[2] - bb.depth/2],
              max: [bb.center[0] + bb.width/2, bb.center[1] + bb.height/2, bb.center[2] + bb.depth/2]
            });
          } else {
            try {
              console.log(`Performing ${feature.operation} operation for feature ${feature.name}`);
              const baseBB = resultShape.boundingBox;
              const featureBB = featureShape.boundingBox;
              console.log(`  Base shape bounding box:`, {
                min: [baseBB.center[0] - baseBB.width/2, baseBB.center[1] - baseBB.height/2, baseBB.center[2] - baseBB.depth/2],
                max: [baseBB.center[0] + baseBB.width/2, baseBB.center[1] + baseBB.height/2, baseBB.center[2] + baseBB.depth/2]
              });
              console.log(`  Feature shape bounding box:`, {
                min: [featureBB.center[0] - featureBB.width/2, featureBB.center[1] - featureBB.height/2, featureBB.center[2] - featureBB.depth/2],
                max: [featureBB.center[0] + featureBB.width/2, featureBB.center[1] + featureBB.height/2, featureBB.center[2] + featureBB.depth/2]
              });
              
              if (feature.operation === "CUT") {
                resultShape = resultShape.cut(featureShape);
                console.log(`  Cut completed, result type:`, resultShape.constructor.name);
                const resultBB = resultShape.boundingBox;
                console.log(`  Result bounding box:`, {
                  min: [resultBB.center[0] - resultBB.width/2, resultBB.center[1] - resultBB.height/2, resultBB.center[2] - resultBB.depth/2],
                  max: [resultBB.center[0] + resultBB.width/2, resultBB.center[1] + resultBB.height/2, resultBB.center[2] + resultBB.depth/2]
                });
              } else {
                resultShape = resultShape.fuse(featureShape);
                console.log(`  Fuse completed`);
              }
            } catch (e) {
              console.error(`Boolean operation ${feature.operation} failed for feature ${feature.name}:`, e);
            }
          }
        }
      }

      if (resultShape && active) {
        if (onLastResultShapeReady) onLastResultShapeReady(resultShape);
        if (onFeatureShapesReady) onFeatureShapesReady(featureShapesMap);
        
        try {
          // Use very low quality (higher tolerance) for history view mesh
          // This keeps the UI responsive. High quality is only for export.
          const geometry = replicadToThree(resultShape, 2.0, 0.8);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // Tag the mesh with the ID of the feature that produced it (the last one)
          mesh.userData.featureId = features[features.length - 1].id;
          group.add(mesh);
          setTimeout(fitView, 50);
        } catch (e) {
          console.error("Failed to generate mesh from Replicad", e);
        }
      }
      
      // Notify that build is complete
      if (onBuildComplete) {
        onBuildComplete();
      }
    };

    buildGeometry();

    return () => {
      active = false;
    };
  }, [activeAxisId, brushCache, features, fitView, historyGroupRef]);
};
