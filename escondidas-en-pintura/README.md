# Escondidas en Pintura 🎨

Versión para navegador del juego de Roblox «Escondidas en Pintura»: tu figura aparece encima de un cuadro y tienes que
**moverla, bloquearla y pintarla** con los colores del cuadro para que se camufle. Después, todos buscan las figuras de
los demás contra reloj.

Forma parte de la colección [Games 101](../README.md).

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
  o el enlace (`?sala=ABCD`). Necesita el servidor de la colección.

## Multijugador

Lo sirve el servidor de la colección (`../server.ts`), que monta las salas de este juego en
`/escondidas-en-pintura/ws`. Desde la carpeta de la colección:

```bash
deno task start
```

y entra en <http://localhost:8000/escondidas-en-pintura/>. Para publicarlo en internet, mira el
[README de la colección](../README.md#publicarlo-en-internet). Las salas viven en memoria: si el servidor se
reinicia, las partidas en curso se pierden.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `room.js` | Reglas y fases de la partida. Lo comparten el servidor y el modo CPU, así que las reglas son las mismas en los dos modos. |
| `multiplayer.ts` | Salas en línea por WebSocket (lo usa `../server.ts`). |
| `paintings.js` | Los 10 cuadros generados por código (con la misma semilla, todos ven el mismo cuadro). |
| `figure.js` | La figura de bloques y sus 10 poses. |
| `game.js` | Interfaz, dibujo, zoom, pintura, búsqueda, bots, tutorial y conexión. |
| `index.html`, `style.css` | Pantallas y estilos. |
