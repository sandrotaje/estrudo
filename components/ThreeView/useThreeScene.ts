import { useEffect, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

type ThreeSceneHookParams = {
  mountRef: RefObject<HTMLDivElement>;
  fitView: () => void;
  sceneRef: MutableRefObject<THREE.Scene | null>;
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>;
  rendererRef: MutableRefObject<THREE.WebGLRenderer | null>;
  controlsRef: MutableRefObject<OrbitControls | null>;
  historyGroupRef: MutableRefObject<THREE.Group | null>;
  meshGroupRef: MutableRefObject<THREE.Group | null>;
  sketchVisGroupRef: MutableRefObject<THREE.Group | null>;
  highlightGroupRef: MutableRefObject<THREE.Group | null>;
  axisHelperGroupRef: MutableRefObject<THREE.Group | null>;
  requestRef: MutableRefObject<number>;
};

const clearMount = (mount: HTMLDivElement) => {
  while (mount.firstChild) {
    mount.removeChild(mount.firstChild);
  }
};

export const useThreeScene = ({
  mountRef,
  fitView,
  sceneRef,
  cameraRef,
  rendererRef,
  controlsRef,
  historyGroupRef,
  meshGroupRef,
  sketchVisGroupRef,
  highlightGroupRef,
  axisHelperGroupRef,
  requestRef,
}: ThreeSceneHookParams) => {
  useEffect(() => {
    if (!mountRef.current) return;

    // Clear any existing canvas elements (prevents duplicates from React StrictMode)
    clearMount(mountRef.current);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#121212");
    sceneRef.current = scene;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
    camera.position.set(200, -300, 300);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
    hemiLight.position.set(0, 0, 500);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(150, -150, 300);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0001;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xeef2ff, 1.2);
    fillLight.position.set(-150, 150, 100);
    scene.add(fillLight);

    const gridHelper = new THREE.GridHelper(2000, 40, 0x444444, 0x222222);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    const historyGroup = new THREE.Group();
    scene.add(historyGroup);
    historyGroupRef.current = historyGroup;

    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    const sketchVisGroup = new THREE.Group();
    scene.add(sketchVisGroup);
    sketchVisGroupRef.current = sketchVisGroup;

    const highlightGroup = new THREE.Group();
    scene.add(highlightGroup);
    highlightGroupRef.current = highlightGroup;

    const axisHelperGroup = new THREE.Group();
    scene.add(axisHelperGroup);
    axisHelperGroupRef.current = axisHelperGroup;

    const animate = () => {
      requestRef.current = requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current || !cameraRef.current || !rendererRef.current)
        return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    setTimeout(fitView, 100);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(requestRef.current);
      if (rendererRef.current && mountRef.current) {
        rendererRef.current.dispose();
        mountRef.current.removeChild(rendererRef.current.domElement);
      }

      axisHelperGroupRef.current = null;
      highlightGroupRef.current = null;
      sketchVisGroupRef.current = null;
      meshGroupRef.current = null;
      historyGroupRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      sceneRef.current = null;
    };
  }, [
    axisHelperGroupRef,
    cameraRef,
    controlsRef,
    fitView,
    highlightGroupRef,
    historyGroupRef,
    meshGroupRef,
    mountRef,
    requestRef,
    rendererRef,
    sceneRef,
    sketchVisGroupRef,
  ]);
};
