// Beispielschaltungen (Koordinaten im Digital-Raster)
const W = arr => arr;
export const EXAMPLES = [
  {
    name: 'Halbaddierer', desc: 'XOR und UND – Summe und Übertrag',
    circuit: {
      comps: [
        { type: 'In', x: 120, y: 100, attrs: { Label: 'A' } },
        { type: 'In', x: 120, y: 140, attrs: { Label: 'B' } },
        { type: 'XOr', x: 200, y: 100, attrs: {} },
        { type: 'And', x: 200, y: 200, attrs: {} },
        { type: 'Out', x: 340, y: 120, attrs: { Label: 'S' } },
        { type: 'Out', x: 340, y: 220, attrs: { Label: 'C' } },
      ],
      wires: W([[120, 100, 200, 100], [120, 140, 200, 140], [160, 100, 160, 200], [160, 200, 200, 200], [140, 140, 140, 240], [140, 240, 200, 240], [260, 120, 340, 120], [260, 220, 340, 220]]),
    },
  },
  {
    name: 'RS-Latch', desc: 'Speicher aus zwei NOR-Gattern',
    circuit: {
      comps: [
        { type: 'In', x: 100, y: 100, attrs: { Label: 'R' } },
        { type: 'In', x: 100, y: 260, attrs: { Label: 'S' } },
        { type: 'NOr', x: 200, y: 100, attrs: {} },
        { type: 'NOr', x: 200, y: 220, attrs: {} },
        { type: 'Out', x: 400, y: 120, attrs: { Label: 'Q' } },
        { type: 'Out', x: 400, y: 240, attrs: { Label: '~Q' } },
      ],
      wires: W([[100, 100, 200, 100], [100, 260, 200, 260], [280, 120, 400, 120], [300, 120, 300, 180], [300, 180, 180, 180], [180, 180, 180, 220], [180, 220, 200, 220], [280, 240, 400, 240], [320, 240, 320, 160], [320, 160, 190, 160], [190, 160, 190, 140], [190, 140, 200, 140]]),
    },
  },
  {
    name: '4-Bit-Zähler', desc: 'Takt, Zähler und 7-Segment-Anzeige',
    circuit: {
      comps: [
        { type: 'Const', x: 280, y: 100, attrs: { Value: 1 } },
        { type: 'Clock', x: 240, y: 120, attrs: { Label: 'Takt', Frequency: 2, runRealTime: true } },
        { type: 'In', x: 240, y: 160, attrs: { Label: 'clr' } },
        { type: 'Counter', x: 300, y: 100, attrs: { Bits: 4 } },
        { type: 'Out', x: 460, y: 100, attrs: { Bits: 4, Label: 'Q' } },
        { type: 'Seven-Seg-Hex', x: 560, y: 40, attrs: {} },
      ],
      wires: W([[280, 100, 300, 100], [240, 120, 300, 120], [240, 160, 280, 160], [280, 160, 280, 140], [280, 140, 300, 140], [360, 100, 460, 100], [400, 100, 400, 200], [400, 200, 580, 200], [580, 200, 580, 180]]),
    },
  },
  {
    name: 'Volladdierer aus Bausteinen', desc: 'Zwei Halbaddierer als eigene Bausteine',
    main: 'Volladdierer',
    docs: {
      Halbaddierer: null, // wird unten gesetzt
      Volladdierer: {
        comps: [
          { type: 'In', x: 80, y: 100, attrs: { Label: 'A' } },
          { type: 'In', x: 80, y: 160, attrs: { Label: 'B' } },
          { type: 'In', x: 80, y: 300, attrs: { Label: 'Cin' } },
          { type: 'Sub', sub: 'Halbaddierer', x: 200, y: 100, attrs: { Label: 'HA1' } },
          { type: 'Sub', sub: 'Halbaddierer', x: 400, y: 140, attrs: { Label: 'HA2' } },
          { type: 'Or', x: 560, y: 260, attrs: {} },
          { type: 'Out', x: 700, y: 140, attrs: { Label: 'S' } },
          { type: 'Out', x: 700, y: 280, attrs: { Label: 'Cout' } },
        ],
        wires: [[80, 100, 200, 100], [80, 160, 160, 160], [160, 160, 160, 120], [160, 120, 200, 120], [260, 100, 340, 100], [340, 100, 340, 140], [340, 140, 400, 140],
          [80, 300, 360, 300], [360, 300, 360, 160], [360, 160, 400, 160], [260, 120, 300, 120], [300, 120, 300, 340], [300, 340, 540, 340], [540, 340, 540, 300], [540, 300, 560, 300],
          [460, 160, 520, 160], [520, 160, 520, 260], [520, 260, 560, 260], [460, 140, 700, 140], [620, 280, 700, 280]],
      },
    },
  },
];
EXAMPLES[3].docs.Halbaddierer = EXAMPLES[0].circuit;
