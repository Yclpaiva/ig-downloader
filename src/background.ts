import type { DownloadRequest, DownloadResponse } from "./messages";

const sanitize = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "_");

chrome.runtime.onMessage.addListener(
  (message: DownloadRequest, _sender, sendResponse: (r: DownloadResponse) => void) => {
    if (message?.type !== "download") return false;
    chrome.downloads
      .download({
        url: message.url,
        filename: `Instagram/${sanitize(message.filename)}`,
        conflictAction: "uniquify",
        saveAs: false,
      })
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
    return true;
  },
);
