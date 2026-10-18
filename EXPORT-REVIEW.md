# Integración revisada para publicación

Rama solicitada: `codex/export-games101-integration`.
Base: `9d0cf37637eab51be46a5177cbf214287de2da9c`, el trabajo publicado por Claude.
La rama permitió recuperar los cambios del entorno remoto, que no podía publicarlos.
La revisión local integra esa exportación y las correcciones descritas abajo.

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

## Correcciones de la revisión local

- Precarga gradual de obras durante la espera y las rondas: una descarga de baja prioridad,
  una pausa entre archivos y preferencia por las dos obras siguientes. La carga necesaria
  interrumpe la cola. Respeta visibilidad, conexión, ahorro de datos y 2G; se pausa en el menú
  y en Patrones. Guarda archivos comprimidos en la caché HTTP y limita a seis las imágenes
  decodificadas retenidas por el cliente.
- Reintentos de imágenes para personas y CPU, con cancelación al cambiar de fase.
  El tiempo de carga no amplía el reloj de búsqueda.
- Alarmas tardías y reconexiones muestran el tiempo restante real sin cambiar los plazos
  ni las decisiones CPU. La sincronización recupera hallazgos y jugadores terminados.
- Cancelar Listo elimina únicamente la figura de ese jugador y permite recibir la imagen
  actualizada durante toda la ventana de colección.
- Navegación consume las guardas duplicadas que podían quedar en el historial tras recargar.

## Verificación local

Ejecutadas de nuevo sobre este estado, todas correctas:

```bash
deno task check
deno task test
deno task build:pages
pnpm check:multiplayer
```

Resultado: 78 pruebas aprobadas, lint de 25 archivos, salida estática generada
y paquete del Worker preparado mediante `wrangler deploy --dry-run`.
Este último comando no publica el Worker.

Pasaron partidas completas por WebSocket en Deno y Worker local, CPU,
reconexión, relevo de anfitrión y rechazo de protocolos incompatibles.
La prueba real de hibernación local evacuó el Durable Object durante pintura
y búsqueda; las conexiones y alarmas originales completaron la partida.
También pasó la prueba de Obras sin límite, Últimos 30 s, cancelación y PNG
conservados al reconectar. El smoke compara propiedades de figuras sin depender
del orden de las claves JSON.

```bash
deno task test:multiplayer ws://127.0.0.1:8787/escondidas-en-pintura/ws
deno task test:bots ws://127.0.0.1:8787/escondidas-en-pintura/ws
deno task test:protocol ws://127.0.0.1:8787/escondidas-en-pintura/ws
deno task test:art-timers ws://127.0.0.1:8787/escondidas-en-pintura/ws
pnpm test:hibernation
```

La automatización del navegador no estaba disponible durante esta revisión local.
No se repitió la comprobación visual de dibujo/deshacer que quedó inconclusa en
el entorno remoto (`assert(before.undo > 1)`). Las comprobaciones previas de
35 imágenes y móvil pertenecen a la exportación anterior; las pruebas actuales
del cliente ejercitan precarga, carga, historial y reconciliación sin renderizado.

## Publicación

Worker publicado: `aeaa91e9-9675-44e1-9574-8c038f395f93`.
`/health` confirma `protocol: 2`, `artworks: 35` y `cpu: true`.
Se conserva Workers Free y la migración SQLite existente.
Pasaron las cuatro pruebas WebSocket contra la dirección pública: multijugador,
CPU, protocolo y tiempos de Obras con reconexión.
El cliente se publica en Pages mediante el flujo al subir `main`, después de
comprobar una partida con el Worker público. Los jugadores deben recargar el
juego. Las salas de obras iniciadas con el catálogo anterior deben recrearse.

La exportación excluye tokens, archivos privados de configuración, dependencias
instaladas, cachés y salidas generadas.
