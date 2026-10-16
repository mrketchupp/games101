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

## Publicarlo en internet

**Con multijugador (recomendado): Deno Deploy.** El servidor de la colección es `server.ts`: sirve la
portada, los juegos y las salas en línea. En [Deno Deploy](https://deno.com/deploy) entra con tu cuenta de
GitHub, crea un proyecto a partir de este repositorio y elige `server.ts` como punto de entrada. Cada vez que
subas cambios a GitHub se publica solo. Para jugar con amigos basta con pasarles la dirección que te dé
(`https://….deno.dev`): no necesitan cuenta ni instalar nada.

**Solo para jugar contra la CPU: GitHub Pages.** En *Settings → Pages* elige la rama `main` y la carpeta raíz.
La portada y los juegos funcionan, pero GitHub Pages no ejecuta servidores, así que el modo en línea avisa de
que no hay servidor.

## Añadir un juego

1. Crea una carpeta con el nombre del juego en minúsculas y con guiones (por ejemplo `carreras-de-caracoles/`),
   con su `index.html` y sus archivos. Usa rutas relativas para que funcione dentro de su carpeta.
2. Añade su tarjeta en `index.html` (copia la de Escondidas en Pintura y cambia la portada, el texto y el enlace).
3. Si tiene multijugador, ponle un módulo como `escondidas-en-pintura/multiplayer.ts` y regístralo en
   `MULTIPLAYER` dentro de `server.ts`. Su WebSocket quedará en `/<carpeta>/ws`.
4. Añádelo a la tabla de juegos de este README.

## Estructura

| Ruta | Qué es |
| --- | --- |
| `index.html` | La portada con todos los juegos. |
| `server.ts` | Servidor de la colección (Deno): archivos de los juegos y multijugador de cada uno. |
| `deno.json` | Tareas: `deno task start`, `deno task dev` (se reinicia al guardar) y `deno task check`. |
| `escondidas-en-pintura/` | El primer juego. Tiene su propio [README](escondidas-en-pintura/README.md). |
