import * as ort from "onnxruntime-web";
import { resolve } from "path";

// In the electron-as-node test env, point ORT at the wasm files shipped in node_modules.
ort.env.wasm.wasmPaths = resolve(__dirname, "../../node_modules/onnxruntime-web/dist/") + "/";
ort.env.wasm.numThreads = 1;
