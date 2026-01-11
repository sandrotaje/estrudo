import { useEffect, type MutableRefObject } from "react";
import * as THREE from "three";
import type { SketchState } from "../../types";
import { clearThreeGroup } from "./threeUtils";

type UseAxisVisualizationParams = {
  axisHelperGroupRef: MutableRefObject<THREE.Group | null>;
  state: SketchState;
  currentTransform?: number[];
  isConfigOpen: boolean;
  featureType: "EXTRUDE" | "REVOLVE";
  activeAxisId: string | null;
};

export const useAxisVisualization = ({
  axisHelperGroupRef,
  state,
  currentTransform,
  isConfigOpen,
  featureType,
  activeAxisId,
}: UseAxisVisualizationParams) => {
  useEffect(() => {
    const group = axisHelperGroupRef.current;
    if (!group) return;
    clearThreeGroup(group);

    if (isConfigOpen && featureType === "REVOLVE" && activeAxisId) {
      const line = state.lines.find((l) => l.id === activeAxisId);
      const p1 = state.points.find((p) => p.id === line?.p1);
      const p2 = state.points.find((p) => p.id === line?.p2);

      if (p1 && p2) {
        const dir = new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, 0).normalize();
        const center = new THREE.Vector3(
          (p1.x + p2.x) / 2,
          (p1.y + p2.y) / 2,
          0
        );
        const pA = center.clone().add(dir.clone().multiplyScalar(1000));
        const pB = center.clone().add(dir.clone().multiplyScalar(-1000));

        const geometry = new THREE.BufferGeometry().setFromPoints([pA, pB]);
        const material = new THREE.LineDashedMaterial({
          color: 0xffa500,
          linewidth: 2,
          scale: 1,
          dashSize: 10,
          gapSize: 5,
        });
        const axisMesh = new THREE.Line(geometry, material);
        axisMesh.computeLineDistances();
        group.add(axisMesh);

        if (currentTransform) {
          group.matrix.fromArray(currentTransform);
          group.matrixAutoUpdate = false;
          group.updateMatrixWorld(true);
        } else {
          group.matrix.identity();
          group.matrixAutoUpdate = true;
        }
      }
    }
  }, [
    activeAxisId,
    axisHelperGroupRef,
    currentTransform,
    featureType,
    isConfigOpen,
    state,
  ]);
};
