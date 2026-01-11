import { useEffect, type MutableRefObject } from "react";
import * as THREE from "three";
import type { SketchState } from "../../types";
import { clearThreeGroup } from "./threeUtils";

type UseSketchVisualizationParams = {
  sketchVisGroupRef: MutableRefObject<THREE.Group | null>;
  state: SketchState;
  currentTransform?: number[];
  selectedSketchElements: string[];
  fitView: () => void;
  isConfigOpen: boolean;
};

export const useSketchVisualization = ({
  sketchVisGroupRef,
  state,
  currentTransform,
  selectedSketchElements,
  fitView,
  isConfigOpen,
}: UseSketchVisualizationParams) => {
  useEffect(() => {
    if (!sketchVisGroupRef.current) return;
    const group = sketchVisGroupRef.current;
    clearThreeGroup(group);

    if (currentTransform) {
      group.matrix.fromArray(currentTransform);
      group.matrixAutoUpdate = false;
      group.updateMatrixWorld(true);
    } else {
      group.matrix.identity();
      group.matrixAutoUpdate = true;
    }

    state.lines.forEach((line) => {
      const p1 = state.points.find((p) => p.id === line.p1);
      const p2 = state.points.find((p) => p.id === line.p2);
      if (p1 && p2) {
        const geom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(p1.x, p1.y, 0),
          new THREE.Vector3(p2.x, p2.y, 0),
        ]);

        const isSelected = selectedSketchElements.includes(line.id);
        let mat: THREE.Material;
        if (line.construction) {
          mat = new THREE.LineDashedMaterial({
            color: isSelected ? 0xffaa00 : 0x666666,
            dashSize: 4,
            gapSize: 2,
          });
        } else {
          mat = new THREE.LineBasicMaterial({
            color: isSelected ? 0xffaa00 : 0x3b82f6,
            linewidth: isSelected ? 2 : 1,
          });
        }

        const mesh = new THREE.Line(geom, mat);
        if (line.construction) mesh.computeLineDistances();
        mesh.userData = {
          sketchId: line.id,
          type: "line",
          construction: line.construction,
        };
        group.add(mesh);
      }
    });

    const renderArc = (
      id: string,
      centerId: string,
      radius: number,
      p1Id?: string,
      p2Id?: string,
      construction?: boolean
    ) => {
      const center = state.points.find((p) => p.id === centerId);
      if (!center) return;

      const curve = new THREE.EllipseCurve(
        center.x,
        center.y,
        radius,
        radius,
        0,
        2 * Math.PI,
        false,
        0
      );

      if (p1Id && p2Id) {
        const p1 = state.points.find((p) => p.id === p1Id);
        const p2 = state.points.find((p) => p.id === p2Id);
        if (p1 && p2) {
          const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
          const endAngle = Math.atan2(p2.y - center.y, p2.x - center.x);
          let diff = endAngle - startAngle;
          while (diff <= -Math.PI) diff += 2 * Math.PI;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          const clockwise = diff < 0;
          curve.aStartAngle = startAngle;
          curve.aEndAngle = endAngle;
          curve.aClockwise = clockwise;
        }
      }

      const points = curve.getPoints(50);
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const isSelected = selectedSketchElements.includes(id);
      const mat = new THREE.LineBasicMaterial({
        color: isSelected ? 0xffaa00 : construction ? 0x666666 : 0x3b82f6,
        linewidth: isSelected ? 2 : 1,
      });
      const mesh = new THREE.Line(geom, mat);
      mesh.userData = {
        sketchId: id,
        type: "curve",
        construction: construction,
      };
      group.add(mesh);
    };

    state.circles.forEach((c) =>
      renderArc(c.id, c.center, c.radius, undefined, undefined, c.construction)
    );
    state.arcs.forEach((a) =>
      renderArc(a.id, a.center, a.radius, a.p1, a.p2, a.construction)
    );

    if (group.children.length > 0) {
      setTimeout(() => fitView(), 100);
    }
  }, [
    state,
    isConfigOpen,
    currentTransform,
    selectedSketchElements,
    fitView,
    sketchVisGroupRef,
  ]);
};
