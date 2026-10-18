// deno-lint-ignore-file no-explicit-any
import '../escondidas-en-pintura/artworks.js';
import '../escondidas-en-pintura/bot-ai.js';
import '../escondidas-en-pintura/room.js';

const { Room } = (globalThis as any).HideRoom;
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function room(collection: number) {
  const result = new Room('HINT', { externalTimers: true, settings: { collection, rounds: 3 } });
  result.join({ send() {} }, { name: 'A', pid: 'a' });
  result.join({ send() {} }, { name: 'B', pid: 'b' });
  result.startGame();
  return result;
}

Deno.test('las pistas de precarga anticipan sólo las siguientes rondas de arte y sobreviven a restauración', () => {
  const original = room(1);
  const hints = [...original.phaseMsg.preload];
  assert(hints.length === 2 && !hints.includes(original.painting), 'Dos próximas obras, sin volver a pedir la actual');
  const restored = Room.restore(JSON.parse(JSON.stringify(original.snapshot())), { externalTimers: true });
  try {
    assert(JSON.stringify(restored.phaseMsg.preload) === JSON.stringify(hints), 'Reconectar conserva las pistas');
    for (const expected of hints) {
      restored.nextRound();
      assert(restored.painting === expected, 'La obra anunciada es la que realmente empieza después');
    }
    assert(restored.phaseMsg.preload.length === 0, 'La última ronda no anticipa obras sin una ronda pendiente');
  } finally {
    original.destroy();
    restored.destroy();
  }
});

Deno.test('los patrones y el menú no anuncian descargas de obras', () => {
  const classic = room(0);
  const artwork = room(1);
  try {
    assert(classic.phaseMsg.preload.length === 0, 'Los patrones no requieren imágenes');
    artwork.toLobby();
    assert(artwork.phaseMsg.preload.length === 0, 'El menú no conserva pistas de una partida terminada');
  } finally {
    classic.destroy();
    artwork.destroy();
  }
});
