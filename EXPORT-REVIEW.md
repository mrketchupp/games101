# Estado exportado para revisión y publicación local

Rama solicitada: `codex/export-games101-integration`.
Base: `9d0cf37637eab51be46a5177cbf214287de2da9c`, el trabajo publicado por Claude.
Esta exportación guarda el estado pendiente sin desplegar Cloudflare ni modificar `main`.
No se continuó el desarrollo al recibir la instrucción de exportar.

## Contenido conservado

- 35 obras distintas: 24 del Met y 11 de Commons, con imágenes locales, créditos,
  fuentes, derechos y comprobación SHA-256. Los 12 WebP incorporados por Claude
  se conservan idénticos; su Gran ola queda fuera del catálogo activo por estar
  ya representada en la colección del Met.
- Patrones con tres niveles de detalle y recorrido de obras sin repetición
  hasta agotar el catálogo, persistente entre partidas.
- Cuatro niveles de CPU: Fácil, Normal, Difícil y Experto. Salas de hasta ocho
  participantes combinando personas y CPU, con autoridad del anfitrión,
  decisiones del servidor, reconexión y plazos persistentes.
- Pantalla completa, menú «¿Cómo se juega?» con tutorial dentro, mejoras
  táctiles de Claude, protección de navegación y ayuda de pantalla completa
  para iPhone.
- Tiempos de arte ampliados, opción Sin límite, Últimos 30 s del anfitrión y
  tolerancia de mezcla de dos píxeles en obras.
- Protocolo 2 y catálogo exacto compartido entre cliente y servidor. Pages
  verifica la compatibilidad del Worker público antes de publicar el cliente.

## Verificación al exportar

Ejecutadas de nuevo sobre este estado, todas correctas:

```bash
deno task check
deno task test
deno task build:pages
pnpm check:multiplayer
```

Resultado: 54 pruebas aprobadas, lint de 21 archivos, salida estática generada
y paquete del Worker preparado mediante `wrangler deploy --dry-run`.
Este último comando no publica el Worker.

En la integración anterior también pasaron partidas completas en Deno y Worker
local, CPU, reconexión, relevo de anfitrión, rechazo de protocolos incompatibles
y una prueba real de hibernación local de Durable Objects durante pintura y
búsqueda. El navegador comprobó las 35 imágenes, una partida CPU y una partida
en línea con figuras reales; hubo comprobaciones móviles a 360 y 390 píxeles.
Esas comprobaciones preceden a los últimos ajustes de tiempos ilimitados y
navegación, por lo que no sustituyen su validación final.

## Trabajo incompleto y siguiente revisión

- La última comprobación de navegador de Sin límite no terminó: se detuvo en
  la aserción de prueba `assert(before.undo > 1)`. No se determinó si era un
  problema de la prueba o del juego. Hay que repetir esa comprobación, incluidos
  dibujo/deshacer, Últimos 30 s, navegación y reconexión con las fuentes finales.
- Se conserva `scripts/smoke-artwork-timers.ts` como prueba manual. Su última
  ejecución integrada no está confirmada y no tiene tarea propia en `deno.json`.
- Conviene repetir los smokes completos contra el estado final antes de
  desplegar. Las instrucciones de servidores y dependencias están en README.

```bash
deno task test:multiplayer ws://127.0.0.1:8787/escondidas-en-pintura/ws
deno task test:bots ws://127.0.0.1:8787/escondidas-en-pintura/ws
deno task test:protocol ws://127.0.0.1:8787/escondidas-en-pintura/ws
deno run --allow-net scripts/smoke-artwork-timers.ts ws://127.0.0.1:8787/escondidas-en-pintura/ws
pnpm test:hibernation
```

Para publicar, desplegar primero el Worker desde la computadora autenticada,
comprobar `/health` con `protocol: 2`, `artworks: 35` y `cpu: true`, y después
publicar el cliente en Pages. Los jugadores deben recargar el juego. Las salas
de obras iniciadas con el catálogo anterior deben recrearse.

La exportación excluye tokens, archivos privados de configuración, dependencias
instaladas, cachés y salidas generadas. No se ha realizado ningún despliegue.
