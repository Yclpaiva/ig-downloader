import { resolvePost, resolveProfilePic, resolveStory, type MediaFile } from "./instagram";
import type { DownloadRequest, DownloadResponse } from "./messages";

type Context =
  | { kind: "post"; shortcode: string }
  | { kind: "profile"; username: string }
  | { kind: "story"; owner: string; storyPk: string | null };

const HOST_ATTR = "data-igdl";
const MIN_SIZE = 100;
// Shortcodes are 6+ chars; the lower bound also rejects /reels/audio/.
const SHORTCODE_RE = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{6,})(?:[/?#]|$)/;
const STORY_RE = /^\/stories\/([^/]+)(?:\/([^/]+))?(?:\/(\d+))?/;
const RESERVED_PATHS = new Set(["explore", "reels", "stories", "direct", "accounts", "p", "reel", "tv"]);

const hosts = new WeakMap<Element, HTMLElement>();

const ICONS = {
  idle: `<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>`,
  loading: `<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>`,
  done: `<svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg>`,
  error: `<svg viewBox="0 0 24 24"><path d="M12 7v6"/><path d="M12 17h.01"/></svg>`,
};
type State = keyof typeof ICONS;

const STYLE = `
  button { all: unset; box-sizing: border-box; width: 32px; height: 32px; border-radius: 50%;
    background: rgba(0,0,0,.6); color: #fff; display: grid; place-items: center; cursor: pointer;
    opacity: .85; transition: opacity .15s, background .15s; }
  button:hover { opacity: 1; background: rgba(0,0,0,.85); }
  button[data-state="loading"] svg { animation: spin .8s linear infinite; }
  button[data-state="done"] { background: #1f8a4c; }
  button[data-state="error"] { background: #c0392b; }
  svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.2;
    stroke-linecap: round; stroke-linejoin: round; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

// --- context discovery -------------------------------------------------------

function codesIn(root: Element): Set<string> {
  const codes = new Set<string>();
  const anchors = root.matches("a[href]")
    ? [root]
    : Array.from(root.querySelectorAll("a[href]"));
  for (const a of anchors) {
    const match = SHORTCODE_RE.exec(a.getAttribute("href") ?? "");
    if (match?.[1]) codes.add(match[1]);
  }
  return codes;
}

/**
 * Climbs from the media until exactly one shortcode is linked in the subtree.
 * Two or more distinct codes means we left the post; fall back to the URL.
 */
function shortcodeNear(media: Element): string | null {
  let node: Element | null = media;
  while (node && node !== document.body) {
    const codes = codesIn(node);
    if (codes.size === 1) return codes.values().next().value ?? null;
    if (codes.size > 1 || node.tagName === "ARTICLE") break;
    node = node.parentElement;
  }
  return SHORTCODE_RE.exec(location.pathname)?.[1] ?? null;
}

function profileUsername(): string | null {
  const segment = location.pathname.split("/")[1] ?? "";
  return segment && !RESERVED_PATHS.has(segment) ? segment : null;
}

function storyContext(): Context | null {
  const match = STORY_RE.exec(location.pathname);
  if (!match?.[1]) return null;
  return match[1] === "highlights"
    ? { kind: "story", owner: `highlight:${match[2] ?? ""}`, storyPk: match[3] ?? null }
    : { kind: "story", owner: match[1], storyPk: match[2] ?? null };
}

/** Returns a lazy context getter, evaluated at click time so it never goes stale. */
function contextFor(media: HTMLElement): (() => Context | null) | null {
  if (media.closest("article") === null && media.closest("header") && media.tagName === "IMG") {
    return profileUsername()
      ? () => {
          const username = profileUsername();
          return username ? { kind: "profile", username } : null;
        }
      : null;
  }
  if (storyContext()) return storyContext;
  if (!shortcodeNear(media)) return null;
  return () => {
    const shortcode = shortcodeNear(media);
    return shortcode ? { kind: "post", shortcode } : null;
  };
}

// --- overlay -----------------------------------------------------------------

/** The element the media visually fills: climb while ancestors share its size. */
function frameFor(media: HTMLElement): HTMLElement {
  const { width, height } = media.getBoundingClientRect();
  let el = media.parentElement ?? media;
  while (el.parentElement && el.parentElement !== document.body) {
    const parent = el.parentElement;
    if (/^(ARTICLE|MAIN|SECTION|HEADER)$/.test(parent.tagName)) break;
    if (el.closest("ul") === null) {
      const rect = parent.getBoundingClientRect();
      if (Math.abs(rect.width - width) > 4 || Math.abs(rect.height - height) > 4) break;
    }
    el = parent;
  }
  return el;
}

const setState = (button: HTMLButtonElement, state: State, title: string) => {
  button.dataset.state = state;
  button.title = title;
  button.innerHTML = ICONS[state];
};

async function download(file: MediaFile): Promise<void> {
  const request: DownloadRequest = { type: "download", ...file };
  const response = (await chrome.runtime.sendMessage(request)) as DownloadResponse | undefined;
  if (!response?.ok) throw new Error(response?.error ?? "Falha ao iniciar o download");
}

const resolve = (ctx: Context): Promise<MediaFile[]> =>
  ctx.kind === "post"
    ? resolvePost(ctx.shortcode)
    : ctx.kind === "profile"
      ? resolveProfilePic(ctx.username)
      : resolveStory(ctx.owner, ctx.storyPk);

function mount(frame: HTMLElement, getContext: () => Context | null): HTMLElement {
  const existing = frame.querySelector<HTMLElement>(`:scope > [${HOST_ATTR}]`);
  if (existing) return existing;

  if (getComputedStyle(frame).position === "static") frame.style.position = "relative";

  const host = document.createElement("div");
  host.setAttribute(HOST_ATTR, "");
  host.style.cssText =
    "position:absolute;top:10px;right:10px;z-index:2147483647;width:32px;height:32px;line-height:0;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${STYLE}</style><button type="button"></button>`;
  const button = root.querySelector("button")!;
  setState(button, "idle", "Baixar");

  const swallow = (event: Event) => event.stopPropagation();
  for (const type of ["pointerdown", "mousedown", "mouseup", "touchstart", "dblclick"]) {
    button.addEventListener(type, swallow);
  }
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.state === "loading") return;
    setState(button, "loading", "Baixando…");
    try {
      const ctx = getContext();
      if (!ctx) throw new Error("Não encontrei a mídia deste item");
      const files = await resolve(ctx);
      for (const file of files) await download(file);
      setState(button, "done", `${files.length} arquivo(s) salvo(s) em Downloads/Instagram`);
    } catch (err) {
      setState(button, "error", err instanceof Error ? err.message : String(err));
    }
    setTimeout(() => setState(button, "idle", "Baixar"), 3000);
  });

  frame.appendChild(host);
  return host;
}

// --- scanning ----------------------------------------------------------------

/** Images still loading render blank; a button over them looks like a broken grid. */
const isPending = (media: HTMLElement) =>
  media instanceof HTMLImageElement && !(media.complete && media.naturalWidth > 0);

function scan() {
  if (/^\/(direct|accounts)\//.test(location.pathname)) return;
  for (const media of document.querySelectorAll<HTMLElement>("img, video")) {
    if (hosts.get(media)?.isConnected || isPending(media)) continue;
    const rect = media.getBoundingClientRect();
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) continue;
    const getContext = contextFor(media);
    if (!getContext) continue;
    hosts.set(media, mount(frameFor(media), getContext));
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    scan();
  }, 400);
}

new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("scroll", schedule, { passive: true });
window.addEventListener("resize", schedule);
// `load` doesn't bubble; capture it so images that finish loading get their button.
document.addEventListener("load", schedule, true);
schedule();
