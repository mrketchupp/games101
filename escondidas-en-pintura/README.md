# Escondidas en Pintura 🎨

Versión para navegador del juego de Roblox «Escondidas en Pintura»: tu figura aparece encima de un cuadro y tienes que
**moverla, bloquearla y pintarla** con los colores del cuadro para que se camufle. Después, todos buscan las figuras de
los demás contra reloj.

Forma parte de la colección [Games 101](../README.md).

## Unirse a una partida con amigos

Dirección pública:
[abrir Escondidas en Pintura](https://mrketchupp.github.io/games101/escondidas-en-pintura/).
El modo en línea utiliza el servidor de salas publicado en Cloudflare y configurado en `config.js`.

1. El anfitrión abre el juego, escribe su nombre y pulsa **Multijugador en línea → Crear sala**.
2. Pulsa **Copiar enlace** y lo envía a sus amigos.
3. Cada invitado abre el enlace, escribe su nombre y pulsa **Unirse**. Si recibe solo el código de
   4 letras, puede escribirlo en **Multijugador en línea** y pulsar **Unirse**.
4. Cuando haya **2 a 8 personas** en la sala, el anfitrión pulsa **¡Empezar!**.

No necesitas cuenta, instalar nada ni estar en la misma red. Puedes saltar el tutorial y repetirlo
cuando quieras con **Tutorial** en el menú. Si aparece un aviso de conexión, espera unos segundos y pulsa
**Reintentar**; también puedes jugar contra la CPU.

## Cómo se juega

1. **¡Prepárense!**: aparece un cuadro nuevo. Hay dos galerías: **Clásicos** (10 estilos generados por código: ondas,
   campamento, atardecer, Bauhaus…) y **Obras de arte** (12 cuadros famosos de museo).
2. **Escóndete**: arrastra tu figura, elige una **pose** y pulsa **Bloquear**. Píntala con el pincel; con
   **Elegir color** copias cualquier color del cuadro. Pulsa **¡Listo!** cuando termines.
3. **Comprobando tu mezcla**: el juego calcula qué porcentaje de tu figura se confunde con el cuadro.
4. **¡Encuéntralos!**: toca donde creas que se esconden los demás. Cada fallo resta 2 segundos.
5. **Temporizadores**: se muestra cuánto tardó cada uno y se reparten puntos:
   - Por encontrar a alguien: 100 a 200 puntos, según lo rápido que lo hagas.
   - Por cada rival que no te encuentra: 150 puntos. Si te encuentra tarde, también sumas algo.

Controles: rueda o pellizco para hacer zoom; Espacio + arrastrar, clic derecho o dos dedos para mover la vista
(al buscar basta con arrastrar un dedo); `Ctrl+Z` para deshacer; `1`–`5` o `[` `]` para el tamaño del pincel; `I` para
elegir color, `L` para bloquear, `P` para las poses y `F` para la pantalla completa.

- **Pantalla completa**: botón con las cuatro esquinas (en el menú y en la partida) o tecla `F`. En iPhone el navegador no
  lo permite: el botón explica cómo añadir el juego a la pantalla de inicio, que lo abre sin barras.
- **Botón «atrás»** (o el gesto de volver del móvil): dentro de una partida o sala pide confirmación en lugar de sacarte
  del juego; en las pantallas de opciones vuelve al menú. Recargar o cerrar la pestaña en plena partida también avisa.
- **Al buscar en el móvil**: un toque marca aunque el dedo se mueva un poco o haya otro dedo apoyado en la pantalla
  (por ejemplo, el pulgar que sujeta el teléfono), y el pellizco ya no amplía la página entera.

## Modos

- **Tutorial**: la primera vez que se abre el juego aparece una invitación para hacerlo. Pincelín guía una ronda
  de práctica sin reloj: mover la figura, elegir una pose, bloquearla, copiar colores, pintar, hacer zoom y,
  al final, buscarle a él (con pistas si hace falta). Cada paso avanza cuando lo haces de verdad y se puede saltar.
  Si llegaste con un enlace de invitación, al terminar te ofrece unirte a esa sala. Se puede repetir desde el
  botón **Tutorial** del menú.
- **Contra la CPU**: de 1 a 3 rivales controlados por el ordenador, con dificultad Fácil, Normal o Difícil.
  No necesita servidor: funciona también en GitHub Pages.
- **Obras de arte**: galería que se elige en la partida contra la CPU o en la sala (lo decide el anfitrión). Son cuadros
  reales con mucho detalle, así que el tiempo para esconderse es de **3, 5 o 10 minutos, o sin límite**, y el de buscar
  llega hasta 2 minutos. Sin límite, la fase termina cuando todos pulsan **¡Listo!**; si alguien tarda demasiado, el
  anfitrión puede pulsar **Últimos 30 s** para que todos tengan medio minuto más. En estos cuadros la mezcla da por bueno
  un color que aparezca a 2 píxeles o menos, porque la textura del óleo cambia de un píxel a otro.
- **Multijugador en línea**: de 2 a 8 jugadores por sala. Uno crea la sala y comparte el código de 4 letras
  o el enlace (`?sala=ABCD`). En internet usa el servidor de salas de Cloudflare.

## Multijugador

El despliegue combina **GitHub Pages** para los archivos del juego y **Cloudflare Workers Free**
con **Durable Objects con SQLite** para las salas. El cliente lee `window.EEP_CONFIG.websocketUrl` desde
`config.js`, que se carga antes de `game.js`. Debe apuntar al dominio real del Worker, con `wss://` y la
ruta `/escondidas-en-pintura/ws`. Si el valor está vacío, busca el servidor junto al juego para uso local.

En Cloudflare, cada sala guarda una copia de su estado y una alarma con el plazo de la fase para poder
restaurar la partida tras una hibernación o un reinicio del proceso. Si desaparece una conexión, ese
jugador pasa a estar desconectado. Las salas se eliminan tras **2 minutos sin personas conectadas**.
Si el código ya no existe, crea otra sala y comparte el nuevo enlace.

Desde la carpeta de la colección, los comandos para el backend son:

```bash
pnpm install
pnpm dev:multiplayer
pnpm deploy:multiplayer
```

El segundo comando inicia el entorno local de Wrangler; el tercero publica las salas en la cuenta de
Cloudflare autorizada. El cliente se publica mediante [el flujo de GitHub Pages](../.github/workflows/pages.yml),
que prepara los archivos con `deno task build:pages`. Los pasos de autenticación, configuración y
publicación están en el [README de la colección](../README.md#publicarlo-en-internet).

Se requiere **Workers Free** para mantener el despliegue gratuito: superar sus cuotas hace fallar las
operaciones afectadas. En **Workers Paid**, el uso puede generar cargos. Consulta
[costos y límites](../README.md#costos-y-límites) antes de desplegar; no actives un plan de pago
automáticamente.

Para jugar y desarrollar solo con el servidor local de Deno (`../server.ts`):

```bash
deno task start
```

y entra en [el juego local](http://localhost:8000/escondidas-en-pintura/). Las salas de este servidor
local viven en memoria: si Deno se reinicia, esas partidas en curso se pierden.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `room.js` | Reglas y fases de la partida. Lo comparten el servidor y el modo CPU, así que las reglas son las mismas en los dos modos. |
| `multiplayer.ts` | Salas en línea por WebSocket (lo usa `../server.ts`). |
| `paintings.js` | Los 10 cuadros generados por código (con la misma semilla, todos ven el mismo cuadro). |
| `artworks.js`, `obras/` | La galería «Obras de arte»: nombres, autores y las 12 imágenes (WebP de 800 × 800, sRGB). |
| `figure.js` | La figura de bloques y sus 10 poses. |
| `game.js` | Interfaz, dibujo, zoom, pintura, búsqueda, bots, tutorial y conexión. |
| `config.js` | Dirección pública del servidor WebSocket; vacía para usar el servidor junto al juego. |
| `index.html`, `style.css` | Pantallas y estilos. |

## Créditos de las obras de arte

Todas son de dominio público y proceden de Wikimedia Commons. Se usan recortes cuadrados reducidos a 800 × 800 píxeles.

| Obra | Autor | Origen |
| --- | --- | --- |
| La noche estrellada (1889) | Vincent van Gogh | [Commons](https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg) |
| La gran ola de Kanagawa (h. 1831) | Katsushika Hokusai | [Commons](https://commons.wikimedia.org/wiki/File:Tsunami_by_hokusai_19th_century.jpg) |
| Juegos de niños (1560) | Pieter Brueghel el Viejo | [Commons](https://commons.wikimedia.org/wiki/File:Pieter_Bruegel_the_Elder_-_Children%E2%80%99s_Games_-_Google_Art_Project.jpg) |
| El beso (1907–1908) | Gustav Klimt | [Commons](https://commons.wikimedia.org/wiki/File:The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg) |
| Los girasoles (1888) | Vincent van Gogh | [Commons](https://commons.wikimedia.org/wiki/File:Vincent_Willem_van_Gogh_127.jpg) |
| Tarde de domingo en la Grande Jatte (1884–1886) | Georges Seurat | [Commons](https://commons.wikimedia.org/wiki/File:A_Sunday_on_La_Grande_Jatte,_Georges_Seurat,_1884.jpg) |
| El jardín de las delicias, tabla central (h. 1500) | El Bosco | [Commons](https://commons.wikimedia.org/wiki/File:The_Garden_of_earthly_delights.jpg) |
| Cazadores en la nieve (1565) | Pieter Brueghel el Viejo | [Commons](https://commons.wikimedia.org/wiki/File:Pieter_Bruegel_the_Elder_-_Hunters_in_the_Snow_(Winter)_-_Google_Art_Project.jpg) |
| Vertumno (1591) | Giuseppe Arcimboldo | [Commons](https://commons.wikimedia.org/wiki/File:Vertumnus_%C3%A5rstidernas_gud_m%C3%A5lad_av_Giuseppe_Arcimboldo_1591_-_Skoklosters_slott_-_91503.tiff) |
| Los proverbios flamencos (1559) | Pieter Brueghel el Viejo | [Commons](https://commons.wikimedia.org/wiki/File:Pieter_Brueghel_the_Elder_-_The_Dutch_Proverbs_-_Google_Art_Project.jpg) |
| Las meninas (1656) | Diego Velázquez | [Commons](https://commons.wikimedia.org/wiki/File:Las_Meninas,_by_Diego_Vel%C3%A1zquez,_from_Prado_in_Google_Earth.jpg) |
| Impresión, sol naciente (1872) | Claude Monet | [Commons](https://commons.wikimedia.org/wiki/File:Monet_-_Impression,_Sunrise.jpg) |

Para añadir una obra: guarda su recorte en `obras/` (800 × 800, sRGB, sin perfil de color), añádela al final de la lista
de `artworks.js`, sube `ART_COUNT` en `room.js` y vuelve a publicar el servidor de salas.
