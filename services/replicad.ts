import initOpenCascade from "replicad-opencascadejs";
// @ts-ignore
import replicadWasm from "replicad-opencascadejs/src/replicad_single.wasm?url";
import { setOC } from "replicad";

let ocPromise: Promise<any> | null = null;

export const initReplicad = async () => {
  if (ocPromise) return ocPromise;
  
  // @ts-ignore
  ocPromise = initOpenCascade({
    locateFile: () => replicadWasm,
  }).then((oc) => {
    (window as any).oc = oc;
    setOC(oc);
    return oc;
  });
  
  return ocPromise;
};

export const ensureReplicad = async () => {
  await initReplicad();
};
