import { autoUpdater } from "electron-updater";

import type { UpdateStatus } from "../shared/ipc-contract.js";
import type { Logger } from "../shared/logger.js";

export type { UpdateStatus };

export interface Updater {
  checkForUpdates(): void;
  installUpdate(): void;
}

export function setupAutoUpdater(
  onStatus: (s: UpdateStatus) => void,
  logger: Logger,
): Updater {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null; // use our own logger

  autoUpdater.on("checking-for-update", () => {
    onStatus({ status: "checking" });
  });

  autoUpdater.on("update-available", (info: { version: string }) => {
    logger.info("Update available", { version: info.version });
    onStatus({ status: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    onStatus({ status: "up-to-date" });
  });

  autoUpdater.on("download-progress", (p: { percent: number }) => {
    onStatus({ status: "downloading", progress: Math.round(p.percent) });
  });

  autoUpdater.on("update-downloaded", (info: { version: string }) => {
    logger.info("Update ready to install", { version: info.version });
    onStatus({ status: "ready", version: info.version });
  });

  autoUpdater.on("error", (e: Error) => {
    logger.error("Auto-updater error", { error: e.message });
    onStatus({ status: "error", message: e.message });
  });

  return {
    checkForUpdates() {
      autoUpdater.checkForUpdates().catch((e: Error) => {
        logger.error("Auto-updater check failed", { error: e.message });
      });
    },
    installUpdate() {
      autoUpdater.quitAndInstall();
    },
  };
}
