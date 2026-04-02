import {
  app,
  BrowserWindow,
  Notification,
  session,
  systemPreferences,
} from "electron";

import { setMainWindow } from "./app-context";
import { setupIpcHandlers } from "./ipc-handlers";
import { setupMenus } from "./menus";
import { updateDockAndTaskbarBadge } from "./notification-manager";
import { configureSessionSecurity } from "./security";
import { createMainWindow } from "./window-manager";
import { PLATFORM } from "../shared/constants";

app.whenReady().then(async () => {
  // Configure session security (permissions)
  configureSessionSecurity({
    session: session.defaultSession,
    systemPreferences,
  });

  // Setup menus and IPC handlers
  setupMenus();
  setupIpcHandlers();

  // Create main window
  const mainWindow = await createMainWindow();
  if (mainWindow) {
    setMainWindow(mainWindow);
  }

  // Trigger notification permission request early
  Notification.isSupported();

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

// Clear badge before quitting
app.on("before-quit", () => {
  updateDockAndTaskbarBadge(0);
});
