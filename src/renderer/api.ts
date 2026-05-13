import type { IpcContract, IpcEvents } from "../shared/ipc-contract.js";

interface RendererApi {
  invoke<K extends keyof IpcContract>(
    channel: K,
    ...args: Parameters<IpcContract[K]>
  ): Promise<ReturnType<IpcContract[K]>>;
  on<K extends keyof IpcEvents>(
    channel: K,
    handler: (payload: IpcEvents[K]) => void,
  ): () => void;
}

declare global {
  interface Window {
    api: RendererApi;
  }
}

export const api: RendererApi = window.api;
