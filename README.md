# Games 101 🎮

Colección de juegos para jugar en el navegador, sin instalar nada. Cada juego vive en su propia carpeta
y la portada (`index.html`) los reúne todos.

## Juegos

| Juego | De qué va | Jugadores |
| --- | --- | --- |
| [Escondidas en Pintura](escondidas-en-pintura/) | Píntate para camuflarte en un cuadro y encuentra a los demás contra reloj. Con tutorial. | 1 contra la CPU, o de 2 a 8 en línea |

## Jugar en tu ordenador

Hace falta [Deno](https://deno.com) 2 o posterior. Desde esta carpeta:

```bash
deno task start
```

Abre <http://localhost:8000> y elige un juego. Quien esté en tu misma red Wi-Fi puede entrar con
`http://TU-IP-LOCAL:8000` (en macOS, la IP sale con `ipconfig getifaddr en0`).

## Jugar con otras personas

La dirección pública del juego es
[Escondidas en Pintura](https://mrketchupp.github.io/games101/escondidas-en-pintura/).
Las salas se conectan al [servidor de Cloudflare](https://games101-multiplayer.electro-k.workers.dev/health).

1. El anfitrión abre el juego, escribe su nombre y pulsa **Multijugador en línea → Crear sala**.
2. Pulsa **Copiar enlace** y lo comparte con los demás.
3. Cada invitado abre ese enlace, escribe su nombre y pulsa **Unirse**. También puede abrir el juego,
   entrar en **Multijugador en línea** y escribir el código de 4 letras.
4. Con **2 a 8 personas** en la sala, el anfitrión pulsa **¡Empezar!**.

Todos pueden jugar desde el navegador, sin instalar nada ni crear cuentas. El tutorial se puede saltar y
repetir desde **Tutorial** en el menú. Para jugar contra la CPU no hace falta el servidor de salas.

## Publicarlo en internet

El cliente se publica en **GitHub Pages** y las salas se alojan en **Cloudflare Workers Free**, con un
**Durable Object con almacenamiento SQLite por sala**. GitHub Pages sirve los archivos del juego; los
navegadores se conectan directamente al Worker para jugar juntos.

Cada sala guarda una copia de su estado y los plazos de sus fases en el Durable Object; las alarmas
permiten recuperar la partida tras una hibernación o un reinicio del proceso. Las conexiones que
desaparezcan se marcan como desconectadas. La sala se elimina tras **2 minutos sin personas conectadas**;
su código no es una reserva permanente.

No se usa Deno Deploy para este despliegue: el alta no estaba disponible al prepararlo y Deno anunció el
9 de octubre de 2026 que el servicio cerraría seis meses después. Véase el
[anuncio oficial de Deno](https://deno.com/blog/cloudflare). `deno task start` sigue disponible para jugar
y desarrollar en local.

### 1. Publicar las salas

Necesitas Node.js 22 o posterior, pnpm y una cuenta de Cloudflare con **Workers Free**. Desde la raíz:

```bash
pnpm install
pnpm exec wrangler login
pnpm deploy:multiplayer
```

Wrangler muestra la dirección HTTPS real del Worker cuando termina el despliegue. El servicio de este
juego utiliza la ruta `/escondidas-en-pintura/ws`.

### 2. Conectar el juego al servidor

En `escondidas-en-pintura/config.js`, cambia `websocketUrl` por la dirección del Worker con protocolo
`wss://` y la ruta `/escondidas-en-pintura/ws`. La configuración publicada es:

```js
window.EEP_CONFIG = {
  websocketUrl: 'wss://games101-multiplayer.electro-k.workers.dev/escondidas-en-pintura/ws',
};
```

El valor vacío utiliza el servidor local junto al juego. En GitHub Pages debe contener la dirección
remota para que funcionen las salas. Esta configuración es pública y no debe contener contraseñas ni
tokens. El juego añade el código de sala a la conexión automáticamente.

`deno task test` comprueba las reglas y la persistencia. `deno task test:multiplayer` prueba el Worker
local con dos jugadores independientes, una reconexión y una ronda completa; también acepta como
argumento la URL WebSocket del servidor publicado.

### 3. Publicar GitHub Pages

En el repositorio de GitHub, abre **Settings → Pages → Build and deployment** y elige **GitHub Actions**
como origen. El flujo [`.github/workflows/pages.yml`](.github/workflows/pages.yml) comprueba el proyecto,
prepara los archivos y los publica al subir cambios a `main`; también se puede ejecutar desde **Actions**.

Para preparar los mismos archivos en local:

```bash
deno task build:pages
```

La salida queda en `_site/`. Incluye la portada y los archivos del juego, con `config.js`; no incluye
el código del servidor ni las dependencias de desarrollo.

### Probar el Worker en local

```bash
pnpm install
pnpm dev:multiplayer
```

Wrangler muestra la dirección local. Para probar el juego contra ese Worker, inicia también
`deno task start` y cambia temporalmente `websocketUrl` a su dirección `ws://` con la ruta
`/escondidas-en-pintura/ws`. Antes de publicar, vuelve a poner la dirección pública `wss://`.

### Costos y límites

Este despliegue está pensado para **Workers Free**, que admite Durable Objects con SQLite. Al superar
sus cuotas gratuitas, las operaciones afectadas fallan en lugar de generar cobros por excedentes.
Consulta los [límites de Workers](https://developers.cloudflare.com/workers/platform/limits/) y las
[cuotas de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Si la cuenta tiene **Workers Paid**, el uso sí puede ser facturable según las
[tarifas de Cloudflare](https://developers.cloudflare.com/workers/platform/pricing/). Comprueba el plan
de la cuenta antes de desplegar; no cambies a un plan de pago automáticamente.

## Añadir un juego

1. Crea una carpeta con el nombre del juego en minúsculas y con guiones (por ejemplo `carreras-de-caracoles/`),
   con su `index.html` y sus archivos. Usa rutas relativas para que funcione dentro de su carpeta.
2. Añade su tarjeta en `index.html` (copia la de Escondidas en Pintura y cambia la portada, el texto y el enlace).
3. Si tiene multijugador, ponle un módulo como `escondidas-en-pintura/multiplayer.ts` y regístralo en
   `MULTIPLAYER` dentro de `server.ts` para probarlo en local. Su WebSocket quedará en `/<carpeta>/ws`.
   Para publicarlo, añade también su backend al Worker y su configuración pública al cliente.
4. Añádelo a la tabla de juegos de este README.

## Estructura

| Ruta | Qué es |
| --- | --- |
| `index.html` | La portada con todos los juegos. |
| `server.ts` | Servidor local de la colección (Deno): archivos de los juegos y multijugador de cada uno. |
| `deno.json` | Tareas locales, comprobaciones y `deno task build:pages`. |
| `package.json` | Comandos de pnpm para probar y desplegar el servidor de Cloudflare. |
| `cloudflare/worker.js`, `wrangler.jsonc` | Servidor publicado y configuración de Durable Objects con SQLite. |
| `.github/workflows/pages.yml` | Publicación del cliente en GitHub Pages mediante GitHub Actions. |
| `scripts/build-pages.ts` | Prepara los archivos públicos en `_site/`. |
| `escondidas-en-pintura/` | El primer juego. Tiene su propio [README](escondidas-en-pintura/README.md). |
