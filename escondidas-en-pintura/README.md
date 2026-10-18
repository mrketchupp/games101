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
4. El anfitrión puede añadir **CPU** y elegir su dificultad. Cuando haya **2 a 8 participantes**,
   incluyendo al menos una persona, pulsa **¡Empezar!**.

No necesitas cuenta, instalar nada ni estar en la misma red. Puedes saltar el tutorial y repetirlo
cuando quieras con **¿Cómo se juega? → Tutorial interactivo** en el menú. Si aparece un aviso de conexión, espera unos segundos y pulsa
**Reintentar**; también puedes jugar contra la CPU.

## Cómo se juega

1. **¡Prepárense!**: aparece un cuadro nuevo (hay 10 estilos generados por código: ondas, campamento, atardecer, Bauhaus…).
2. **Escóndete**: arrastra tu figura, elige una **pose** y pulsa **Bloquear**. Píntala con el pincel; con
   **Elegir color** copias cualquier color del cuadro. Pulsa **¡Listo!** cuando termines.
3. **Comprobando tu mezcla**: el juego calcula qué porcentaje de tu figura se confunde con el cuadro.
4. **¡Encuéntralos!**: toca donde creas que se esconden los demás. Cada fallo resta 2 segundos.
5. **Temporizadores**: se muestra cuánto tardó cada uno y se reparten puntos:
   - Por encontrar a alguien: 100 a 200 puntos, según lo rápido que lo hagas.
   - Por cada rival que no te encuentra: 150 puntos. Si te encuentra tarde, también sumas algo.

Controles: rueda o pellizco para hacer zoom; Espacio + arrastrar, clic derecho o dos dedos para mover la vista;
`Ctrl+Z` para deshacer; `1`–`5` o `[` `]` para el tamaño del pincel; `I` para elegir color, `L` para bloquear y `P` para las poses.
El botón de las cuatro esquinas, junto al sonido, permite entrar y salir de pantalla completa.
En ordenador también puedes usar `F` y salir con `Esc`. El botón aparece en los navegadores que admiten esta función.
Al buscar, arrastra con un dedo para mover la vista y toca sin arrastrar para intentar encontrar una figura.

## Modos

- **Tutorial**: la primera vez que se abre el juego aparece una invitación para hacerlo. Pincelín guía una ronda
  de práctica sin reloj: mover la figura, elegir una pose, bloquearla, copiar colores, pintar, hacer zoom y,
  al final, buscarle a él (con pistas si hace falta). Cada paso avanza cuando lo haces de verdad y se puede saltar.
  Si llegaste con un enlace de invitación, al terminar te ofrece unirte a esa sala. Se puede repetir desde el
  botón **Tutorial interactivo** dentro de **¿Cómo se juega?**.
- **Contra la CPU**: de 1 a 3 rivales controlados por el ordenador, con dificultad Fácil, Normal, Difícil o Experto.
  No necesita servidor: funciona también en GitHub Pages.
- **Multijugador en línea**: de 2 a 8 participantes por sala, combinando personas y CPU. Uno crea la sala
  y comparte el código de 4 letras o el enlace (`?sala=ABCD`). En internet usa el servidor de salas de Cloudflare.

## Rivales CPU

El nivel cambia tanto la manera de pintar como la búsqueda. Los niveles más altos comparan más
posiciones y poses para esconderse, pintan con más precisión y buscan con mayor rapidez y acierto.
Los rivales también cometen errores; el camuflaje de tu figura influye en cuánto tardan en encontrarla.

| Nivel | Comportamiento |
| --- | --- |
| Fácil | Ocultación sencilla, pincel más grueso y búsqueda más lenta, con más fallos. |
| Normal | Compara posiciones y combina una pintura y una búsqueda más cuidadosas. |
| Difícil | Elige mejor el sitio, afina los detalles y encuentra más figuras. |
| Experto | Busca más posiciones y poses, pinta con mayor precisión y reacciona antes, con margen de error. |

En una sala, el anfitrión elige **Rivales CPU en la sala** y **Dificultad de las CPU** antes de empezar.
Puedes jugar en línea con una sola persona y al menos una CPU, o añadir CPU a una partida entre amigos.
Cada CPU ocupa una de las ocho plazas. Solo el anfitrión cambia estos ajustes; las CPU aparecen
identificadas en la lista de participantes. Para dejar plazas a otros amigos, reduce las CPU en la sala
antes de empezar.

Estos ajustes son independientes del detalle de los patrones. Las CPU funcionan también en la
colección de obras del mundo humano.

## Dificultad del camuflaje

Al configurar la partida puedes elegir el **detalle de los patrones**, tanto contra la CPU como en
la sala multijugador (lo elige el anfitrión):

- **Fácil**: los cuadros originales, con zonas amplias de color para practicar.
- **Normal**: trazos que atraviesan las zonas planas y obligan a combinar colores. Es el valor inicial.
- **Difícil**: trazos más densos y contrastados; conviene usar pinceles pequeños y elegir colores del cuadro.

La dificultad de los rivales CPU se elige por separado. El tutorial conserva su cuadro sencillo.
Todos los jugadores ven los mismos detalles; la configuración también se conserva al reconectar.

## Obras del mundo humano

En **Cuadros** puedes elegir esta colección en lugar de los patrones. Incluye **35 reproducciones**:
24 del **Metropolitan Museum of Art**, ofrecidas bajo **CC0 1.0**, y 11 de **Wikimedia Commons**
identificadas como de dominio público. Hay paisajes, retratos, escenas urbanas, bodegones,
estampas japonesas, pintura china y miniaturas de India e Irán, junto a obras como *La noche estrellada*,
*El beso* y *Las meninas*. La partida muestra el autor y un enlace a la ficha de procedencia.
Los títulos oficiales, los registros de dominio público y las fuentes están en [los créditos](art/CREDITS.md).

Las obras se recortan al tablero cuadrado y conservan sus colores y texturas. El selector de detalle
de los patrones queda desactivado en esta colección; la dificultad de los rivales sigue disponible.
Para pintar estas obras puedes elegir **3, 5 o 10 minutos, o Sin límite**. Sin límite, la fase termina
cuando todos están listos; el anfitrión puede dar un último plazo con **Últimos 30 s**.
El tiempo base de búsqueda admite de 30 segundos a 2 minutos y se amplía según el número de rivales.
Al medir la mezcla se acepta un color cercano hasta dos píxeles en la obra, para que la textura
de una pincelada no exija acertar exactamente en un píxel.
Cada colección se recorre sin repetir obras hasta agotarla, también entre partidas consecutivas
en una misma sala. En el modo CPU, el navegador guarda las obras pendientes para continuar
al volver al menú o recargar la página. El primer cuadro de un ciclo tampoco repite el último
del anterior.

Las imágenes están incluidas en el juego y en la publicación estática. Al elegir Obras, se precargan
gradualmente durante la sala de espera y las rondas: una descarga a baja prioridad cada vez, con
una pausa entre archivos y preferencia por los próximos cuadros. La obra que se necesita para jugar
tiene prioridad y detiene la descarga de fondo. La precarga se pausa al ocultar la pestaña, perder
la conexión, activar ahorro de datos o detectar una conexión 2G; también al volver al menú o a Patrones.
Los archivos comprimidos quedan en la caché del navegador, sin mantener toda la galería decodificada
en memoria ni consultar al museo. Si el navegador vacía su caché, la obra se descarga cuando hace falta.
El [comando de descarga documentado en los créditos](art/CREDITS.md#descargar-y-verificar-las-imágenes)
permite volver a obtener y verificar los originales. Si una imagen no carga, la partida muestra un
aviso y permite volver a intentarlo o elegir Patrones.

## Multijugador

El despliegue combina **GitHub Pages** para los archivos del juego y **Cloudflare Workers Free**
con **Durable Objects con SQLite** para las salas. El cliente lee `window.EEP_CONFIG.websocketUrl` desde
`config.js`, que se carga antes de `game.js`. Debe apuntar al dominio real del Worker, con `wss://` y la
ruta `/escondidas-en-pintura/ws`. Si el valor está vacío, busca el servidor junto al juego para uso local.

En Cloudflare, cada sala guarda una copia de su estado y una alarma con el próximo plazo de la fase o de las CPU para poder
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
El Worker se publica primero; el flujo de Pages comprueba su compatibilidad antes de publicar el cliente.
Tras esta actualización hay que recargar el juego. Las salas de obras que ya estaban en partida con
la galería anterior deben recrearse para evitar mezclar imágenes e índices de catálogos distintos.

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
| `artworks.js`, `art/`, `obras/` | Catálogo de 35 obras, imágenes locales y créditos de las fuentes. |
| `art-prefetch.js` | Cola de descargas de baja prioridad que cede ante la obra de la ronda. |
| `bot-ai.js` | Perfiles de dificultad y decisiones reproducibles de las CPU, compartidos por el cliente y el servidor. |
| `figure.js` | La figura de bloques y sus 10 poses. |
| `game.js` | Interfaz, dibujo, zoom, pintura, búsqueda, bots, tutorial y conexión. |
| `config.js` | Dirección pública del servidor WebSocket; vacía para usar el servidor junto al juego. |
| `index.html`, `style.css` | Pantallas y estilos. |
