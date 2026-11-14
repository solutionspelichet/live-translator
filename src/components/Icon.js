import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

// A small set of line icons (24×24 grid, round caps, 1.8 stroke): the look of SF Symbols / Lucide, drawn here so the app needs no
// icon font and no emoji (their look changes with every phone). `fill` shapes are the few solid ones.
const ICONS = {
  mic: [
    ['rect', { x: 9, y: 3, width: 6, height: 11, rx: 3 }],
    ['path', { d: 'M5 11a7 7 0 0 0 14 0' }],
    ['line', { x1: 12, y1: 18, x2: 12, y2: 21 }],
    ['line', { x1: 9, y1: 21, x2: 15, y2: 21 }],
  ],
  text: [['path', { d: 'M4 7V5h16v2' }], ['line', { x1: 12, y1: 5, x2: 12, y2: 19 }], ['line', { x1: 9, y1: 19, x2: 15, y2: 19 }]],
  sparkles: [
    ['path', { d: 'M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z' }],
    ['path', { d: 'M19 3v4M17 5h4' }],
    ['path', { d: 'M18 15v4M16 17h4' }],
  ],
  notes: [
    ['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }],
    ['path', { d: 'M14 3v5h5' }],
    ['line', { x1: 9, y1: 13, x2: 15, y2: 13 }],
    ['line', { x1: 9, y1: 17, x2: 13, y2: 17 }],
  ],
  sliders: [
    ['path', { d: 'M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0' }],
    ['circle', { cx: 15, cy: 6, r: 2.2 }],
    ['circle', { cx: 9, cy: 12, r: 2.2 }],
    ['circle', { cx: 17, cy: 18, r: 2.2 }],
  ],
  sun: [
    ['circle', { cx: 12, cy: 12, r: 4 }],
    ['line', { x1: 12, y1: 2.5, x2: 12, y2: 4.5 }],
    ['line', { x1: 12, y1: 19.5, x2: 12, y2: 21.5 }],
    ['line', { x1: 2.5, y1: 12, x2: 4.5, y2: 12 }],
    ['line', { x1: 19.5, y1: 12, x2: 21.5, y2: 12 }],
    ['line', { x1: 5.3, y1: 5.3, x2: 6.7, y2: 6.7 }],
    ['line', { x1: 17.3, y1: 17.3, x2: 18.7, y2: 18.7 }],
    ['line', { x1: 5.3, y1: 18.7, x2: 6.7, y2: 17.3 }],
    ['line', { x1: 17.3, y1: 6.7, x2: 18.7, y2: 5.3 }],
  ],
  moon: [['path', { d: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z' }]],
  auto: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 3.5a8.5 8.5 0 0 1 0 17z', fill: true }]],
  clock: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 7v5l3 2' }]],
  chart: [['path', { d: 'M5 20V11M12 20V4M19 20v-6' }]],
  record: [['circle', { cx: 12, cy: 12, r: 5, fill: true }]],
  swap: [['path', { d: 'M8 4L4 8l4 4M4 8h14M16 20l4-4-4-4M20 16H6' }]],
  close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  back: [['path', { d: 'M15 5l-7 7 7 7' }]],
  chevron: [['path', { d: 'M9 5l7 7-7 7' }]],
  share: [['path', { d: 'M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7M16 7l-4-4-4 4M12 3v12' }]],
  check: [['path', { d: 'M5 13l4 4L19 7' }]],
  wave: [['path', { d: 'M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4' }]],
  globe: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M3.5 12h17M12 3.5c2.5 2.4 3.6 5.2 3.6 8.5s-1.1 6.1-3.6 8.5c-2.5-2.4-3.6-5.2-3.6-8.5S9.5 5.9 12 3.5z' }]],
  trash: [['path', { d: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3' }]],
  pencil: [['path', { d: 'M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z' }]],
  mail: [['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2.5 }], ['path', { d: 'M4 7l8 6 8-6' }]],
  bubble: [['path', { d: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z' }]],
  compass: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M15.5 8.5l-2 5-5 2 2-5z' }]],
  briefcase: [['rect', { x: 3, y: 7, width: 18, height: 13, rx: 2.5 }], ['path', { d: 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18' }]],
  lifebuoy: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['circle', { cx: 12, cy: 12, r: 3.5 }], ['path', { d: 'M6 6l3.5 3.5M18 6l-3.5 3.5M6 18l3.5-3.5M18 18l-3.5-3.5' }]],
  search: [['circle', { cx: 11, cy: 11, r: 6.5 }], ['path', { d: 'M16 16l4.5 4.5' }]],
  checkcircle: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M8 12.5l3 3 5-6' }]],
  headset: [['path', { d: 'M4 14v-2a8 8 0 0 1 16 0v2' }], ['rect', { x: 3, y: 14, width: 4, height: 6, rx: 1.5 }], ['rect', { x: 17, y: 14, width: 4, height: 6, rx: 1.5 }]],
  bolt: [['path', { d: 'M13 2L5 13.5h6L10 22l8-11.5h-6z' }]],
  rotate: [['path', { d: 'M20 11a8 8 0 1 0-2.4 5.7M20 4v7h-7' }]],
  info: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['line', { x1: 12, y1: 11, x2: 12, y2: 16.5 }], ['circle', { cx: 12, cy: 7.8, r: 0.6, fill: true }]],
  hands: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M8 12h2l1.5-3 1.5 6 1.5-3H16' }]],
};

const SHAPES = { path: Path, circle: Circle, line: Line, rect: Rect };

/** @param {{name: keyof typeof ICONS, size?: number, color?: string, stroke?: number}} props */
export default function Icon({ name, size = 22, color = '#000', stroke = 1.8 }) {
  const parts = ICONS[name] ?? [];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {parts.map(([shape, props], i) => {
        const Shape = SHAPES[shape];
        const { fill, ...rest } = props;
        return <Shape key={i} {...rest} {...(fill ? { fill: color, stroke: 'none' } : {})} />;
      })}
    </Svg>
  );
}

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));
