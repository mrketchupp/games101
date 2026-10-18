// Publica únicamente los archivos del juego, sin código del servidor ni archivos locales.
const root = new URL('../', import.meta.url);
const output = new URL('_site/', root);
try {
  await Deno.remove(output, { recursive: true });
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}
await Deno.mkdir(output, { recursive: true });
await Deno.copyFile(new URL('index.html', root), new URL('index.html', output));
await Deno.writeTextFile(new URL('.nojekyll', output), '');

const game = 'escondidas-en-pintura/';
async function copyPublicFiles(path: string) {
  await Deno.mkdir(new URL(path, output), { recursive: true });
  for await (const entry of Deno.readDir(new URL(path, root))) {
    if (entry.isDirectory && path === game && ['art', 'obras'].includes(entry.name)) {
      await copyPublicFiles(path + entry.name + '/');
    } else if (entry.isFile && /\.(html|css|js|svg|png|jpg|webp|ico|woff2|mp3|ogg|wav)$/.test(entry.name)) {
      await Deno.copyFile(new URL(path + entry.name, root), new URL(path + entry.name, output));
    }
  }
}
await copyPublicFiles(game);
console.log('Sitio de GitHub Pages preparado en _site/');
