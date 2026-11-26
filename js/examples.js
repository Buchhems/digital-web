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
];
