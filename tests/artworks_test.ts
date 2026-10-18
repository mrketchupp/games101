import "../escondidas-en-pintura/artworks.js";
import "../escondidas-en-pintura/bot-ai.js";
import "../escondidas-en-pintura/room.js";

type Work = {
  id: string;
  artist: string;
  file: string | null;
  downloadPath: string;
  imageUrl: string;
  source: string;
  metadataSource: string;
  publicDomain: boolean;
  license: string;
  expectedSha256?: string;
  sourceCommit?: string;
};
const { HumanArt, HideRoom } = globalThis as unknown as {
  HumanArt: { works: Work[] };
  HideRoom: { ARTWORK_COUNT: number };
};

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("artwork catalog indices match the persistent room deck", () => {
  assert(
    HumanArt.works.length === HideRoom.ARTWORK_COUNT,
    "Every room index has an artwork",
  );
  assert(
    HumanArt.works.slice(0, 24).map((work) => work.id).join(",") ===
      [
        436535,
        45434,
        435882,
        437326,
        435809,
        436141,
        436105,
        437881,
        436965,
        436839,
        437153,
        437394,
        437251,
        12127,
        10497,
        10154,
        11417,
        10159,
        435997,
        36131,
        37880,
        45317,
        452183,
        37800,
      ].map((id) => `met-${id}`).join(","),
    "Existing room indices must continue to identify the same artworks",
  );
});

Deno.test("all selected artwork bytes are present and match the reviewed manifest", async () => {
  type Record = {
    id: string;
    file: string;
    sha256: string;
    width: number;
    height: number;
  };
  const manifest: Record[] = JSON.parse(
    await Deno.readTextFile(
      new URL("../escondidas-en-pintura/art/downloads.json", import.meta.url),
    ),
  );
  const byId = new Map(manifest.map((entry) => [entry.id, entry]));
  assert(
    byId.size === manifest.length && manifest.length === HumanArt.works.length,
    "The manifest covers every selected artwork exactly once",
  );
  for (const work of HumanArt.works) {
    const entry = byId.get(work.id);
    assert(
      entry && entry.file === work.file,
      "The selected local path belongs to its verified artwork",
    );
    const bytes = await Deno.readFile(
      new URL("../escondidas-en-pintura/" + entry.file, import.meta.url),
    );
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const actual = Array.from(
      digest,
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    assert(
      actual === entry.sha256,
      `Artwork bytes differ from the manifest: ${work.id}`,
    );
    assert(
      entry.width > 0 && entry.height > 0,
      "Image dimensions are recorded",
    );
    if (entry.file.endsWith(".webp")) {
      const ascii = new TextDecoder("ascii");
      assert(
        ascii.decode(bytes.subarray(0, 4)) === "RIFF" &&
          ascii.decode(bytes.subarray(8, 12)) === "WEBP",
        "Commons image has the expected WebP header",
      );
    } else {
      assert(
        bytes[0] === 0xff && bytes[1] === 0xd8,
        "Met image has the expected JPEG header",
      );
    }
  }
});

Deno.test("artwork collection is varied and has no duplicate entries or images", () => {
  const works = HumanArt.works;
  assert(
    works.length >= 35,
    "The combined collection contains at least 35 artworks",
  );
  assert(
    new Set(works.map((work) => work.id)).size === works.length,
    "Artwork IDs are unique",
  );
  assert(
    new Set(works.map((work) => work.imageUrl)).size === works.length,
    "Reproductions are not duplicated",
  );
  assert(
    new Set(works.map((work) => work.artist)).size >= 12,
    "The collection represents a variety of artists",
  );
});

Deno.test("artworks declare public-domain sources and usable image destinations", () => {
  for (const work of HumanArt.works) {
    const commons = work.id.startsWith("commons-");
    assert(work.publicDomain, "Only public-domain reproductions belong here");
    assert(
      work.license === (commons ? "Public domain" : "CC0 1.0"),
      "Rights labels distinguish Commons public domain and Met CC0",
    );
    assert(
      new URL(work.source).origin ===
        (commons
          ? "https://commons.wikimedia.org"
          : "https://www.metmuseum.org"),
      "Credits link to the original collection",
    );
    assert(
      new URL(work.imageUrl).origin ===
        (commons
          ? "https://raw.githubusercontent.com"
          : "https://images.metmuseum.org"),
      "Remote images use verified HTTPS sources",
    );
    assert(
      new URL(work.metadataSource).origin ===
        (commons
          ? "https://commons.wikimedia.org"
          : "https://collectionapi.metmuseum.org"),
      "Rights metadata has an official source",
    );
    assert(
      /^(art\/[a-z0-9-]+\.jpg|obras\/[a-z0-9-]+\.webp)$/.test(
        work.downloadPath,
      ),
      "Local output stays inside the selected artwork directory",
    );
    assert(
      work.file === null || work.file === work.downloadPath,
      "The client uses remote images or the verified local file",
    );
    if (commons) {
      assert(
        /^[a-f0-9]{64}$/.test(work.expectedSha256 || ""),
        "A converted Commons image has a pinned checksum",
      );
      assert(
        work.sourceCommit === "9d0cf37637eab51be46a5177cbf214287de2da9c",
        "Claude's reviewed artwork bytes stay pinned",
      );
    }
  }
});
