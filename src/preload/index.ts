import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

import type { IpcContract, IpcEvents } from "../shared/ipc-contract.js";

const api = {
  invoke<K extends keyof IpcContract>(
    channel: K,
    ...args: Parameters<IpcContract[K]>
  ): Promise<ReturnType<IpcContract[K]>> {
    return ipcRenderer.invoke(channel, ...args) as Promise<ReturnType<IpcContract[K]>>;
  },

  on<K extends keyof IpcEvents>(
    channel: K,
    handler: (payload: IpcEvents[K]) => void,
  ): () => void {
    const listener = (_event: IpcRendererEvent, payload: IpcEvents[K]) => handler(payload);
    ipcRenderer.on(channel, listener as Parameters<typeof ipcRenderer.on>[1]);
    return () => ipcRenderer.removeListener(channel, listener as Parameters<typeof ipcRenderer.on>[1]);
  },
};

contextBridge.exposeInMainWorld("api", api);
