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

## Modos

- **Tutorial**: la primera vez que se abre el juego aparece una invitación para hacerlo. Pincelín guía una ronda
  de práctica sin reloj: mover la figura, elegir una pose, bloquearla, copiar colores, pintar, hacer zoom y,
  al final, buscarle a él (con pistas si hace falta). Cada paso avanza cuando lo haces de verdad y se puede saltar.
  Si llegaste con un enlace de invitación, al terminar te ofrece unirte a esa sala. Se puede repetir desde el
  botón **Tutorial** del menú.
- **Contra la CPU**: de 1 a 3 rivales controlados por el ordenador, con dificultad Fácil, Normal o Difícil.
  No necesita servidor: funciona también en GitHub Pages.
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
| `figure.js` | La figura de bloques y sus 10 poses. |
| `game.js` | Interfaz, dibujo, zoom, pintura, búsqueda, bots, tutorial y conexión. |
| `config.js` | Dirección pública del servidor WebSocket; vacía para usar el servidor junto al juego. |
| `index.html`, `style.css` | Pantallas y estilos. |
