import { useEffect, type MutableRefObject } from "react";
import * as THREE from "three";
import { clearThreeGroup } from "./threeUtils";

type SelectedFaceData = {
  faceVertices: Float32Array;
  matrixWorld: THREE.Matrix4;
};

type UseFaceHighlightParams = {
  highlightGroupRef: MutableRefObject<THREE.Group | null>;
  selectedFaceData: SelectedFaceData | null;
};

export const useFaceHighlight = ({
  highlightGroupRef,
  selectedFaceData,
}: UseFaceHighlightParams) => {
  useEffect(() => {
    if (!highlightGroupRef.current) return;
    const group = highlightGroupRef.current;
    clearThreeGroup(group);

    if (selectedFaceData) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(selectedFaceData.faceVertices, 3)
      );
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: 0xffaa00,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.25,
          depthTest: false,
        })
      );
      mesh.matrix = selectedFaceData.matrixWorld;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }, [highlightGroupRef, selectedFaceData]);
};
