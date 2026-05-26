import { app, BrowserWindow, nativeImage, shell } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { KeychainTokenStore } from "./auth/KeychainTokenStore.js";
import { FileLogger } from "./logger.js";
import { ReviewCache } from "./ai/ReviewCache.js";
import { RepoCache } from "./git/RepoCache.js";
import { KeychainSecretStore } from "./settings/SecretStore.js";
import { SettingsStore } from "./settings/SettingsStore.js";
import { registerHandlers } from "./ipc/index.js";
import { setupAutoUpdater } from "./updater.js";
import type { Updater } from "./updater.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const isDev = !app.isPackaged;
const logger = FileLogger.fromEnv(join(app.getPath("logs"), "vigil.log"));

const tokenStore = new KeychainTokenStore();
const secretStore = new KeychainSecretStore();
const settingsStore = new SettingsStore(
  join(app.getPath("userData"), "settings.json"),
  secretStore,
);
const reviewCache = new ReviewCache(join(app.getPath("userData"), "reviews"));
const repoCache = new RepoCache(join(app.getPath("userData"), "repos"), logger);

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Vigil",
    backgroundColor: "#0e0e10",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

void repoCache.evict();

void app.whenReady().then(() => {
  if (process.platform === "darwin") {
    const icon = nativeImage.createFromPath(
      join(app.getAppPath(), "assets", "icons", "1024x1024.png"),
    );
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }

  createWindow();

  let updater: Updater | null = null;
  if (app.isPackaged) {
    updater = setupAutoUpdater(
      (status) => BrowserWindow.getAllWindows()[0]?.webContents.send("app:updateStatus", status),
      logger,
    );
    setTimeout(() => updater?.checkForUpdates(), 5_000);
  }

  registerHandlers(tokenStore, settingsStore, logger, reviewCache, repoCache, updater);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
