// Servidor de la colección Games 101: sirve la portada y los juegos, y monta el multijugador de cada juego.
// Uso:  deno task start      (o: deno run --allow-net --allow-read --allow-env server.ts)
//
// Para añadir un juego: crea su carpeta (con su index.html), añádelo a la portada (index.html) y,
// si tiene multijugador, registra aquí su módulo en MULTIPLAYER.

import { createMultiplayer as escondidasEnPintura } from "./escondidas-en-pintura/multiplayer.ts";

const PORT = Number(Deno.env.get("PORT") ?? 8000);
const ROOT = new URL("./", import.meta.url);

/** Juegos con multijugador: /<carpeta>/ws se conecta a su módulo. */
const MULTIPLAYER: Record<string, { upgrade(req: Request): Response; stats(): unknown }> = {
  "escondidas-en-pintura": escondidasEnPintura(),
};

/** Solo se sirven archivos de estos tipos (nunca el código del servidor ni archivos ocultos). */
const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  webmanifest: "application/manifest+json",
  woff2: "font/woff2",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

async function serveStatic(pathname: string): Promise<Response> {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return notFound();
  }
  if (path.split("/").some((part) => part.startsWith("."))) return notFound();
  if (/^\/deno\.(json|jsonc|lock)$/.test(path)) return notFound();
  if (path.endsWith("/")) path += "index.html";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const type = MIME[ext];
  if (!type) {
    // /carpeta sin barra final: si es un juego, redirige a /carpeta/ para que funcionen las rutas relativas
    if (!path.includes(".")) {
      try {
        const info = await Deno.stat(new URL("." + path + "/index.html", ROOT));
        if (info.isFile) return new Response(null, { status: 301, headers: { location: encodeURI(path + "/") } });
      } catch {
        // no es una carpeta con juego
      }
    }
    return notFound();
  }
  const url = new URL("." + path, ROOT);
  if (!url.href.startsWith(ROOT.href)) return notFound();
  try {
    const body = await Deno.readFile(url);
    return new Response(body, { headers: { "content-type": type, "cache-control": "no-cache" } });
  } catch {
    return notFound();
  }
}

function notFound(): Response {
  return new Response("No encontrado", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, (req) => {
  const url = new URL(req.url);
  const ws = url.pathname.match(/^\/([a-z0-9-]+)\/ws$/);
  if (ws && MULTIPLAYER[ws[1]]) return MULTIPLAYER[ws[1]].upgrade(req);
  if (url.pathname === "/health") {
    const games = Object.fromEntries(Object.entries(MULTIPLAYER).map(([name, m]) => [name, m.stats()]));
    return Response.json({ ok: true, games });
  }
  return serveStatic(url.pathname);
});

console.log(`🎮 Games 101 en http://localhost:${PORT}`);
