import { BrowserWindow, dialog } from "electron";
import { ENVIRONMENT } from "../shared/constants";

export async function safeLoadUrl(
  window: BrowserWindow,
  url: string,
): Promise<void> {
  if (!window || window.isDestroyed()) {
    return;
  }

  try {
    await window.loadURL(url);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    if (ENVIRONMENT.IS_DEVELOPMENT) {
      console.error("Failed to load URL with non-error object:", error);
    }

    dialog.showErrorBox(
      "Error",
      "An unexpected error occurred while loading the page.",
    );
  }
}
