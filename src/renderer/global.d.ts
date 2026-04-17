import type { CaptyAPI } from "../preload/index";

declare global {
  interface Window {
    capty: CaptyAPI;
  }
}

export {};
