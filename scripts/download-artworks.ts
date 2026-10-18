// Descarga únicamente las obras verificadas del catálogo; mantiene TLS y no necesita claves.
// Permisos y atribuciones: escondidas-en-pintura/art/CREDITS.md.
const game = new URL('../escondidas-en-pintura/', import.meta.url);
const catalogUrl = new URL('artworks.js', game);
const source = await Deno.readTextFile(catalogUrl);
const marker = 'globalThis.HumanArt = ';
const assignment = source.indexOf(marker);
if (assignment < 0) throw new Error('No se encontró el catálogo de obras.');

interface Work {
  id: string;
  title: string;
  artist: string;
  source: string;
  file: string | null;
  downloadPath: string;
  imageUrl: string;
  metadataSource: string;
  publicDomain: boolean;
  license: string;
  licenseUrl: string;
  commonsTitle?: string;
  originalImageUrl?: string;
  originalSha1?: string;
  expectedSha256?: string;
  sourceCommit?: string;
}

interface CommonsPage {
  pageid?: number;
  ns?: number;
  title?: string;
  missing?: unknown;
  invalid?: unknown;
  imageinfo?: {
    url?: string;
    descriptionurl?: string;
    sha1?: string;
    width?: number;
    height?: number;
    size?: number;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

const catalog: { works: Work[] } = JSON.parse(
  source.slice(assignment + marker.length).trim().replace(/;$/, ''),
);
if (!Array.isArray(catalog.works) || catalog.works.length === 0) {
  throw new Error('El catálogo debe contener al menos una obra.');
}
if (new Set(catalog.works.map((work) => work.id)).size !== catalog.works.length ||
  new Set(catalog.works.map((work) => work.downloadPath)).size !== catalog.works.length) {
  throw new Error('Los identificadores y las rutas de las obras deben ser únicos.');
}

async function readVerified(
  url: string,
  maxBytes: number,
  imageType?: 'image/jpeg' | 'image/webp',
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: { 'User-Agent': 'games101-artworks/1.0 (https://github.com/mrketchupp/games101)' },
  });
  if (!response.ok) throw new Error(`${response.status} al obtener ${url}`);
  if (imageType && response.headers.get('content-type')?.split(';')[0].trim() !== imageType) {
    throw new Error(`La respuesta no es ${imageType}: ${url}`);
  }
  if (!response.body) throw new Error(`Respuesta sin contenido: ${url}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error(`La descarga supera ${maxBytes} bytes: ${url}`);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.length < 10) {
    throw new Error('Firma JPEG inválida.');
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('Marcador JPEG inválido.');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw new Error('Segmento JPEG inválido.');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (width < 1 || height < 1) throw new Error('Dimensiones JPEG inválidas.');
      return { width, height };
    }
    offset += length;
  }
  throw new Error('No se encontró una cabecera JPEG admitida.');
}

function webpSize(bytes: Uint8Array): { width: number; height: number } {
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 20 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') {
    throw new Error('Firma WebP inválida.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error('Longitud RIFF inválida.');
  let dimensions: { width: number; height: number } | undefined;
  let canvas: { width: number; height: number } | undefined;
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('Cabecera de bloque WebP incompleta.');
    const chunk = tag(offset);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    const paddedEnd = end + (length % 2);
    if (paddedEnd > bytes.length || (length % 2 && bytes[end] !== 0)) {
      throw new Error('Longitud o relleno de bloque WebP inválidos.');
    }
    if (chunk === 'VP8X') {
      if (offset !== 12 || length !== 10 || (bytes[start] & 0xc3) ||
        bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) {
        throw new Error('Cabecera WebP extendida inválida o animada.');
      }
      const uint24 = (at: number) => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
      canvas = { width: uint24(start + 4) + 1, height: uint24(start + 7) + 1 };
    } else if (chunk === 'VP8 ' || chunk === 'VP8L') {
      if (dimensions) throw new Error('La imagen WebP contiene varios fotogramas.');
      if (chunk === 'VP8 ') {
        if (length < 10 || (bytes[start] & 1) || bytes[start + 3] !== 0x9d ||
          bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) {
          throw new Error('Cabecera VP8 inválida.');
        }
        dimensions = {
          width: view.getUint16(start + 6, true) & 0x3fff,
          height: view.getUint16(start + 8, true) & 0x3fff,
        };
      } else {
        if (length < 5 || bytes[start] !== 0x2f) throw new Error('Cabecera VP8L inválida.');
        const bits = view.getUint32(start + 1, true);
        if (bits >>> 29) throw new Error('Versión VP8L no admitida.');
        dimensions = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
    } else if (chunk === 'ANIM' || chunk === 'ANMF') {
      throw new Error('No se admiten reproducciones WebP animadas.');
    }
    offset = paddedEnd;
  }
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1 ||
    (canvas && (canvas.width !== dimensions.width || canvas.height !== dimensions.height))) {
    throw new Error('Dimensiones WebP inválidas o incoherentes.');
  }
  return dimensions;
}

function originalImageIdentity(value: string): string {
  const url = new URL(value);
  if (url.origin !== 'https://upload.wikimedia.org' || url.username || url.password || url.hash ||
    !url.pathname.startsWith('/wikipedia/commons/')) {
    throw new Error('La reproducción original no procede de Wikimedia Commons.');
  }
  // La API añade parámetros UTM; la identidad del original depende de su ruta y de su SHA-1.
  return url.origin + url.pathname;
}

async function verifyCommons(work: Work): Promise<void> {
  const commit = '9d0cf37637eab51be46a5177cbf214287de2da9c';
  const expectedDownload =
    `https://raw.githubusercontent.com/mrketchupp/games101/${commit}/escondidas-en-pintura/${work.downloadPath}`;
  if (!/^commons-[a-z0-9-]+$/.test(work.id) || !/^obras\/[a-z0-9-]+\.webp$/.test(work.downloadPath) ||
    work.imageUrl !== expectedDownload || work.sourceCommit !== commit ||
    !/^[a-f0-9]{64}$/.test(work.expectedSha256 || '') || !/^[a-f0-9]{40}$/.test(work.originalSha1 || '') ||
    !work.originalImageUrl || !work.commonsTitle || work.publicDomain !== true ||
    work.license !== 'Public domain' || work.licenseUrl !== 'https://creativecommons.org/publicdomain/mark/1.0/') {
    throw new Error(`Origen, huellas o permiso Commons inválidos: ${work.id}`);
  }
  const fileUrl = new URL(work.source);
  const metadataUrl = new URL(work.metadataSource);
  const params = metadataUrl.searchParams;
  const imageProperties = params.get('iiprop')?.split('|') || [];
  const titleFromUrl = decodeURIComponent(fileUrl.pathname.slice('/wiki/'.length)).replaceAll('_', ' ');
  if (fileUrl.origin !== 'https://commons.wikimedia.org' || !fileUrl.pathname.startsWith('/wiki/File:') ||
    fileUrl.username || fileUrl.password || fileUrl.search || fileUrl.hash ||
    metadataUrl.origin !== fileUrl.origin || metadataUrl.pathname !== '/w/api.php' ||
    metadataUrl.username || metadataUrl.password || metadataUrl.hash ||
    params.get('action') !== 'query' || params.get('format') !== 'json' || params.get('prop') !== 'imageinfo' ||
    imageProperties.length !== 4 || !['extmetadata', 'size', 'sha1', 'url'].every((p) => imageProperties.includes(p)) ||
    params.get('titles') !== work.commonsTitle || work.commonsTitle !== titleFromUrl ||
    [...params.keys()].some((key) => params.getAll(key).length !== 1)) {
    throw new Error(`La fuente oficial Commons ha cambiado: ${work.id}`);
  }
  const metadata: { error?: unknown; query?: { pages?: Record<string, CommonsPage> } } = JSON.parse(
    new TextDecoder().decode(await readVerified(work.metadataSource, 1024 * 1024)),
  );
  const pages = Object.values(metadata.query?.pages || {});
  const page = pages[0];
  const image = page?.imageinfo?.[0];
  const rights = image?.extmetadata;
  if (metadata.error || pages.length !== 1 || !page || !page.pageid || page.pageid < 1 || page.ns !== 6 ||
    'missing' in page || 'invalid' in page || page.title !== work.commonsTitle || page.imageinfo?.length !== 1 ||
    !image || rights?.LicenseShortName?.value !== 'Public domain' || rights?.UsageTerms?.value !== 'Public domain' ||
    rights?.Copyrighted?.value !== 'False' || image.descriptionurl !== work.source ||
    image.sha1 !== work.originalSha1 || !image.url ||
    originalImageIdentity(image.url) !== originalImageIdentity(work.originalImageUrl) ||
    !Number.isSafeInteger(image.width) || (image.width || 0) < 1 ||
    !Number.isSafeInteger(image.height) || (image.height || 0) < 1 ||
    !Number.isSafeInteger(image.size) || (image.size || 0) < 1) {
    throw new Error(`No se confirmó el original o el dominio público en Commons: ${work.id}`);
  }
}

async function verifyMet(work: Work): Promise<void> {
  const match = /^met-(\d+)$/.exec(work.id);
  if (!match || !/^art\/[a-z0-9-]+\.jpg$/.test(work.downloadPath)) {
    throw new Error(`Identificador o ruta local inválidos: ${work.id}`);
  }
  const expectedMetadata = `https://collectionapi.metmuseum.org/public/collection/v1/objects/${match[1]}`;
  if (work.metadataSource !== expectedMetadata) throw new Error('La fuente oficial ha cambiado.');
  const metadata = JSON.parse(new TextDecoder().decode(await readVerified(expectedMetadata, 1024 * 1024)));
  if (metadata.objectID !== Number(match[1]) || metadata.isPublicDomain !== true || !metadata.primaryImageSmall ||
    work.publicDomain !== true || work.license !== 'CC0 1.0' ||
    work.licenseUrl !== 'https://creativecommons.org/publicdomain/zero/1.0/') {
    throw new Error(`No se confirmó dominio público: ${work.id}`);
  }
  // En algunos manuscritos el primer nombre es el autor del poema: acreditamos a los pintores.
  const pictorialArtists = (metadata.constituents || [])
    .filter((person: { role: string }) => person.role === 'Artist')
    .map((person: { name: string }) => person.name.replaceAll('&#39;', "'"));
  const artist = metadata.artistRole === 'Author'
    ? pictorialArtists.join('; ') || 'Artista no identificado'
    : metadata.artistDisplayName || 'Artista no identificado';
  if (!metadata.primaryImageSmall.startsWith('https://images.metmuseum.org/CRDImages/') ||
    work.imageUrl !== metadata.primaryImageSmall || work.title !== metadata.title || work.artist !== artist) {
    throw new Error(`El catálogo no coincide con el registro oficial: ${work.id}`);
  }
}

const records = [];
const staged: { temporary: string; destination: URL }[] = [];
try {
  await Deno.mkdir(new URL('art/', game), { recursive: true });
  for (const work of catalog.works) {
    if (work.file !== null && work.file !== work.downloadPath) {
      throw new Error(`El catálogo usa una ruta local diferente: ${work.id}`);
    }
    const commons = work.id.startsWith('commons-');
    if (commons) await verifyCommons(work);
    else await verifyMet(work);
    const bytes = await readVerified(work.imageUrl, 3 * 1024 * 1024, commons ? 'image/webp' : 'image/jpeg');
    const dimensions = commons ? webpSize(bytes) : jpegSize(bytes);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const sha256 = Array.from(digest, (n) => n.toString(16).padStart(2, '0')).join('');
    if (commons && sha256 !== work.expectedSha256) {
      throw new Error(`La reproducción derivada no coincide con la huella fijada: ${work.id}`);
    }
    const destination = new URL(work.downloadPath, game);
    let exists = false;
    try {
      const previous = await Deno.readFile(destination);
      const same = previous.length === bytes.length && previous.every((n, i) => n === bytes[i]);
      if (!same) throw new Error(`El archivo local ya existe y es diferente: ${work.downloadPath}`);
      exists = true;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (!exists) {
      const directory = new URL('./', destination);
      await Deno.mkdir(directory, { recursive: true });
      const temporary = await Deno.makeTempFile({ dir: directory.pathname, prefix: '.download-' });
      staged.push({ temporary, destination });
      await Deno.writeFile(temporary, bytes);
    }
    records.push({
      id: work.id,
      file: work.downloadPath,
      source: work.imageUrl,
      downloadUrl: work.imageUrl,
      metadataSource: work.metadataSource,
      ...(commons ? {
        sourceCommons: work.source,
        originalImageUrl: work.originalImageUrl,
        originalSha1: work.originalSha1,
        sourceCommit: work.sourceCommit,
      } : {}),
      license: work.license,
      licenseUrl: work.licenseUrl,
      isPublicDomain: true,
      sha256,
      bytes: bytes.length,
      ...dimensions,
    });
    console.log(`Verificada: ${work.title} (${dimensions.width} × ${dimensions.height}, ${bytes.length} bytes)`);
  }
  // Ninguna obra se instala ni se activa hasta verificar todas las fuentes y descargas.
  // El enlace falla si apareció un archivo local entretanto; nunca sobrescribe una obra.
  for (const { temporary, destination } of staged) await Deno.link(temporary, destination.pathname);
  for (const work of catalog.works) work.file = work.downloadPath;
  await Deno.writeTextFile(new URL('art/downloads.json', game), JSON.stringify(records, null, 2) + '\n');
  await Deno.writeTextFile(catalogUrl, source.slice(0, assignment) + marker + JSON.stringify(catalog, null, 2) + ';\n');
  const total = catalog.works.length;
  console.log(`${total} ${total === 1 ? 'obra guardada y activada' : 'obras guardadas y activadas'} para uso local.`);
} finally {
  for (const { temporary } of staged) {
    try {
      await Deno.remove(temporary);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) console.warn(`No se pudo borrar el temporal ${temporary}: ${error}`);
    }
  }
}
