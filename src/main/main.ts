import { app, BrowserWindow } from "electron";

import { setMainWindow } from "./app-context";
import { setupIpcHandlers } from "./ipc-handlers";
import { createMainWindow } from "./window-manager";
import { PLATFORM } from "../shared/constants";

app.whenReady().then(async () => {
  // Create main window
  const mainWindow = await createMainWindow();
  if (mainWindow) {
    setMainWindow(mainWindow);
  }

  // Setup IPC handlers
  setupIpcHandlers();

  // Re-create main window if app is activated with no windows open
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow().then((newWindow) => {
        if (newWindow) {
          setMainWindow(newWindow);
        }
      });
    }
  });
});

// Quit app when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (!PLATFORM.IS_MAC) {
    app.quit();
  }
});

app.on("before-quit", () => {
  // Cleanup if needed before quitting
});
