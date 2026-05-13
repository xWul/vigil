import { app, BrowserWindow, nativeImage, shell } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ConsoleLogger } from "../shared/logger.js";
import { KeychainTokenStore } from "./auth/KeychainTokenStore.js";
import { KeychainSecretStore } from "./settings/SecretStore.js";
import { SettingsStore } from "./settings/SettingsStore.js";
import { registerHandlers } from "./ipc/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const isDev = !app.isPackaged;
const logger = ConsoleLogger.fromEnv();

const tokenStore = new KeychainTokenStore();
const secretStore = new KeychainSecretStore();
const settingsStore = new SettingsStore(
  join(app.getPath("userData"), "settings.json"),
  secretStore,
);

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

void app.whenReady().then(() => {
  if (process.platform === "darwin") {
    const icon = nativeImage.createFromPath(
      join(app.getAppPath(), "assets", "icons", "1024x1024.png"),
    );
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }

  const mainWindow = createWindow();
  registerHandlers(mainWindow, tokenStore, settingsStore, logger);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = createWindow();
      registerHandlers(win, tokenStore, settingsStore, logger);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
