# Games 101 🎮

Colección de juegos para jugar en el navegador, sin instalar nada. Cada juego vive en su propia carpeta
y la portada (`index.html`) los reúne todos.

## Juegos

| Juego | De qué va | Jugadores |
| --- | --- | --- |
| [Escondidas en Pintura](escondidas-en-pintura/) | Píntate para camuflarte en un cuadro y encuentra a los demás contra reloj. Con tutorial. | 1 contra la CPU, o de 2 a 8 participantes en línea, incluyendo CPU |

Escondidas en Pintura permite elegir patrones con tres niveles de detalle o jugar sobre
**obras del mundo humano**, una colección de 35 reproducciones de dominio público del Metropolitan
Museum of Art y Wikimedia Commons. La dificultad del fondo se configura por separado de la de los rivales CPU.
Los rivales tienen cuatro niveles, de Fácil a Experto, y también pueden añadirse a las salas en línea.

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
4. El anfitrión puede añadir **CPU** y elegir su dificultad. Con **2 a 8 participantes** en total,
   incluyendo al menos una persona, pulsa **¡Empezar!**.

Todos pueden jugar desde el navegador, sin instalar nada ni crear cuentas. El tutorial se puede saltar y
repetir desde **¿Cómo se juega? → Tutorial interactivo** en el menú. Para jugar contra la CPU no hace falta el servidor de salas.

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

`deno task test` comprueba las reglas, las CPU, la persistencia y las imágenes incluidas.
Con el servidor local en marcha, los comandos siguientes prueban conexiones reales; también
aceptan la URL WebSocket del servidor publicado como argumento:

```bash
deno task test:multiplayer ws://127.0.0.1:8787/escondidas-en-pintura/ws
deno task test:bots ws://127.0.0.1:8787/escondidas-en-pintura/ws
deno task test:protocol ws://127.0.0.1:8787/escondidas-en-pintura/ws
deno task test:art-timers ws://127.0.0.1:8787/escondidas-en-pintura/ws
```

El primero completa una ronda con dos personas y reconexión; el segundo comprueba CPU en una sala
individual y en otra con cambio de anfitrión; el tercero verifica versiones y rechaza conexiones
incompatibles. El cuarto comprueba Obras sin límite, Últimos 30 s, entregas canceladas y reconexión
sin reiniciar el reloj. Las pruebas crean salas temporales y cierran sus conexiones al terminar.
`pnpm test:hibernation` inicia un Worker local aislado, fuerza la hibernación de una sala durante
la pintura y la búsqueda, y comprueba que sus alarmas conservan las conexiones, las decisiones de
las CPU y los puntos. No necesita iniciar otro servidor ni acceder a la cuenta de Cloudflare.

### 3. Publicar GitHub Pages

En el repositorio de GitHub, abre **Settings → Pages → Build and deployment** y elige **GitHub Actions**
como origen. El flujo [`.github/workflows/pages.yml`](.github/workflows/pages.yml) comprueba el proyecto,
prepara los archivos y los publica al subir cambios a `main`; también se puede ejecutar desde **Actions**.
Antes de publicar el cliente, comprueba una ronda contra el servidor público y su versión de protocolo
y catálogo. **Este flujo no despliega el Worker**: publica primero las salas y después GitHub Pages.

Para esta actualización, `/health` debe indicar `protocol: 2`, `artworks: 35` y `cpu: true`.
Después de desplegar el Worker, ejecuta las cuatro pruebas anteriores con su dirección pública `wss://`
y luego publica el cliente. En un entorno sin sesión de Wrangler, configura de forma segura
`CLOUDFLARE_API_TOKEN` para la cuenta de destino; no lo guardes en el repositorio ni en `config.js`.

Al actualizar, los jugadores deben recargar la página para usar el mismo protocolo y catálogo que el
servidor. Las salas de obras iniciadas con la galería anterior requieren crear una sala nueva, porque
sus índices y recortes no representan la misma colección. Las salas de patrones anteriores conservan
su fondo original. Los clientes incompatibles reciben un aviso antes de entrar en una sala.

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
