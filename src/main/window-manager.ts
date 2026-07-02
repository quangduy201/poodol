import { BrowserWindow, dialog } from "electron";
import fs from "fs";
import path from "path";

import {
  setUserLoggedIn,
  getUserLoggedIn,
  setStartedOnLoginPage,
  getStartedOnLoginPage,
  setMainWindow,
} from "./app-context";
import { getWindowState, saveWindowState } from "./config-manager";
import { normalizeMainWindowMessagesUrl } from "./ipc-handlers";
import { safeLoadUrl } from "./navigation";
import { enforceUrlPolicy, modifyUserAgent } from "./security";
import {
  URLS,
  WINDOW,
  WEB_PREFERENCES,
  ENVIRONMENT,
} from "../shared/constants";

/**
 * Window Management
 * Handles main window creation, lifecycle, login state detection, and state persistence
 */

// Main window creation
export async function createMainWindow(): Promise<BrowserWindow | null> {
  const savedState = getWindowState();
  const iconPath = path.join(__dirname, "..", "..", WINDOW.ICON_RELATIVE_PATH);

  const options: Electron.BrowserWindowConstructorOptions = {
    width: savedState.width,
    height: savedState.height,
    minWidth: WINDOW.MIN_WIDTH,
    minHeight: WINDOW.MIN_HEIGHT,
    title: WINDOW.APP_NAME,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    backgroundColor: WINDOW.BACKGROUND_COLOR,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: WEB_PREFERENCES.CONTEXT_ISOLATION,
      nodeIntegration: WEB_PREFERENCES.NODE_INTEGRATION,
      sandbox: WEB_PREFERENCES.SANDBOX,
      spellcheck: WEB_PREFERENCES.SPELLCHECK,
      backgroundThrottling: WEB_PREFERENCES.BACKGROUND_THROTTLING,
    },
  };

  if (!Number.isFinite(savedState.x) || !Number.isFinite(savedState.y)) {
    delete options.x;
    delete options.y;
  } else {
    options.x = savedState.x;
    options.y = savedState.y;
  }

  const mainWindow = new BrowserWindow(options);

  // Setup state persistence
  setupWindowStatePersistence(mainWindow, savedState.isMaximized);

  // Setup User-Agent for main window
  setupUserAgent(mainWindow);

  // Setup window lifecycle and navigation
  setupWindowLifecycle(mainWindow);
  setupWindowNavigation(mainWindow, true);

  // Load the appropriate URL based on saved login state
  const isLoggedIn = getUserLoggedIn();
  const initialUrl = isLoggedIn ? URLS.MESSAGES_INBOX_URL : URLS.LOGIN_URL;
  setStartedOnLoginPage(!isLoggedIn);

  try {
    await safeLoadUrl(mainWindow, initialUrl);
  } catch (error) {
    if (ENVIRONMENT.IS_DEVELOPMENT) {
      console.error("Failed to load initial URL:", error);
    }
    dialog.showErrorBox(
      "Navigation Error",
      "Failed to load the page. Please check your internet connection.",
    );
  }

  return mainWindow;
}

function setupWindowStatePersistence(
  mainWindow: BrowserWindow,
  isMaximized: boolean,
): void {
  mainWindow.on("close", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    saveWindowState({
      width: mainWindow.getBounds().width,
      height: mainWindow.getBounds().height,
      x: mainWindow.getBounds().x,
      y: mainWindow.getBounds().y,
      isMaximized: mainWindow.isMaximized(),
    });
  });

  if (isMaximized) {
    mainWindow.maximize();
  }
}

function setupUserAgent(mainWindow: BrowserWindow): void {
  modifyUserAgent(mainWindow);
}

function setupWindowLifecycle(mainWindow: BrowserWindow): void {
  // Handle Ctrl+W to close window
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.control && input.key.toLowerCase() === "w") {
      mainWindow?.close();
      event.preventDefault();
    }
  });

  // Clean up window reference when window is closed
  mainWindow.on("closed", () => {
    setMainWindow(null);
  });
}

function setupWindowNavigation(
  mainWindow: BrowserWindow,
  isMainWindow: boolean,
): void {
  // Enforce URL policy for main window (handles will-navigate, will-redirect, and setWindowOpenHandler)
  enforceUrlPolicy(mainWindow, isMainWindow);

  // Handle login page response to determine login status
  mainWindow.webContents.on("did-finish-load", async () => {
    const currentURL = mainWindow.webContents.getURL();
    if (currentURL === URLS.LOGIN_URL) {
      // Check if this is actually a login page or if user is logged in (redirects to 404)
      try {
        const content = await mainWindow.webContents.executeJavaScript(`
          document.body ? document.body.textContent : ''
        `);
        if (content && content.trim().toLowerCase().includes("not found")) {
          // This is a 404 page, user is logged in
          setStartedOnLoginPage(false);
          setUserLoggedIn(true);
          await safeLoadUrl(mainWindow, URLS.MESSAGES_INBOX_URL);
        } else {
          // Login page loaded normally, user is not logged in
          setStartedOnLoginPage(true);
          setUserLoggedIn(false);
        }
      } catch (error) {
        if (ENVIRONMENT.IS_DEVELOPMENT) {
          console.error("Failed to check login status:", error);
        }
        dialog.showErrorBox(
          "Failed to Verify Login Status",
          "If the problem persists, try clearing the browser cache by going to Help > Clear Browsing Data and Reset App.",
        );
        // Assume user is not logged in if we can't check content
        setStartedOnLoginPage(true);
        setUserLoggedIn(false);
      }
    }
  });

  // Detect login completion
  mainWindow.webContents.on("will-navigate", (_event, url) => {
    // Detect successful login and redirect to messages
    if (
      getStartedOnLoginPage() &&
      url.startsWith("https://www.facebook.com") &&
      url.includes("?lsrc=")
    ) {
      setStartedOnLoginPage(false);
      setUserLoggedIn(true);
      safeLoadUrl(mainWindow, URLS.MESSAGES_INBOX_URL).catch((error) => {
        let message = error instanceof Error ? error.message : String(error);

        if (message.includes("ERR_ABORTED") || message.includes("(-3)")) {
          return; // Ignore aborted navigation, as it may be caused by our URL policy
        }

        if (ENVIRONMENT.IS_DEVELOPMENT) {
          console.error("Failed to load messages inbox after login:", error);
        }

        dialog.showErrorBox(
          "Error",
          "Failed to load the messages page after login. Please try again.",
        );
      });
    }
  });

  // Detect logout completion
  mainWindow.webContents.on("will-redirect", (_event, url) => {
    // Detect logout and redirect to login
    if (
      !getStartedOnLoginPage() &&
      url.startsWith("https://www.facebook.com") &&
      url.includes("?stype=lo")
    ) {
      setStartedOnLoginPage(true);
      setUserLoggedIn(false);
      safeLoadUrl(mainWindow, URLS.LOGIN_URL).catch((error) => {
        let message = error instanceof Error ? error.message : String(error);

        if (message.includes("ERR_ABORTED") || message.includes("(-3)")) {
          return; // Ignore aborted navigation, as it may be caused by our URL policy
        }

        if (ENVIRONMENT.IS_DEVELOPMENT) {
          console.error("Failed to load login page after logout:", error);
        }

        dialog.showErrorBox(
          "Error",
          "Failed to load the messages page after login. Please try again.",
        );
      });
    }
  });

  // Normalize messages URL
  mainWindow.webContents.on("did-navigate", (_event, url) => {
    // Normalize specific conversation URLs to inbox
    normalizeMainWindowMessagesUrl(url).catch((error) => {
      let message = error instanceof Error ? error.message : String(error);

      if (message.includes("ERR_ABORTED") || message.includes("(-3)")) {
        return; // Ignore aborted navigation, as it may be caused by our URL policy
      }

      if (ENVIRONMENT.IS_DEVELOPMENT) {
        console.error("Failed to normalize messages URL:", error);
      }

      dialog.showErrorBox(
        "Error",
        "An unexpected error occurred while navigating to the messages page.",
      );
    });
  });

  // Prevent Facebook from changing the window title
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
  });
}
