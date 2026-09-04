// Access to Instagram's internal web API, using the logged-in session of the
// current tab. Every function returns a flat list of files to download.

export type MediaFile = { url: string; filename: string };

const BASE = "https://www.instagram.com";
const APP_ID = "936619743392459";
// doc_id of PolarisPostActionLoadPostQueryQuery. Used only as a fallback when
// /api/v1/media/{pk}/info/ fails; may need updating if Instagram rotates it.
const POST_DOC_ID = "8845758582119845";
const SHORTCODE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

type Version = { url: string; width: number; height: number };

type V1Item = {
  pk: string | number;
  media_type?: number;
  user?: { username?: string };
  image_versions2?: { candidates: Version[] };
  video_versions?: Version[];
  carousel_media?: V1Item[];
};

type GqlNode = {
  is_video: boolean;
  video_url?: string;
  display_url: string;
  owner?: { username?: string };
  edge_sidecar_to_children?: { edges: { node: GqlNode }[] };
};

type ProfileUser = {
  id: string;
  username: string;
  profile_pic_url: string;
  profile_pic_url_hd?: string;
};

/** Converts a post shortcode (from /p/, /reel/) to the numeric media pk. */
export function shortcodeToPk(shortcode: string): string {
  // Shortcodes longer than 11 chars carry extra sharing data after the pk.
  const code = shortcode.length > 11 ? shortcode.slice(0, 11) : shortcode;
  let pk = 0n;
  for (const char of code) {
    const index = SHORTCODE_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Shortcode inválido: ${shortcode}`);
    pk = pk * 64n + BigInt(index);
  }
  return pk.toString();
}

const csrfToken = () =>
  /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie)?.[1] ?? "";

async function api<T>(
  path: string,
  init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    body: init.body,
    credentials: "include",
    headers: {
      "x-ig-app-id": APP_ID,
      "x-csrftoken": csrfToken(),
      "x-requested-with": "XMLHttpRequest",
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`Instagram respondeu ${res.status}`);
  return res.json() as Promise<T>;
}

const extensionOf = (url: string) => {
  const ext = new URL(url).pathname.split(".").pop() ?? "";
  return /^[a-z0-9]{2,5}$/i.test(ext) ? ext : "bin";
};

const toFile = (url: string, base: string): MediaFile => ({
  url,
  filename: `${base}.${extensionOf(url)}`,
});

const largest = (versions: Version[] | undefined) =>
  versions?.length
    ? [...versions].sort((a, b) => b.width * b.height - a.width * a.height)[0]
    : undefined;

function fileFromV1(item: V1Item, base: string): MediaFile | null {
  const video = largest(item.video_versions);
  if (video) return toFile(video.url, base);
  const image = largest(item.image_versions2?.candidates);
  return image ? toFile(image.url, base) : null;
}

/** Flattens a v1 media item (single or carousel) into downloadable files. */
export function filesFromV1(item: V1Item, base: string): MediaFile[] {
  if (item.carousel_media?.length) {
    return item.carousel_media.flatMap(
      (child, i) => fileFromV1(child, `${base}_${i + 1}`) ?? [],
    );
  }
  const file = fileFromV1(item, base);
  return file ? [file] : [];
}

export async function resolvePost(shortcode: string): Promise<MediaFile[]> {
  try {
    const pk = shortcodeToPk(shortcode);
    const data = await api<{ items?: V1Item[] }>(`/api/v1/media/${pk}/info/`);
    const item = data.items?.[0];
    if (item) {
      const base = `${item.user?.username ?? "instagram"}_${shortcode}`;
      const files = filesFromV1(item, base);
      if (files.length) return files;
    }
  } catch {
    // Fall through to the GraphQL route.
  }
  return resolvePostGraphql(shortcode);
}

async function resolvePostGraphql(shortcode: string): Promise<MediaFile[]> {
  const body = new URLSearchParams({
    doc_id: POST_DOC_ID,
    variables: JSON.stringify({ shortcode }),
  });
  const data = await api<{ data?: { xdt_shortcode_media?: GqlNode | null } }>(
    "/graphql/query",
    {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    },
  );
  const node = data.data?.xdt_shortcode_media;
  if (!node) throw new Error("Post não encontrado (privado ou removido?)");
  const base = `${node.owner?.username ?? "instagram"}_${shortcode}`;
  const nodes = node.edge_sidecar_to_children?.edges.map((e) => e.node) ?? [node];
  return nodes.map((n, i) =>
    toFile(
      n.is_video && n.video_url ? n.video_url : n.display_url,
      nodes.length > 1 ? `${base}_${i + 1}` : base,
    ),
  );
}

async function profileInfo(username: string): Promise<ProfileUser> {
  const data = await api<{ data?: { user?: ProfileUser | null } }>(
    `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
  );
  if (!data.data?.user) throw new Error(`Perfil @${username} não encontrado`);
  return data.data.user;
}

export async function resolveProfilePic(username: string): Promise<MediaFile[]> {
  const user = await profileInfo(username);
  return [toFile(user.profile_pic_url_hd ?? user.profile_pic_url, `${user.username}_profile`)];
}

/**
 * owner is a username or "highlight:<id>". storyPk narrows to one item; when
 * absent, every item of the reel is returned.
 */
export async function resolveStory(owner: string, storyPk: string | null): Promise<MediaFile[]> {
  const reelId = owner.startsWith("highlight:") ? owner : (await profileInfo(owner)).id;
  type Reel = { items?: V1Item[]; user?: { username?: string } };
  const data = await api<{ reels?: Record<string, Reel>; reels_media?: Reel[] }>(
    `/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(reelId)}`,
  );
  const reel = data.reels?.[reelId] ?? data.reels_media?.[0];
  const items = storyPk
    ? reel?.items?.filter((item) => String(item.pk) === storyPk)
    : reel?.items;
  if (!items?.length) throw new Error("Story não encontrado (expirou?)");
  const name = reel?.user?.username ?? owner.replace(":", "_");
  return items.flatMap((item) => filesFromV1(item, `${name}_story_${item.pk}`));
}
