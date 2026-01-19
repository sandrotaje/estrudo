import { useEffect, type MutableRefObject } from "react";
import * as THREE from "three";
import { clearThreeGroup } from "./threeUtils";

type UsePreviewMeshParams = {
  meshGroupRef: MutableRefObject<THREE.Group | null>;
  previewGeometry: THREE.BufferGeometry | null;
  currentTransform?: number[];
  operation: "NEW" | "CUT";
  previewColor?: number; // Optional custom color for preview
};

export const usePreviewMesh = ({
  meshGroupRef,
  previewGeometry,
  currentTransform,
  operation,
  previewColor,
}: UsePreviewMeshParams) => {
  useEffect(() => {
    if (!meshGroupRef.current) return;
    const group = meshGroupRef.current;

    if (currentTransform) {
      group.matrix.fromArray(currentTransform);
      group.matrixAutoUpdate = false;
      group.updateMatrixWorld(true);
    } else {
      group.matrix.identity();
      group.matrixAutoUpdate = true;
    }

    clearThreeGroup(group);

    if (previewGeometry) {
      // Use custom color if provided, otherwise default based on operation
      const color = previewColor ?? (operation === "CUT" ? 0xff6b6b : 0x60a5fa);
      const mat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.2,
        metalness: 0.1,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      });
      const mesh = new THREE.Mesh(previewGeometry, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }, [currentTransform, meshGroupRef, operation, previewGeometry, previewColor]);
};
