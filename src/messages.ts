export type DownloadRequest = { type: "download"; url: string; filename: string };
export type DownloadResponse = { ok: true } | { ok: false; error: string };
