/// <reference types="vite/client" />

import type { CaptyAPI } from "../preload/index";

declare global {
  interface Window {
    capty: CaptyAPI;
  }
}

declare module "*.onnx?url" {
  const src: string;
  export default src;
}

export {};
