import { ipcMain } from "electron";

import {
  getMainWindow,
  setUserLoggedIn,
  isNormalizingUrl,
  setNormalizingMainWindowUrl,
} from "./app-context";
import { safeLoadUrl } from "./navigation";
import {
  notifyNewMessage,
  updateDockAndTaskbarBadge,
} from "./notification-manager";
import { URLS } from "../shared/constants";

// URL normalization
function shouldNormalizeMessagesUrl(urlString: unknown): boolean {
  if (typeof urlString !== "string" || !urlString) {
    return false;
  }

  try {
    const parsedUrl = new URL(urlString);
    const isFacebookHost =
      parsedUrl.hostname === "facebook.com" ||
      parsedUrl.hostname === "www.facebook.com";

    if (!isFacebookHost) {
      return false;
    }

    return /^\/messages\/(?:e2ee\/)?t\/[^/]+\/?$/.test(parsedUrl.pathname);
  } catch {
    return false;
  }
}

export async function normalizeMainWindowMessagesUrl(
  urlString: unknown,
): Promise<void> {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (isNormalizingUrl()) {
    return;
  }

  if (!shouldNormalizeMessagesUrl(urlString)) {
    return;
  }

  if (mainWindow.webContents.getURL() === URLS.MESSAGES_INBOX_URL) {
    return;
  }

  setNormalizingMainWindowUrl(true);
  try {
    await safeLoadUrl(mainWindow, URLS.MESSAGES_INBOX_URL);
  } finally {
    setNormalizingMainWindowUrl(false);
  }
}

// IPC handler registration
export function setupIpcHandlers(): void {
  ipcMain.on("host:message-preview", (_event, preview, unreadRowCount) => {
    if (!preview || typeof preview !== "object") {
      return;
    }

    notifyNewMessage(preview).catch((error) => {
      console.error("Failed to notify new message:", error);
    });
    updateDockAndTaskbarBadge(unreadRowCount || 0);
  });

  ipcMain.on("host:unread-count", (_event, unreadRowCount) => {
    updateDockAndTaskbarBadge(unreadRowCount || 0);
  });

  ipcMain.on("host:logout-initiated", async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    setUserLoggedIn(false); // Update menu state
    await safeLoadUrl(mainWindow, URLS.LOGIN_URL);
  });
}
