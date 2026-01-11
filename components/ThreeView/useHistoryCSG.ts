import { useEffect, type MutableRefObject } from "react";
import * as THREE from "three";
import { Evaluator, Brush, SUBTRACTION, ADDITION } from "three-bvh-csg";
import type { Feature } from "../../types";
import { clearThreeGroup } from "./threeUtils";
import {
  generateGeometryForFeature,
  getShapesFromSketch,
} from "./sketchGeometry";

type UseHistoryCSGParams = {
  features: Feature[];
  historyGroupRef: MutableRefObject<THREE.Group | null>;
  brushCache: MutableRefObject<WeakMap<Feature, Brush>>;
  activeAxisId: string | null;
  fitView: () => void;
};

export const useHistoryCSG = ({
  features,
  historyGroupRef,
  brushCache,
  activeAxisId,
  fitView,
}: UseHistoryCSGParams) => {
  useEffect(() => {
    if (!historyGroupRef.current) return;
    const group = historyGroupRef.current;

    clearThreeGroup(group);

    if (features.length === 0) return;

    const evaluator = new Evaluator();
    let resultBrush: Brush | null = null;

    const material = new THREE.MeshStandardMaterial({
      color: 0xe5e7eb,
      roughness: 0.5,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    features.forEach((feature) => {
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

        const shapes = getShapesFromSketch(feature.sketch, {
          axisLineId: activeAxisId,
        });
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

          brush = new (Brush as any)(geom, material) as Brush;
          if (feature.transform)
            brush.applyMatrix4(
              new THREE.Matrix4().fromArray(feature.transform)
            );
          brush.updateMatrixWorld();

          (brush as any).userData = { featureId: feature.id };
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
      mesh.updateMatrixWorld(true);
      group.add(mesh);
    }

    setTimeout(fitView, 50);
  }, [activeAxisId, brushCache, features, fitView, historyGroupRef]);
};
