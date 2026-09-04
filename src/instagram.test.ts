import { describe, expect, test } from "bun:test";
import { filesFromV1, shortcodeToPk } from "./instagram";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const pkToShortcode = (pk: bigint) => {
  let code = "";
  for (let n = pk; n > 0n; n /= 64n) code = ALPHABET[Number(n % 64n)] + code;
  return code;
};

describe("shortcodeToPk", () => {
  test("decodes base64url digits", () => {
    expect(shortcodeToPk("B")).toBe("1");
    expect(shortcodeToPk("BA")).toBe("64");
    expect(shortcodeToPk("_")).toBe("63");
  });

  test("round-trips a realistic 19-digit pk", () => {
    const pk = 3_412_345_678_901_234_567n;
    expect(shortcodeToPk(pkToShortcode(pk))).toBe(pk.toString());
  });

  test("ignores the sharing suffix of long shortcodes", () => {
    const code = pkToShortcode(3_412_345_678_901_234_567n);
    expect(code).toHaveLength(11);
    expect(shortcodeToPk(`${code}abcdefgh`)).toBe(shortcodeToPk(code));
  });

  test("rejects invalid characters", () => {
    expect(() => shortcodeToPk("abc/def")).toThrow();
  });
});

describe("filesFromV1", () => {
  const image = (w: number) => ({ url: `https://cdn/x${w}.jpg`, width: w, height: w });
  const video = (w: number) => ({ url: `https://cdn/v${w}.mp4`, width: w, height: w });

  test("prefers video and picks the largest version", () => {
    const files = filesFromV1(
      { pk: 1, video_versions: [video(480), video(1080)], image_versions2: { candidates: [image(1080)] } },
      "user_CODE",
    );
    expect(files).toEqual([{ url: "https://cdn/v1080.mp4", filename: "user_CODE.mp4" }]);
  });

  test("numbers carousel children", () => {
    const files = filesFromV1(
      {
        pk: 1,
        carousel_media: [
          { pk: 2, image_versions2: { candidates: [image(640), image(1080)] } },
          { pk: 3, video_versions: [video(720)] },
        ],
      },
      "user_CODE",
    );
    expect(files.map((f) => f.filename)).toEqual(["user_CODE_1.jpg", "user_CODE_2.mp4"]);
    expect(files[0]?.url).toBe("https://cdn/x1080.jpg");
  });
});
