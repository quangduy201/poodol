import { shell, BrowserWindow } from "electron";
import path from "path";

import {
  ALLOWED_IN_APP_HOSTS,
  ALLOWED_MAIN_WINDOW_PATH_PREFIXES,
  URLS,
} from "../shared/constants";
import { parseHttpUrl } from "../shared/utils";

function isAllowedInAppUrl(urlString: string): boolean {
  const parsedUrl = parseHttpUrl(urlString);
  if (!parsedUrl) {
    return false;
  }

  return ALLOWED_IN_APP_HOSTS.some((host) => parsedUrl.hostname === host);
}

function isAllowedInMainWindow(urlString: string): boolean {
  const parsedUrl = parseHttpUrl(urlString);
  if (!parsedUrl) {
    return false;
  }

  if (parsedUrl.hostname !== "www.facebook.com") {
    return false;
  }

  const pathname = parsedUrl.pathname;

  // Allow root path
  if (pathname === "/" || pathname === "") {
    return true;
  }

  // Allow endpoints with specific path prefixes
  return ALLOWED_MAIN_WINDOW_PATH_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}

export function openInDefaultBrowserIfSupported(urlString: string): void {
  const parsedUrl = parseHttpUrl(urlString);
  if (!parsedUrl) {
    return;
  }

  shell.openExternal(parsedUrl.toString());
}

export function openNewWindow(url: string): void {
  const newWin = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  newWin.loadURL(url);
}

export function enforceUrlPolicy(
  browserWindow: BrowserWindow,
  isMainWindow = false,
): void {
  const webContents = browserWindow.webContents;

  webContents.on("will-navigate", (event, url) => {
    if (!isMainWindow || isAllowedInMainWindow(url)) {
      return;
    }

    event.preventDefault();
    if (isAllowedInAppUrl(url)) {
      openNewWindow(url);
    } else {
      openInDefaultBrowserIfSupported(url);
    }
  });

  webContents.on("will-redirect", (event, url) => {
    if (!isMainWindow || isAllowedInMainWindow(url)) {
      return;
    }

    event.preventDefault();
    if (isAllowedInAppUrl(url)) {
      openNewWindow(url);
    } else {
      openInDefaultBrowserIfSupported(url);
    }
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (url === URLS.ABOUT_BLANK_URL) {
      return { action: "allow" };
    }

    if (isAllowedInMainWindow(url)) {
      openNewWindow(url);
      return { action: "deny" };
    }

    if (isAllowedInAppUrl(url)) {
      openNewWindow(url);
      return { action: "deny" };
    }

    openInDefaultBrowserIfSupported(url);
    return { action: "deny" };
  });
}
