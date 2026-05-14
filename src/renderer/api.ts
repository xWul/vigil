import type { IpcContract, IpcEvents } from "../shared/ipc-contract.js";

interface RendererApi {
  invoke<K extends keyof IpcContract>(
    channel: K,
    ...args: Parameters<IpcContract[K]>
  ): Promise<ReturnType<IpcContract[K]>>;
  on<K extends keyof IpcEvents>(channel: K, handler: (payload: IpcEvents[K]) => void): () => void;
}

declare global {
  interface Window {
    api: RendererApi;
  }
}

// Indirection so WorkspacePreview can swap in a mock before child effects run.
let _impl: RendererApi = window.api;

export const api: RendererApi = {
  invoke(channel, ...args) {
    return _impl.invoke(channel, ...args);
  },
  on(channel, handler) {
    return _impl.on(channel, handler);
  },
};

export function _overrideApi(mock: RendererApi): () => void {
  const prev = _impl;
  _impl = mock;
  return () => {
    _impl = prev;
  };
}
