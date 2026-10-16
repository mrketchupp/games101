/*
 * Galería «Obras de arte»: cuadros reales de dominio público (Wikimedia Commons).
 * Cada imagen es un recorte cuadrado de 800 x 800 en sRGB, sin perfil de color, para que todos vean los mismos píxeles.
 * El orden importa: el servidor elige las obras por su índice en esta lista (room.js → ART_COUNT).
 */
(function (root) {
  'use strict';

  const DIR = 'obras/';
  const LIST = [
    { file: 'noche-estrellada.webp', name: 'La noche estrellada', artist: 'Vincent van Gogh', year: '1889' },
    { file: 'gran-ola.webp', name: 'La gran ola de Kanagawa', artist: 'Katsushika Hokusai', year: 'h. 1831' },
    { file: 'juegos-de-ninos.webp', name: 'Juegos de niños', artist: 'Pieter Brueghel el Viejo', year: '1560' },
    { file: 'el-beso.webp', name: 'El beso', artist: 'Gustav Klimt', year: '1907–1908' },
    { file: 'girasoles.webp', name: 'Los girasoles', artist: 'Vincent van Gogh', year: '1888' },
    { file: 'grande-jatte.webp', name: 'Tarde de domingo en la Grande Jatte', artist: 'Georges Seurat', year: '1884–1886' },
    { file: 'jardin-delicias.webp', name: 'El jardín de las delicias', artist: 'El Bosco', year: 'h. 1500' },
    { file: 'cazadores-nieve.webp', name: 'Cazadores en la nieve', artist: 'Pieter Brueghel el Viejo', year: '1565' },
    { file: 'vertumno.webp', name: 'Vertumno', artist: 'Giuseppe Arcimboldo', year: '1591' },
    { file: 'proverbios.webp', name: 'Los proverbios flamencos', artist: 'Pieter Brueghel el Viejo', year: '1559' },
    { file: 'meninas.webp', name: 'Las meninas', artist: 'Diego Velázquez', year: '1656' },
    { file: 'impresion.webp', name: 'Impresión, sol naciente', artist: 'Claude Monet', year: '1872' },
  ];

  root.Artworks = {
    count: LIST.length,
    list: LIST,
    url: (i) => DIR + LIST[((i % LIST.length) + LIST.length) % LIST.length].file,
    info: (i) => LIST[((i % LIST.length) + LIST.length) % LIST.length],
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
