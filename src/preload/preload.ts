import { contextBridge, ipcRenderer } from "electron";

// DOM types are available in the preload script
declare const Node: typeof globalThis.Node;
declare const Text: typeof globalThis.Text;
declare const Element: typeof globalThis.Element;
declare const KeyboardEvent: typeof globalThis.KeyboardEvent;
declare const MouseEvent: typeof globalThis.MouseEvent;
declare const MutationObserver: typeof globalThis.MutationObserver;
declare const PopStateEvent: typeof globalThis.PopStateEvent;

function clickElement(node: Node | null): void {
  if (!node || typeof node.dispatchEvent !== "function") {
    return;
  }

  const element = node as HTMLElement;
  element.focus();
  element.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    }),
  );
}

function waitForElement(
  getElement: () => Element | null,
  timeoutMs = 1200,
  intervalMs = 50,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    const poll = () => {
      const element = getElement();
      if (element) {
        resolve(element);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }

      setTimeout(poll, intervalMs);
    };

    poll();
  });
}

function findProfileMenuButton(): Element | null {
  const navigation = document.querySelector('div[role="navigation"].x6s0dn4');
  if (!navigation) {
    return null;
  }

  const buttons = Array.from(
    navigation.querySelectorAll('div[role="button"]'),
  ).filter((button) => (button as HTMLElement).offsetParent !== null);

  return buttons[buttons.length - 1] || null;
}

function findLogoutMenuButton(): Element | null {
  const dialogs = Array.from(
    document.querySelectorAll('div[role="dialog"][aria-label]'),
  ).filter((dialog) => (dialog as HTMLElement).offsetParent !== null);

  const profileDialog = dialogs[dialogs.length - 1];
  if (!profileDialog) {
    return null;
  }

  const lists = Array.from(profileDialog.querySelectorAll('[role="list"]'));
  let bestItems: Element[] = [];

  for (const list of lists) {
    const items = Array.from(list.querySelectorAll('[role="listitem"]')).filter(
      (item) =>
        item.querySelector('div[role="button"]') &&
        (item as HTMLElement).offsetParent !== null,
    );
    if (items.length > bestItems.length) {
      bestItems = items;
    }
  }

  if (bestItems.length > 0) {
    const lastItem = bestItems[bestItems.length - 1];
    const button = lastItem.querySelector('div[role="button"]');
    if (button) {
      return button;
    }
  }

  const allVisibleButtons = Array.from(
    profileDialog.querySelectorAll('div[role="button"]'),
  ).filter((button) => (button as HTMLElement).offsetParent !== null);

  return allVisibleButtons[allVisibleButtons.length - 1] || null;
}

let logoutReloadTimeoutId: NodeJS.Timeout | null = null;

function scheduleMessagesReloadAfterLogout(delayMs = 700): void {
  if (logoutReloadTimeoutId !== null) {
    clearTimeout(logoutReloadTimeoutId);
  }

  logoutReloadTimeoutId = setTimeout(() => {
    logoutReloadTimeoutId = null;
    ipcRenderer.send("host:logout-initiated");
  }, delayMs);
}

function isLogoutButtonInteraction(node: unknown): boolean {
  if (!(node instanceof Element)) {
    return false;
  }

  const button = node.closest('div[role="button"]');
  if (!button) {
    return false;
  }

  const logoutButton = findLogoutMenuButton();
  if (!logoutButton) {
    return false;
  }

  return (
    button === logoutButton ||
    logoutButton.contains(button) ||
    button.contains(logoutButton)
  );
}

function handleDocumentClickForLogout(event: Event): void {
  if (!isLogoutButtonInteraction((event as MouseEvent)?.target)) {
    return;
  }

  scheduleMessagesReloadAfterLogout();
}

function handleDocumentKeydownForLogout(event: Event): void {
  if (!event) {
    return;
  }

  const keyEvent = event as KeyboardEvent;
  const isActivationKey = keyEvent.key === "Enter" || keyEvent.key === " ";
  if (!isActivationKey) {
    return;
  }

  if (!isLogoutButtonInteraction(keyEvent.target)) {
    return;
  }

  scheduleMessagesReloadAfterLogout();
}

async function logoutInPage(): Promise<void> {
  const profileButton = await waitForElement(findProfileMenuButton);
  if (!profileButton) {
    return;
  }

  clickElement(profileButton);

  const logoutButton = await waitForElement(findLogoutMenuButton, 1800);
  if (!logoutButton) {
    return;
  }

  clickElement(logoutButton); // This will trigger the click handler which schedules the reload after logout
}

window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("keydown", handleDocumentKeydownForLogout, true);
  document.addEventListener("click", handleDocumentClickForLogout, true);

  ipcRenderer.on("host:log-out", () => {
    logoutInPage().catch(() => {});
  });
});
