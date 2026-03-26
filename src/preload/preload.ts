import { contextBridge, ipcRenderer } from "electron";

// DOM types are available in the preload script
declare const Node: typeof globalThis.Node;
declare const Text: typeof globalThis.Text;
declare const Element: typeof globalThis.Element;
declare const KeyboardEvent: typeof globalThis.KeyboardEvent;
declare const MouseEvent: typeof globalThis.MouseEvent;
declare const MutationObserver: typeof globalThis.MutationObserver;
declare const PopStateEvent: typeof globalThis.PopStateEvent;

interface MessagePreview {
  sender: string;
  text: string;
  conversationId: string;
  conversationPath: string;
  avatarUrl: string;
}

interface NavigatePayload {
  conversationPath?: string;
  conversationId?: string;
}

function getRenderedText(node: Node | null): string {
  if (!node) {
    return "";
  }

  const parts: string[] = [];

  const walk = (currentNode: Node | null) => {
    if (!currentNode) {
      return;
    }

    if (currentNode.nodeType === Node.TEXT_NODE) {
      const value = ((currentNode as Text).nodeValue || "").replace(
        /\s+/g,
        " ",
      );
      if (value.trim()) {
        parts.push(value);
      }
      return;
    }

    if (currentNode.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = currentNode as Element;

    if (element.tagName === "IMG") {
      const alt = (element.getAttribute("alt") || "").trim();
      if (alt) {
        parts.push(alt);
      }
      return;
    }

    const children = Array.from(element.childNodes);
    for (const child of children) {
      walk(child);
    }
  };

  walk(node);

  return parts
    .join(" ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function getConversationIdFromElement(element: Element | null): string {
  if (!element) {
    return "";
  }

  const threadLink = element.querySelector(
    'a[href*="/messages/e2ee/t/"], a[href*="/messages/t/"]',
  );
  if (!threadLink || typeof threadLink.getAttribute !== "function") {
    return "";
  }

  const href = threadLink.getAttribute("href") || "";
  const match = href.match(/\/messages\/(?:e2ee\/)?t\/([^/?#]+)/);
  return match ? match[1] : "";
}

function getConversationPathFromElement(element: Element | null): string {
  if (!element) {
    return "";
  }

  const threadLink = element.querySelector(
    'a[href*="/messages/e2ee/t/"], a[href*="/messages/t/"]',
  );
  if (!threadLink || typeof threadLink.getAttribute !== "function") {
    return "";
  }

  const href = threadLink.getAttribute("href") || "";
  const match = href.match(/(\/messages\/(?:e2ee\/)?t\/[^/?#]+)\/?/);
  return match ? match[1] : "";
}

function getAvatarUrlFromElement(element: Element | null): string {
  if (!element) {
    return "";
  }

  const avatarCandidates = Array.from(
    element.querySelectorAll(
      'a[href*="/messages/"] img[src], img[src*="fbcdn.net"]',
    ),
  );

  for (const image of avatarCandidates) {
    const src = (image.getAttribute("src") || "").trim();
    if (!src) {
      continue;
    }

    if (src.includes("emoji.php")) {
      continue;
    }

    const width = Number.parseInt(image.getAttribute("width") || "0", 10);
    const height = Number.parseInt(image.getAttribute("height") || "0", 10);
    if ((width > 0 && width < 24) || (height > 0 && height < 24)) {
      continue;
    }

    return src;
  }

  return "";
}

interface UnreadSummary {
  container: Element;
  messageNode: Element;
}

function isUnreadRow(row: Element | null): boolean {
  if (!row) {
    return false;
  }

  const unreadSummary = findUnreadSummaryNode(row);
  if (unreadSummary) {
    return true;
  }

  const unreadMarker = Array.from(row.querySelectorAll("div, span")).find(
    (node) => getRenderedText(node).trim() === "Unread message:",
  );

  return Boolean(unreadMarker);
}

function findUnreadSummaryNode(row: Element | null): UnreadSummary | null {
  if (!row) {
    return null;
  }

  const candidateSpans = Array.from(row.querySelectorAll("span"));
  for (const span of candidateSpans) {
    const children = Array.from(span.children);
    if (children.length < 2) {
      continue;
    }

    const hasLeadingLabel = children.some(
      (child) =>
        child.tagName === "DIV" && getRenderedText(child).trim().length > 0,
    );
    if (!hasLeadingLabel) {
      continue;
    }

    const messageChild = children.find(
      (child) =>
        child.matches?.('span[dir="auto"]') &&
        getRenderedText(child).trim().length > 0,
    );

    if (messageChild) {
      return {
        container: span,
        messageNode: messageChild as Element,
      };
    }
  }

  return null;
}

function isMutedRow(row: Element | null): boolean {
  if (!row) {
    return false;
  }

  if (row.querySelector('svg[style*="--x-color: var(--disabled-icon)"]')) {
    return true;
  }

  if (row.querySelector('path[d^="M2.5 6c0-.322"]')) {
    return true;
  }

  return false;
}

function getThreadRows(): Element[] {
  const rows = Array.from(document.querySelectorAll('div[role="row"]'));
  return rows.filter((row) => {
    const link = row.querySelector(
      'a[href*="/messages/e2ee/t/"], a[href*="/messages/t/"]',
    );
    return Boolean(link);
  });
}

function getUnreadRows(): Element[] {
  return getThreadRows().filter((row) => isUnreadRow(row));
}

function extractPreviewFromThreadRow(
  row: Element | null,
): MessagePreview | null {
  if (!row) {
    return null;
  }

  const unreadSummary = findUnreadSummaryNode(row as Element);
  const unreadMarker = unreadSummary?.container;

  let messageText = "";
  if (unreadSummary?.messageNode) {
    messageText = getRenderedText(unreadSummary.messageNode).trim();
  } else if (unreadMarker) {
    const messageNode =
      unreadMarker.parentElement?.querySelector('span[dir="auto"]');
    if (messageNode) {
      messageText = getRenderedText(messageNode).trim();
    }
  }

  const senderNodes = Array.from(row.querySelectorAll('span[dir="auto"]'))
    .map((node) => getRenderedText(node).trim())
    .filter(Boolean)
    .filter((text) => text !== "Unread message:")
    .filter((text) => !text.includes(" · "))
    .filter((text) => text.length <= 120);

  const sender = senderNodes[0] || "";

  const textNodes = Array.from(
    row.querySelectorAll("span[dir='auto'], div[dir='auto']"),
  )
    .map((node) => getRenderedText(node))
    .filter(Boolean)
    .filter((text) => text.length <= 240);

  if (textNodes.length === 0) {
    if (!sender || !messageText) {
      return null;
    }
  }

  const text = messageText || textNodes[1] || textNodes[0] || "";

  if (!sender && !text) {
    return null;
  }

  return {
    sender,
    text,
    conversationId: getConversationIdFromElement(row as Element),
    conversationPath: getConversationPathFromElement(row as Element),
    avatarUrl: getAvatarUrlFromElement(row as Element),
  };
}

function countUnreadConversationRows(): number | null {
  const threadRows = getThreadRows();
  if (threadRows.length === 0) {
    return null;
  }

  return threadRows.filter((row) => isUnreadRow(row)).length;
}

function findBestThreadRow(): MessagePreview | null {
  const unreadRows = getUnreadRows();
  for (const row of unreadRows) {
    if (isMutedRow(row)) {
      continue;
    }

    const preview = extractPreviewFromThreadRow(row);
    if (preview) {
      return preview;
    }
  }

  return null;
}

function trackLatestMessagePreview(): void {
  let lastSentKey = "";
  let lastUnreadRowCount = -1;

  const pushPreview = () => {
    const unreadRowCount = countUnreadConversationRows();
    if (unreadRowCount !== null && unreadRowCount !== lastUnreadRowCount) {
      lastUnreadRowCount = unreadRowCount;
      ipcRenderer.send("host:unread-count", unreadRowCount);
    }

    const preview = findBestThreadRow();
    if (!preview) {
      return;
    }

    const key = `${preview.conversationId}|${preview.sender}|${preview.text}`;
    if (key === lastSentKey) {
      return;
    }

    lastSentKey = key;
    ipcRenderer.send("host:message-preview", preview, unreadRowCount);
  };

  const observer = new MutationObserver(() => {
    pushPreview();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  pushPreview();
}

function navigateToConversationInPage(payload: NavigatePayload | null): void {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const conversationPath =
    typeof payload.conversationPath === "string"
      ? payload.conversationPath.trim()
      : "";
  const conversationId =
    typeof payload.conversationId === "string"
      ? payload.conversationId.trim()
      : "";

  const candidatePaths: string[] = [];
  if (conversationPath) {
    candidatePaths.push(conversationPath);
  }
  if (conversationId) {
    candidatePaths.push(`/messages/e2ee/t/${conversationId}`);
    candidatePaths.push(`/messages/t/${conversationId}`);
  }

  for (const path of candidatePaths) {
    const link = document.querySelector(`a[href*="${path}"]`);
    if (!link) {
      continue;
    }

    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
    return;
  }

  if (conversationPath) {
    history.pushState({}, "", conversationPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

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
  trackLatestMessagePreview();

  document.addEventListener("keydown", handleDocumentKeydownForLogout, true);
  document.addEventListener("click", handleDocumentClickForLogout, true);

  ipcRenderer.on("host:navigate-to-conversation", (_event, payload) => {
    navigateToConversationInPage(payload);
  });

  ipcRenderer.on("host:log-out", () => {
    logoutInPage().catch(() => {});
  });
});

contextBridge.exposeInMainWorld("poodolHost", {
  ping: () => {
    const unreadRowCount = countUnreadConversationRows();
    if (unreadRowCount !== null) {
      ipcRenderer.send("host:unread-count", unreadRowCount);
    }
  },
});
