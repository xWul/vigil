import { ipcMain } from "electron";

import type { IpcContract } from "../../shared/ipc-contract.js";

export function handle<K extends keyof IpcContract>(
  channel: K,
  handler: (...args: Parameters<IpcContract[K]>) => Promise<ReturnType<IpcContract[K]>>,
): void {
  ipcMain.handle(channel, (_event, ...args) =>
    handler(...(args as Parameters<IpcContract[K]>)),
  );
}
