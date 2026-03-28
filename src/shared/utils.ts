export function parseHttpUrl(urlString: string): URL | null {
  try {
    const parsedUrl = new URL(urlString);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    return parsedUrl;
  } catch {
    return null;
  }
}

export function isValidHttpUrl(urlString: string): boolean {
  return parseHttpUrl(urlString) !== null;
}
