import { noise1 } from '../noise';
import { TongueFire, blend, css, glow, mix, pine, seeded, shade, type RGB } from '../illustration';
import type { FireTap, FireTheme } from '../types';
import { IllustratedCampfire, type CampfireSetting, type CampfireView } from './classic';

/** Seconds between supernovae. */
const LOOP = 120;
// Supernova timeline, in seconds since it began.
const SWELL = 3;
const COLLAPSE = 3.6;
const SHOCK = 6.6;
const WHITE = 7.6;
const END = 10.6;

/** Roast gained per second while the marshmallow is held in the flames. */
const ROAST_RATE = 0.11;
/** Past this the marshmallow catches fire. */
const IGNITE = 1.05;

// The probe cannon, in seconds since the loop began: it charges, fires, and breaks apart.
const CHARGE_AT = 1.6;
const FIRE_AT = 2.4;
const BREAK_AT = 2.6;

// Ship flight, in seconds.
const ASCENT = 4.5;
const AWAY = 7;
const DESCENT = 2;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const ease = (t: number) => t * t * (3 - 2 * t);
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);

type Point = { x: number; y: number };
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Distance from p to the segment a–b. */
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// ---- Layout ----

/** The curved ground of a planet small enough to see it bend away. */
function planet({ width, scale: s, cx, cy }: CampfireView) {
  const top = cy - 44 * s;
  const r = Math.max(width * 1.35, 860 * s);
  const center = { x: cx, y: top + r };
  return {
    r,
    center,
    /** Surface height at x. */
    y: (x: number) => center.y - Math.sqrt(Math.max(0, r * r - (x - cx) ** 2)),
    /** Lean of the surface normal at x — trees and towers stand along it. */
    angle: (x: number) => Math.asin(clamp((x - cx) / r, -1, 1)),
  };
}

const sunOf = ({ width, height, scale: s }: CampfireView) => ({ x: width * 0.17, y: height * 0.17, r: 13 * s });

/** Giant's Deep (거인의 심연): a storm-wrapped ocean world, high on the right. */
function giantOf({ width, height, scale: s }: CampfireView) {
  const r = Math.min(70 * s, width * 0.1);
  return { x: width * 0.82, y: height * 0.2, r };
}

/** The Quantum Moon (양자의 달), drifting near Giant's Deep. */
function quantumMoonOf(view: CampfireView) {
  const g = giantOf(view);
  return { x: g.x - g.r * 1.6, y: g.y + g.r * 0.9, r: g.r * 0.17 };
}

/** Attlerock (잔바위): the home planet's small cratered moon, low on the right. */
function attlerockOf(view: CampfireView) {
  // Higher on narrow screens, where the title spans the full width.
  return { x: view.width * 0.9, y: view.height * (view.width < 600 ? 0.33 : 0.43), r: giantOf(view).r * 0.22 };
}

/** Brittle Hollow (조각난 공동): a grey world with ice over both poles, below the sun. */
function hollowOf(view: CampfireView) {
  return { x: view.width * 0.33, y: view.height * 0.27, r: giantOf(view).r * 0.8 };
}

/** Dark Bramble (검은 가시덤불): a ball of dark, thorny vines, high in the middle of the sky. */
function brambleOf(view: CampfireView) {
  return { x: view.width * 0.6, y: view.height * 0.12, r: giantOf(view).r * 0.5 };
}

/** Seconds for the comet to cross the sky. */
const COMET_PERIOD = 70;

/** The comet's head, arcing across the sky. */
function cometOf({ width, height, scale: s, time }: CampfireView) {
  const k = (time / COMET_PERIOD) % 1;
  return { x: width * (0.04 + 0.92 * k), y: height * (0.32 - 0.22 * Math.sin(Math.PI * k)), r: 4 * s };
}

/** Two small sandy planets circling each other in the top-left corner. */
function twinsOf({ width, height, scale: s, time }: CampfireView) {
  const r = 9 * s;
  const x = Math.max(width * 0.08, 34 * s);
  const y = height * 0.08 + 6 * s;
  const a = time * 0.5;
  const d = 15 * s;
  return {
    x,
    y,
    r: r + d,
    a: { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.45, r },
    b: { x: x - Math.cos(a) * d, y: y - Math.sin(a) * d * 0.45, r: r * 0.85 },
  };
}

/** The ancient probe cannon orbiting in front of the gas giant, barrel aimed up and away. */
function cannonOf(view: CampfireView) {
  const g = giantOf(view);
  const length = Math.max(g.r * 1.7, 60 * view.scale);
  const angle = -2.55;
  return {
    x: g.x - g.r * 0.1,
    y: g.y + g.r * 0.35,
    angle,
    length,
    width: length * 0.15,
    /** Unit vector from the breech to the muzzle. */
    dir: { x: Math.cos(angle), y: Math.sin(angle) },
  };
}

/** Stone masks on little plinths among the trees, kept clear of the tower, shard spots and stick. */
function masksOf(view: CampfireView) {
  const { width, scale: s, cx, cy } = view;
  const ground = planet(view);
  const tower = towerOf(view);
  const taken = [
    ...(tower ? [tower.foot.x] : []),
    ...shardSpots(view).filter((p) => !p.floating).map((p) => p.x),
    stickOf(view, 0).base.x,
    cx,
  ];
  const masks: { x: number; y: number; angle: number }[] = [];
  // Spots beside the clearing first, then the screen edges for narrow screens.
  const spots = [...[-185, 265, -330, 390, -450].map((offset) => cx + offset * s), width * 0.07, width * 0.93];
  for (const x of spots) {
    if (x < 24 * s || x > width - 24 * s) continue;
    if (taken.some((t) => Math.abs(t - x) < 50 * s)) continue;
    masks.push({ x, y: Math.min(ground.y(x) + 3 * s, cy + 40 * s), angle: ground.angle(x) });
    if (masks.length === 3) break;
  }
  return masks;
}

/** Every signal source, in the order of `TinyPlanet.signals`: each traveller's camp. */
const sourcesOf = (view: CampfireView) => [
  hollowOf(view),
  giantOf(view),
  brambleOf(view),
  quantumMoonOf(view),
  attlerockOf(view),
  twinsOf(view),
];

/** The launch tower: base on the ground, leaning with it; null when there's no room for it. */
function towerOf(view: CampfireView) {
  const { width, scale: s, cx } = view;
  const ground = planet(view);
  const x = cx - Math.min(250 * s, width * 0.3);
  const base = 34 * s;
  if (x - base < 6) return null;
  const angle = ground.angle(x);
  const height = 210 * s;
  const foot = { x, y: ground.y(x) + 4 * s };
  /** Unit vector pointing up the tower. */
  const up = { x: Math.sin(angle), y: -Math.cos(angle) };
  const dock = { x: foot.x + up.x * (height + 4 * s), y: foot.y + up.y * (height + 4 * s) };
  return { foot, angle, height, base, top: 20 * s, up, dock };
}

/** Where the marshmallow sits on its stick, `reach` 0 (resting) to 1 (in the flames). */
function stickOf({ scale: s, cx, cy }: CampfireView, reach: number) {
  const base = { x: cx + 175 * s, y: cy + 26 * s };
  const tip = lerp({ x: cx + 128 * s, y: cy - 128 * s }, { x: cx + 40 * s, y: cy - 64 * s }, ease(reach));
  return { base, tip };
}

/** Places the quantum shard can be found. */
function shardSpots(view: CampfireView) {
  const { width, scale: s, cx } = view;
  const ground = planet(view);
  const g = giantOf(view);
  const onGround = (x: number) => ({ x, y: ground.y(x) + 2 * s, angle: ground.angle(x), floating: false });
  return [
    onGround(cx - 130 * s),
    onGround(cx + Math.min(300 * s, width * 0.42)),
    onGround(cx + 215 * s),
    { x: g.x - g.r * 2.4, y: g.y + g.r * 1.8, angle: 0, floating: true },
  ].filter((p) => p.x > 16 && p.x < width - 16);
}

// ---- Sound ----

/** Synthesized voices for the signal scope and the ship. Starts on the first tap (browsers need a gesture). */
class Voices {
  private ac: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  /** Where the slide whistle's slide was left, for the glide into its next note. */
  private lastSlide = 0;
  private bus: AudioNode | null = null;

  get ready() {
    return this.ac?.state === 'running';
  }

  /** Audio clock in seconds, for scheduling notes ahead of time. */
  get now() {
    return this.ac?.currentTime ?? 0;
  }

  start() {
    try {
      this.ac ??= new AudioContext();
      void this.ac.resume();
    } catch {
      // Audio is optional.
    }
  }

  /** A plucked string, banjo-ish: bright attack, quick decay. `when` is on the audio clock. */
  pluck(freq: number, gain: number, when?: number) {
    const ac = this.ac;
    if (!ac || gain < 0.002) return;
    const now = when ?? ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * 1.01, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.05);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 8, now);
    filter.frequency.exponentialRampToValueAtTime(freq * 2, now + 0.4);
    const env = ac.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0005, now + 0.7);
    osc.connect(filter).connect(env).connect(this.output(ac));
    osc.start(now);
    osc.stop(now + 0.75);
  }

  /** A breathy flute note with a little vibrato. `when` is on the audio clock. */
  flute(freq: number, gain: number, length: number, when?: number) {
    const ac = this.ac;
    if (!ac || gain < 0.002) return;
    const now = when ?? ac.currentTime;
    const osc = ac.createOscillator();
    osc.frequency.value = freq;
    const vibrato = ac.createOscillator();
    vibrato.frequency.value = 5;
    const depth = ac.createGain();
    depth.gain.value = freq * 0.006;
    vibrato.connect(depth).connect(osc.frequency);
    const env = ac.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.08);
    env.gain.setValueAtTime(gain, now + length * 0.7);
    env.gain.linearRampToValueAtTime(0, now + length);
    osc.connect(env).connect(this.output(ac));
    osc.start(now);
    vibrato.start(now);
    osc.stop(now + length + 0.05);
    vibrato.stop(now + length + 0.05);
  }

  /**
   * A slide whistle: a pure tone that glides from wherever the last note left off, the way the
   * slide is pushed from note to note.
   */
  slideWhistle(freq: number, gain: number, length: number, when?: number) {
    const ac = this.ac;
    if (!ac || gain < 0.002) return;
    const now = when ?? ac.currentTime;
    const from = this.lastSlide || freq;
    this.lastSlide = freq;
    const osc = ac.createOscillator();
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + Math.min(0.09, length * 0.4));
    const env = ac.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.03);
    env.gain.setValueAtTime(gain, now + length * 0.8);
    env.gain.linearRampToValueAtTime(0, now + length);
    osc.connect(env).connect(this.output(ac));
    osc.start(now);
    osc.stop(now + length + 0.05);
  }

  /** A harmonica: a reedy square wave, softened, with a slow wobble. */
  harmonica(freq: number, gain: number, length: number, when?: number) {
    const ac = this.ac;
    if (!ac || gain < 0.002) return;
    const now = when ?? ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const vibrato = ac.createOscillator();
    vibrato.frequency.value = 4.5;
    const depth = ac.createGain();
    depth.gain.value = freq * 0.005;
    vibrato.connect(depth).connect(osc.frequency);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq * 3;
    const env = ac.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.12);
    env.gain.setValueAtTime(gain, now + length * 0.8);
    env.gain.linearRampToValueAtTime(0, now + length);
    osc.connect(filter).connect(env).connect(this.output(ac));
    osc.start(now);
    vibrato.start(now);
    osc.stop(now + length + 0.05);
    vibrato.stop(now + length + 0.05);
  }

  /** A piano-ish note: a struck tone with a soft overtone, ringing down. */
  piano(freq: number, gain: number, length: number, when?: number) {
    const ac = this.ac;
    if (!ac || gain < 0.002) return;
    const now = when ?? ac.currentTime;
    const ring = Math.max(0.6, length * 1.4);
    const env = ac.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.008);
    env.gain.exponentialRampToValueAtTime(gain * 0.35, now + 0.25);
    env.gain.exponentialRampToValueAtTime(0.0005, now + ring);
    env.connect(this.output(ac));
    for (const [ratio, level, type] of [
      [1, 1, 'triangle'],
      [2, 0.25, 'sine'],
    ] as const) {
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * ratio;
      const g = ac.createGain();
      g.gain.value = level;
      osc.connect(g).connect(env);
      osc.start(now);
      osc.stop(now + ring + 0.05);
    }
  }

  /** Hand drums: a conga's tuned slap, or a frame drum's low, papery thump. */
  drum(kind: 'conga' | 'frame', gain: number, when?: number) {
    const ac = this.ac;
    if (!ac || gain < 0.002) return;
    const now = when ?? ac.currentTime;
    const [high, low, decay, hiss] = kind === 'conga' ? [330, 240, 0.18, 0.15] : [140, 70, 0.3, 0.3];
    const osc = ac.createOscillator();
    osc.frequency.setValueAtTime(high, now);
    osc.frequency.exponentialRampToValueAtTime(low, now + decay * 0.6);
    const env = ac.createGain();
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0005, now + decay);
    osc.connect(env).connect(this.output(ac));
    osc.start(now);
    osc.stop(now + decay + 0.02);
    // The skin's slap: a breath of filtered noise on top.
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuffer(ac);
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = kind === 'conga' ? 2500 : 900;
    const slap = ac.createGain();
    slap.gain.setValueAtTime(gain * hiss, now);
    slap.gain.exponentialRampToValueAtTime(0.0005, now + 0.05);
    src.connect(filter).connect(slap).connect(this.output(ac));
    src.start(now, Math.random());
    src.stop(now + 0.06);
  }

  /** The cannon's distant boom: a low thump under a burst of muffled noise. */
  boom() {
    const ac = this.ac;
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuffer(ac);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const env = ac.createGain();
    env.gain.setValueAtTime(0.18, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    src.connect(filter).connect(env).connect(this.output(ac));
    src.start(now, Math.random());
    src.stop(now + 1.2);
    const osc = ac.createOscillator();
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.5);
    const thump = ac.createGain();
    thump.gain.setValueAtTime(0.22, now);
    thump.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(thump).connect(this.output(ac));
    osc.start(now);
    osc.stop(now + 0.6);
  }

  /** Low engine roar for a launch. */
  rumble(seconds: number) {
    const ac = this.ac;
    if (!ac) return;
    const now = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuffer(ac);
    src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    const env = ac.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.35, now + 0.3);
    env.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    src.connect(filter).connect(env).connect(this.output(ac));
    src.start(now);
    src.stop(now + seconds);
  }

  close() {
    void this.ac?.close();
    this.ac = null;
    this.bus = null;
  }

  /** Everything plays through one compressor, so the full ensemble doesn't clip. */
  private output(ac: AudioContext) {
    if (!this.bus) {
      const compressor = ac.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 4;
      compressor.connect(ac.destination);
      this.bus = compressor;
    }
    return this.bus;
  }

  /** Two seconds of white noise, made once. */
  private noiseBuffer(ac: AudioContext) {
    if (!this.noise) {
      const length = Math.floor(ac.sampleRate * 2);
      this.noise = ac.createBuffer(1, length, ac.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }
}

type Voice = 'banjo' | 'flute' | 'harmonica' | 'piano' | 'slide' | 'drums';

interface Signal {
  /** What the scope reads out when it locks on. */
  label: string;
  voice: Voice;
  /** Loudness at full signal. */
  gain: number;
  strength: number;
}

/** One note of the theme: which signal plays it, when (in eighths into the loop), pitch (MIDI) and length (eighths). */
interface ThemeNote {
  signal: number;
  at: number;
  note: number;
  length: number;
}

// "Traveller Themes" by Andrew Prahlow, bars 1–8 (they repeat from bar 9), used with permission.
// Each traveller's instrument comes from their camp — Riebeck on Brittle Hollow, Gabbro on
// Giant's Deep, Feldspar in Dark Bramble, Solanum on the Quantum Moon, Esker on Attlerock and
// Chert on the Hourglass Twins — on a shared clock, so aiming between planets layers them.
const TEMPO = 92;
const EIGHTH = 60 / TEMPO / 2;
const LOOP_EIGHTHS = 64;
/** Notes are scheduled this far ahead on the audio clock, so frame timing doesn't make them stutter. */
const LOOKAHEAD = 0.2;

/** [eighths into the loop, MIDI note, length in eighths] */
type Notes = [number, number, number][];
const part = (signal: number, notes: Notes, transpose = 0): ThemeNote[] =>
  notes.map(([at, note, length]) => ({ signal, at, note: note + transpose, length }));

/** The tune the banjo and slide whistle share, as written. */
const TUNE: Notes = [
  [0, 60, 2], [2, 67, 2], [4, 71, 3], [7, 67, 1], // C G B. G
  [8, 72, 1], [9, 71, 1], [10, 69, 1], [11, 67, 1], [12, 69, 1], [13, 71, 1], [14, 67, 2], // c B A G A B G
  [16, 62, 2], [18, 67, 2], [20, 71, 3], [23, 67, 1], // D G B. G
  [24, 72, 1], [25, 71, 1], [26, 69, 1], [27, 67, 1], [28, 69, 1], [29, 71, 1], [30, 74, 1], [31, 71, 1], // c B A G A B d B
  [32, 64, 2], [34, 67, 2], [36, 71, 3], [39, 67, 1], // E G B. G
  [40, 72, 1], [41, 71, 1], [42, 69, 1], [43, 67, 1], [44, 69, 1], [45, 71, 1], [46, 67, 2],
  [48, 62, 2], [50, 67, 2], [52, 71, 3], [55, 67, 1],
  [56, 72, 1], [57, 71, 1], [58, 69, 1], [59, 67, 1], [60, 69, 1], [61, 71, 1], [62, 74, 1], [63, 71, 1],
];

/** Piano left hand: crotchets on the root, C C D D E E D D by bar. */
const PIANO_LEFT: Notes = [48, 48, 50, 50, 52, 52, 50, 50].flatMap((root, bar) =>
  [0, 2, 4, 6].map((beat): [number, number, number] => [bar * 8 + beat, root, 2]),
);

/** Drum hits by bar, in eighths: congas (note 0) and frame drum (note 1). */
const CONGA = [[1, 2, 4, 6, 7], [], [1, 2, 4, 6, 7], [1, 5, 7]];
const FRAME = [[0, 2, 3, 4, 5], [0, 3, 4, 6], [0, 2, 3, 4, 5], [0, 3, 4, 6]];
const CONGA_HIT = 0;
const DRUM_HITS: Notes = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((bar) => [
  ...CONGA[bar % 4].map((at): [number, number, number] => [bar * 8 + at, CONGA_HIT, 1]),
  ...FRAME[bar % 4].map((at): [number, number, number] => [bar * 8 + at, 1 - CONGA_HIT, 1]),
]);

const THEME: ThemeNote[] = [
  // Banjo, written an octave above where it sounds.
  ...part(0, TUNE, -12),
  // Bass flute: long notes under each pair of bars.
  ...part(1, [[0, 60, 16], [16, 62, 16], [32, 64, 16], [48, 62, 8], [56, 67, 4], [60, 69, 4]]),
  // Harmonica, written an octave below where it sounds.
  ...part(2, [[0, 71, 16], [16, 67, 16], [32, 62, 16], [48, 55, 16]], 12),
  // Piano right hand, then left.
  ...part(3, [
    [0, 67, 3], [3, 62, 3], [6, 67, 3], [9, 62, 3], [12, 67, 2], [14, 69, 2],
    [16, 67, 3], [19, 66, 3], [22, 67, 3], [25, 66, 3], [28, 72, 2], [30, 71, 2],
    [32, 67, 3], [35, 62, 3], [38, 59, 3], [41, 67, 3], [44, 60, 2], [46, 59, 2],
    [48, 69, 3], [51, 71, 3], [54, 69, 3], [57, 71, 3], [60, 69, 1], [61, 71, 1], [62, 74, 1], [63, 71, 1],
  ]),
  ...part(3, PIANO_LEFT),
  // Slide whistle: the banjo's tune, written an octave below where it sounds.
  ...part(4, TUNE, 12),
  ...part(5, DRUM_HITS),
].sort((a, b) => a.at - b.at);

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
}

// ---- Static scenery ----

/** Adds a path to `out`, placed at (x, y), turned by `angle`, and squeezed horizontally by `sx`. */
function put(out: Path2D, path: Path2D, x: number, y: number, angle: number, sx = 1) {
  out.addPath(path, new DOMMatrix().translateSelf(x, y).rotateSelf((angle * 180) / Math.PI).scaleSelf(sx, 1));
}

function paintScene(ctx: CanvasRenderingContext2D, view: CampfireView) {
  const { width, height, scale: s, cx } = view;
  const ground = planet(view);
  const rand = seeded(1977);

  const sky = ctx.createLinearGradient(0, 0, 0, ground.y(cx));
  sky.addColorStop(0, '#060c1f');
  sky.addColorStop(0.55, '#0e2340');
  sky.addColorStop(1, '#1d4552');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // Nebulae: broad, faint clouds of colour.
  for (const [x, y, r, color] of [
    [0.3, 0.12, 0.35, '120, 70, 160'],
    [0.75, 0.32, 0.3, '40, 140, 160'],
    [0.55, 0.05, 0.22, '200, 90, 120'],
  ] as const) {
    const g = ctx.createRadialGradient(width * x, height * y, 0, width * x, height * y, width * r);
    g.addColorStop(0, `rgba(${color}, 0.16)`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.fillStyle = '#f2f4ff';
  for (let i = 0; i < 260; i++) {
    ctx.globalAlpha = 0.15 + rand() * 0.6;
    const size = rand() < 0.07 ? 1.8 : 1;
    ctx.fillRect(rand() * width, rand() * height * 0.75, size, size);
  }
  ctx.globalAlpha = 1;

  // Giant's Deep: a green ocean under streaks of cloud, with white storms spiralling over it.
  const g = giantOf(view);
  ctx.save();
  ctx.beginPath();
  ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#2f7d6a';
  ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
  const bands = ['rgba(120, 200, 170, 0.35)', 'rgba(20, 80, 70, 0.35)', 'rgba(170, 225, 200, 0.3)'];
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = bands[i % bands.length];
    const y = g.y - g.r + (i / 10) * g.r * 2 + Math.sin(i * 2.1) * 3 * s;
    ctx.beginPath();
    ctx.ellipse(g.x + Math.sin(i * 1.7) * g.r * 0.3, y, g.r * 1.1, g.r * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(235, 248, 242, 0.7)';
  ctx.lineWidth = Math.max(1, 1.4 * s);
  for (const [dx, dy, k] of [[-0.35, -0.3, 0.2], [0.3, 0.15, 0.16], [-0.1, 0.45, 0.13]]) {
    // A tornado seen from above: a tight spiral.
    const ox = g.x + dx * g.r;
    const oy = g.y + dy * g.r;
    ctx.beginPath();
    for (let t = 0; t <= 1; t += 0.05) {
      const a = t * Math.PI * 3.2;
      const r = g.r * k * t;
      if (t === 0) ctx.moveTo(ox, oy);
      else ctx.lineTo(ox + Math.cos(a) * r, oy + Math.sin(a) * r * 0.8);
    }
    ctx.stroke();
  }
  const night = ctx.createLinearGradient(g.x - g.r, g.y - g.r, g.x + g.r, g.y + g.r);
  night.addColorStop(0.25, 'rgba(6, 12, 31, 0)');
  night.addColorStop(1, 'rgba(6, 12, 31, 0.9)');
  ctx.fillStyle = night;
  ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
  ctx.restore();
  // The Quantum Moon: pale grey under a thin violet haze.
  const moon = quantumMoonOf(view);
  const mist = ctx.createRadialGradient(moon.x, moon.y, moon.r * 0.8, moon.x, moon.y, moon.r * 2.2);
  mist.addColorStop(0, 'rgba(190, 170, 240, 0.35)');
  mist.addColorStop(1, 'rgba(190, 170, 240, 0)');
  ctx.fillStyle = mist;
  ctx.fillRect(moon.x - moon.r * 2.2, moon.y - moon.r * 2.2, moon.r * 4.4, moon.r * 4.4);
  ctx.fillStyle = '#b4b8c6';
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
  ctx.fill();

  // Attlerock: a small grey moon pocked with craters.
  const rock = attlerockOf(view);
  ctx.save();
  ctx.beginPath();
  ctx.arc(rock.x, rock.y, rock.r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#8d9097';
  ctx.fillRect(rock.x - rock.r, rock.y - rock.r, rock.r * 2, rock.r * 2);
  ctx.fillStyle = '#6c6f77';
  for (const [dx, dy, k] of [[-0.3, -0.25, 0.28], [0.35, 0.2, 0.22], [-0.1, 0.45, 0.18], [0.25, -0.45, 0.14]]) {
    ctx.beginPath();
    ctx.arc(rock.x + dx * rock.r, rock.y + dy * rock.r, rock.r * k, 0, Math.PI * 2);
    ctx.fill();
  }
  const rockNight = ctx.createLinearGradient(rock.x - rock.r, rock.y - rock.r, rock.x + rock.r, rock.y + rock.r);
  rockNight.addColorStop(0.3, 'rgba(6, 12, 31, 0)');
  rockNight.addColorStop(1, 'rgba(6, 12, 31, 0.8)');
  ctx.fillStyle = rockNight;
  ctx.fillRect(rock.x - rock.r, rock.y - rock.r, rock.r * 2, rock.r * 2);
  ctx.restore();

  paintHollow(ctx, view);


  // Dark Bramble: a knot of dark, thorny vines with pale fog showing through the gaps.
  const bramble = brambleOf(view);
  ctx.save();
  ctx.beginPath();
  ctx.arc(bramble.x, bramble.y, bramble.r, 0, Math.PI * 2);
  ctx.clip();
  const fog = ctx.createRadialGradient(bramble.x, bramble.y, 0, bramble.x, bramble.y, bramble.r);
  fog.addColorStop(0, '#d9e3dc');
  fog.addColorStop(0.55, '#8e9a93');
  fog.addColorStop(1, '#3a403c');
  ctx.fillStyle = fog;
  ctx.fillRect(bramble.x - bramble.r, bramble.y - bramble.r, bramble.r * 2, bramble.r * 2);
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    // Vines wrapping round the sphere as tilted arcs, each with a few thorns.
    const rx = bramble.r * (0.55 + rand() * 0.6);
    const ry = bramble.r * (0.15 + rand() * 0.45);
    const tilt = rand() * Math.PI;
    const ox = bramble.x + (rand() - 0.5) * bramble.r * 0.5;
    const oy = bramble.y + (rand() - 0.5) * bramble.r * 0.5;
    const start = rand() * Math.PI * 2;
    const sweep = 1.5 + rand() * 2;
    ctx.strokeStyle = rand() < 0.5 ? '#1b201c' : '#2a312b';
    ctx.lineWidth = bramble.r * (0.06 + rand() * 0.06);
    ctx.beginPath();
    ctx.ellipse(ox, oy, rx, ry, tilt, start, start + sweep);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.8, bramble.r * 0.025);
    for (let k = 1; k < 4; k++) {
      const a = start + (sweep * k) / 4;
      const px = ox + Math.cos(a) * rx * Math.cos(tilt) - Math.sin(a) * ry * Math.sin(tilt);
      const py = oy + Math.cos(a) * rx * Math.sin(tilt) + Math.sin(a) * ry * Math.cos(tilt);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + (rand() - 0.5) * bramble.r * 0.25, py + (rand() - 0.5) * bramble.r * 0.25);
      ctx.stroke();
    }
  }
  const brambleNight = ctx.createLinearGradient(bramble.x - bramble.r, bramble.y - bramble.r, bramble.x + bramble.r, bramble.y + bramble.r);
  brambleNight.addColorStop(0.35, 'rgba(6, 12, 31, 0)');
  brambleNight.addColorStop(1, 'rgba(6, 12, 31, 0.75)');
  ctx.fillStyle = brambleNight;
  ctx.fillRect(bramble.x - bramble.r, bramble.y - bramble.r, bramble.r * 2, bramble.r * 2);
  ctx.restore();
  ctx.lineCap = 'butt';

  // Trees standing out along the curve, the far row paler, leaving room around the fire.
  const clearing = 200 * s;
  const far = new Path2D();
  const near = new Path2D();
  for (const [row, out, step, size] of [
    [0, far, 22, 0.65],
    [1, near, 38, 1],
  ] as const) {
    for (let x = -30; x < width + 30; x += (step + rand() * step) * s) {
      if (Math.abs(x - cx) < clearing * (row ? 1.05 : 0.7)) continue;
      const tree = new Path2D();
      pine(tree, 0, 0, (90 + rand() * 90) * s * size, rand);
      put(out, tree, x, ground.y(x) + (row ? 6 : 2) * s, ground.angle(x), 0.6);
    }
  }
  ctx.fillStyle = '#18323a';
  ctx.fill(far);

  ctx.fillStyle = '#163027';
  ctx.beginPath();
  ctx.arc(ground.center.x, ground.center.y, ground.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a4a3a';
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.arc(ground.center.x, ground.center.y, ground.r - 1.5 * s, Math.PI, Math.PI * 2);
  ctx.stroke();

  drawTower(ctx, view);
  ctx.fillStyle = '#0f211d';
  ctx.fill(near);
}

/** The crumbling hollow: grey rock with patchy darker ground, and ice capping both poles. */
function paintHollow(ctx: CanvasRenderingContext2D, view: CampfireView) {
  const s = view.scale;
  const h = hollowOf(view);
  const sun = sunOf(view);
  const d = Math.hypot(sun.x - h.x, sun.y - h.y) || 1;
  const lit = { x: (sun.x - h.x) / d, y: (sun.y - h.y) / d };
  const rand = seeded(31);

  const haze = ctx.createRadialGradient(h.x, h.y, h.r * 0.92, h.x, h.y, h.r * 1.3);
  haze.addColorStop(0, 'rgba(150, 170, 220, 0.25)');
  haze.addColorStop(1, 'rgba(150, 170, 220, 0)');
  ctx.fillStyle = haze;
  ctx.fillRect(h.x - h.r * 1.4, h.y - h.r * 1.4, h.r * 2.8, h.r * 2.8);

  ctx.save();
  ctx.beginPath();
  ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
  ctx.clip();

  const rock = ctx.createRadialGradient(h.x + lit.x * h.r * 0.45, h.y + lit.y * h.r * 0.45, 0, h.x, h.y, h.r * 1.1);
  rock.addColorStop(0, '#9a9ca3');
  rock.addColorStop(0.6, '#74777f');
  rock.addColorStop(1, '#4a4c54');
  ctx.fillStyle = rock;
  ctx.fillRect(h.x - h.r, h.y - h.r, h.r * 2, h.r * 2);

  // Darker ground and a few craters across the middle latitudes.
  for (let i = 0; i < 9; i++) {
    const x = h.x + (rand() - 0.5) * h.r * 1.6;
    const y = h.y + (rand() - 0.5) * h.r * 0.9;
    ctx.fillStyle = 'rgba(60, 62, 70, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y, h.r * (0.12 + rand() * 0.2), h.r * (0.06 + rand() * 0.1), rand(), 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 6; i++) {
    const x = h.x + (rand() - 0.5) * h.r * 1.3;
    const y = h.y + (rand() - 0.5) * h.r * 0.8;
    const r = h.r * (0.04 + rand() * 0.06);
    ctx.fillStyle = 'rgba(55, 57, 64, 0.5)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190, 192, 200, 0.35)';
    ctx.lineWidth = Math.max(0.6, 0.8 * s);
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }

  // Ice caps over both poles, with ragged edges.
  for (const pole of [-1, 1]) {
    const cap = new Path2D();
    const edge = h.y + pole * h.r * 0.64;
    cap.moveTo(h.x - h.r, h.y + pole * h.r);
    for (let i = 0; i <= 12; i++) {
      const x = h.x - h.r + (i / 12) * h.r * 2;
      cap.lineTo(x, edge + pole * (Math.abs(x - h.x) / h.r) ** 2 * h.r * 0.25 + (rand() - 0.5) * h.r * 0.1);
    }
    cap.lineTo(h.x + h.r, h.y + pole * h.r);
    cap.closePath();
    ctx.fillStyle = '#e6eef6';
    ctx.fill(cap);
    ctx.strokeStyle = 'rgba(160, 190, 220, 0.8)';
    ctx.lineWidth = Math.max(0.8, 1 * s);
    ctx.stroke(cap);
  }

  // Shade the side turned away from the sun, and darken towards the limb.
  const night = ctx.createLinearGradient(h.x + lit.x * h.r, h.y + lit.y * h.r, h.x - lit.x * h.r, h.y - lit.y * h.r);
  night.addColorStop(0.4, 'rgba(6, 12, 31, 0)');
  night.addColorStop(1, 'rgba(6, 12, 31, 0.75)');
  ctx.fillStyle = night;
  ctx.fillRect(h.x - h.r, h.y - h.r, h.r * 2, h.r * 2);
  const limb = ctx.createRadialGradient(h.x, h.y, h.r * 0.6, h.x, h.y, h.r);
  limb.addColorStop(0, 'rgba(6, 10, 24, 0)');
  limb.addColorStop(1, 'rgba(6, 10, 24, 0.45)');
  ctx.fillStyle = limb;
  ctx.fillRect(h.x - h.r, h.y - h.r, h.r * 2, h.r * 2);
  ctx.restore();
}

/** A wooden lattice launch tower, standing along the planet's curve. */
function drawTower(ctx: CanvasRenderingContext2D, view: CampfireView) {
  const tower = towerOf(view);
  if (!tower) return;
  const s = view.scale;
  const { height, base, top: topW } = tower;
  ctx.save();
  ctx.translate(tower.foot.x, tower.foot.y);
  ctx.rotate(tower.angle);
  ctx.strokeStyle = '#4a3527';
  ctx.lineCap = 'round';
  ctx.lineWidth = 4 * s;
  ctx.beginPath();
  ctx.moveTo(-base / 2, 0);
  ctx.lineTo(-topW / 2, -height);
  ctx.moveTo(base / 2, 0);
  ctx.lineTo(topW / 2, -height);
  ctx.stroke();
  ctx.lineWidth = 2 * s;
  ctx.strokeStyle = '#3a2a20';
  const steps = 7;
  for (let i = 0; i < steps; i++) {
    const y0 = -(i / steps) * height;
    const y1 = -((i + 1) / steps) * height;
    const w0 = base / 2 - ((base - topW) / 2) * (i / steps);
    const w1 = base / 2 - ((base - topW) / 2) * ((i + 1) / steps);
    ctx.beginPath();
    ctx.moveTo(-w0, y0);
    ctx.lineTo(w1, y1);
    ctx.moveTo(w0, y0);
    ctx.lineTo(-w1, y1);
    ctx.moveTo(-w1, y1);
    ctx.lineTo(w1, y1);
    ctx.stroke();
  }
  ctx.fillStyle = '#5a4030';
  ctx.fillRect(-topW, -height - 4 * s, topW * 2, 5 * s);
  ctx.restore();
}

/** The ship: a stubby capsule on three legs with a warm window. Origin at its feet. */
function drawShip(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, s: number, thrust: number, time: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  if (thrust > 0.02) {
    // Exhaust flame under the hull.
    const flick = 0.8 + 0.3 * noise1(time * 18);
    const len = 30 * s * thrust * flick;
    for (const [w, l, color] of [
      [11, 1, '#f47b28'],
      [7, 0.65, '#ffbb3f'],
      [4, 0.35, '#fff1bd'],
    ] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-w * s, -10 * s);
      ctx.quadraticCurveTo(-w * 0.6 * s, -10 * s + len * l * 0.6, 0, -10 * s + len * l);
      ctx.quadraticCurveTo(w * 0.6 * s, -10 * s + len * l * 0.6, w * s, -10 * s);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.strokeStyle = '#6b6f78';
  ctx.lineWidth = 2.5 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-12 * s, 0);
  ctx.lineTo(-8 * s, -12 * s);
  ctx.moveTo(12 * s, 0);
  ctx.lineTo(8 * s, -12 * s);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -10 * s);
  ctx.stroke();
  const hull = new Path2D();
  hull.moveTo(-16 * s, -12 * s);
  hull.bezierCurveTo(-18 * s, -40 * s, -8 * s, -56 * s, 0, -60 * s);
  hull.bezierCurveTo(8 * s, -56 * s, 18 * s, -40 * s, 16 * s, -12 * s);
  hull.closePath();
  shade(ctx, hull, { base: '#8c8a86', shadow: '#5d5b59', light: '#b4b1aa' }, { x: -1, y: -0.3 }, 3 * s, 7 * s);
  ctx.save();
  ctx.clip(hull);
  ctx.fillStyle = '#b5644a';
  ctx.fillRect(-20 * s, -24 * s, 40 * s, 5 * s);
  ctx.restore();
  ctx.fillStyle = '#ffd27a';
  ctx.beginPath();
  ctx.arc(0, -40 * s, 5.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 210, 122, 0.25)';
  ctx.beginPath();
  ctx.arc(0, -40 * s, 11 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Marshmallow colour by roast: white, golden, brown, charcoal. */
function toast(roast: number): RGB {
  const stops: [number, RGB][] = [
    [0, [251, 246, 236]],
    [0.4, [240, 194, 122]],
    [0.75, [165, 98, 43]],
    [1, [42, 26, 18]],
  ];
  let i = 1;
  while (i < stops.length - 1 && stops[i][0] < roast) i++;
  const [p0, c0] = stops[i - 1];
  const [p1, c1] = stops[i];
  return mix(c0, c1, (roast - p0) / (p1 - p0));
}

// ---- The setting ----

/**
 * A campfire on the rim of a tiny planet, under nebulae and a banded gas giant, with a wooden
 * launch tower and its little ship. Roast a marshmallow, fly the ship, listen to distant signals
 * through the scope, and keep an eye on the quantum shard. Every couple of minutes the sun goes
 * supernova and the loop starts over; tapping the sun sets it off early.
 */
class TinyPlanet implements CampfireSetting {
  private readonly voices = new Voices();
  private time = 0;

  private novaStart = -1;
  private nextNova = LOOP;
  /** When the current loop began; the sun ages and the probe cannon fires from here. */
  private loopBegan = 0;
  private cannonFired = false;
  /** How the cannon's pieces drift apart once it breaks; the control module (0) stays put. */
  private readonly debris = (() => {
    const rand = seeded(5);
    return Array.from({ length: 5 }, (_, i) =>
      i === 0 ? { dx: 0, dy: 0, spin: 0 } : { dx: (rand() - 0.5) * 0.9, dy: (rand() - 0.5) * 0.9, spin: (rand() - 0.5) * 0.5 },
    );
  })();
  /** How open each mask's eyes are, 0..1. */
  private maskEyes: number[] = [];
  /** The campfire prompt: asks before playing every part together. */
  private prompt = false;
  private promptHover: 'yes' | 'no' | null = null;
  /** All signals at full strength — everyone playing together. */
  private ensemble = false;

  /** 0 resting, 1 held in the flames. */
  private reach = 0;
  private holding = false;
  private roast = 0;
  private burning = false;
  /** Seconds since it was eaten, or -1 while it is on the stick. */
  private eaten = -1;
  private readonly marshFlame = new TongueFire(3, undefined, 0);

  private ship: 'docked' | 'ascent' | 'away' | 'descent' = 'docked';
  private shipTime = 0;
  private puffs: Puff[] = [];

  private readonly signals: Signal[] = [
    { label: '조각난 공동 · 밴조', voice: 'banjo', gain: 0.15, strength: 0 },
    { label: '거인의 심연 · 베이스 플루트', voice: 'flute', gain: 0.12, strength: 0 },
    { label: '검은 가시덤불 · 하모니카', voice: 'harmonica', gain: 0.04, strength: 0 },
    { label: '양자의 달 · 피아노', voice: 'piano', gain: 0.1, strength: 0 },
    { label: '잔바위 · 슬라이드 휘파람', voice: 'slide', gain: 0.06, strength: 0 },
    { label: '모래시계 쌍둥이 · 타악기', voice: 'drums', gain: 0.25, strength: 0 },
  ];
  /** Touch screens can't hover, so there a tap in the sky leaves the scope pointed there. */
  private readonly canHover = window.matchMedia('(hover: hover)').matches;
  private scopeLock: Point | null = null;
  /** Audio-clock time the current pass through the theme began, or -1 before the music starts. */
  private loopStart = -1;
  /** Next note of `THEME` to schedule. */
  private themeStep = 0;
  private scope: Point | null = null;

  private shardSpot = 0;
  private shardUnseen = 0;
  private shardWait = rand(4, 8);
  private shardShimmer = 0;
  private shardSeen = false;

  paint(ctx: CanvasRenderingContext2D, view: CampfireView) {
    paintScene(ctx, view);
  }

  update(dt: number, view: CampfireView) {
    const { time } = view;
    this.time = time;
    const s = view.scale;

    // The loop: a supernova every LOOP seconds, after which everything starts over.
    if (this.novaStart < 0 && time >= this.nextNova && !view.reducedMotion) this.novaStart = time;
    if (this.novaStart >= 0 && time - this.novaStart >= END) {
      this.novaStart = -1;
      this.nextNova = time + LOOP;
      this.loopBegan = time;
      this.restart();
    }

    // Marshmallow.
    this.reach = clamp(this.reach + (this.holding ? 1 : -1) * dt * 2.2, 0, 1);
    if (this.eaten >= 0) {
      this.eaten += dt;
      if (this.eaten > 1.6) this.eaten = -1;
    } else {
      if (this.reach > 0.85) this.roast = Math.min(1.4, this.roast + ROAST_RATE * dt);
      if (this.burning) this.roast = Math.min(1.4, this.roast + 0.05 * dt);
      if (this.roast >= IGNITE && this.reach > 0.85) this.burning = true;
      const { tip } = stickOf(view, this.reach);
      this.marshFlame.place(tip.x, tip.y - 4 * s, 16 * s, this.burning ? 34 * s : 0);
      this.marshFlame.update(dt, time);
    }

    // Ship.
    this.shipTime += dt;
    const tower = towerOf(view);
    if (this.ship === 'ascent' && this.shipTime > ASCENT) this.setShip('away');
    else if (this.ship === 'away' && this.shipTime > AWAY) this.setShip('descent');
    else if (this.ship === 'descent' && this.shipTime > DESCENT) this.setShip('docked');
    if (tower && (this.ship === 'ascent' || this.ship === 'descent')) {
      const pos = this.shipPose(view);
      const thrust = this.ship === 'ascent' ? 1 : 1 - this.shipTime / DESCENT;
      if (pos && Math.random() < dt * 40 * thrust) {
        this.puffs.push({
          x: pos.x - pos.up.x * 4 * s + rand(-4, 4) * s,
          y: pos.y - pos.up.y * 4 * s,
          vx: rand(-20, 20) * s,
          vy: rand(10, 40) * s,
          age: 0,
          life: rand(0.8, 1.6),
          size: rand(5, 9) * s * pos.size,
          color: '#8d97a6',
        });
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.puffs[i] = this.puffs[this.puffs.length - 1];
        this.puffs.pop();
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy *= 1 - 1.5 * dt;
    }

    // Signal scope: aimed by the pointer whenever it is over the sky, or, on touch screens, left
    // wherever the sky was last tapped.
    const p = view.pointer;
    const pointed = p && this.inSky(p, view) ? { x: p.x, y: p.y } : null;
    this.scope = pointed ?? (this.canHover ? null : this.scopeLock);
    const sources = sourcesOf(view);
    this.signals.forEach((signal, i) => {
      const src = sources[i];
      // Each source only reaches about half way to its nearest neighbour, so on a small screen
      // neighbouring planets still come through one at a time.
      const neighbour = Math.min(...sources.filter((_, j) => j !== i).map((o) => Math.hypot(o.x - src.x, o.y - src.y)));
      const reach = clamp(neighbour * 0.5, 26 * s, 170 * s);
      const target = this.ensemble
        ? 1
        : this.scope
          ? clamp(1 - (Math.hypot(this.scope.x - src.x, this.scope.y - src.y) - src.r) / reach, 0, 1) ** 1.4
          : 0;
      signal.strength += (target - signal.strength) * Math.min(1, dt * 6);
    });
    this.playTheme();
    this.promptHover = this.prompt && p ? this.promptChoice(p, view) : null;

    // The cannon fires once at the start of every loop.
    if (!this.cannonFired && time - this.loopBegan >= FIRE_AT) {
      this.cannonFired = true;
      this.voices.boom();
    }

    // Masks open their eyes and watch the pointer when it comes near.
    const masks = masksOf(view);
    this.maskEyes = masks.map((m, i) => {
      const near = !!p && Math.hypot(p.x - m.x, p.y - (m.y - 44 * s)) < 170 * s;
      const open = this.maskEyes[i] ?? 0;
      return clamp(open + (near ? 1 : -1) * dt * 2.5, 0, 1);
    });

    // Quantum shard: it only moves while nobody is looking.
    const spots = shardSpots(view);
    if (this.shardSpot >= spots.length) this.shardSpot = 0;
    const spot = spots[this.shardSpot];
    this.shardSeen = !!p && !!spot && Math.hypot(p.x - spot.x, p.y - spot.y) < 150 * s;
    this.shardShimmer = Math.max(0, this.shardShimmer - dt * 2);
    if (this.shardSeen) {
      this.shardUnseen = 0;
    } else if ((this.shardUnseen += dt) > this.shardWait && spots.length > 1) {
      let next = this.shardSpot;
      while (next === this.shardSpot) next = Math.floor(Math.random() * spots.length);
      this.shardSpot = next;
      this.shardUnseen = 0;
      this.shardWait = rand(4, 8);
      this.shardShimmer = 1;
    }
  }

  tap(tap: FireTap, view: CampfireView) {
    this.voices.start();
    const s = view.scale;
    const at = { x: tap.x, y: tap.y };

    // While the prompt is up, a tap answers it (or dismisses it).
    if (this.prompt) {
      this.ensemble = this.promptChoice(at, view) === 'yes';
      this.prompt = false;
      return true;
    }

    const sun = sunOf(view);
    if (Math.hypot(at.x - sun.x, at.y - sun.y) < Math.max(36 * s, this.sunRadius(view) * 1.6)) {
      if (this.novaStart < 0 && !view.reducedMotion) this.novaStart = view.time;
      return true;
    }

    const tower = towerOf(view);
    if (tower && this.ship === 'docked') {
      const hull = { x: tower.dock.x + tower.up.x * 32 * s, y: tower.dock.y + tower.up.y * 32 * s };
      if (Math.hypot(at.x - hull.x, at.y - hull.y) < 36 * s) {
        this.setShip('ascent');
        this.voices.rumble(ASCENT);
        return true;
      }
    }

    if (this.eaten < 0) {
      const { base, tip } = stickOf(view, this.reach);
      if (Math.hypot(at.x - tip.x, at.y - tip.y) < 26 * s || segmentDistance(at, base, tip) < 12 * s) {
        this.useMarshmallow(tip);
        return true;
      }
    }

    // The campfire asks whether you're ready; tapping it again during the song stops it.
    if (tap.onFire && !tap.onLetter) {
      if (this.ensemble) this.ensemble = false;
      else this.prompt = true;
      return true;
    }

    if (!this.canHover) {
      this.scopeLock = this.inSky(at, view) ? at : null;
      return this.scopeLock !== null;
    }
    return false;
  }

  /** The prompt box and its two answers, just above the fire. */
  private promptLayout(view: CampfireView) {
    const s = Math.max(view.scale, 0.8);
    const w = Math.min(240 * s, view.width - 32);
    const h = 92 * s;
    const x = view.cx - w / 2;
    const y = view.cy - 150 * view.scale - h / 2;
    const option = (i: number) => ({ x: x + (w / 2) * i, y: y + h * 0.55, w: w / 2, h: h * 0.45 });
    return { s, box: { x, y, w, h }, yes: option(0), no: option(1) };
  }

  private promptChoice(at: Point, view: CampfireView) {
    const { yes, no } = this.promptLayout(view);
    const inside = (r: { x: number; y: number; w: number; h: number }) =>
      at.x >= r.x && at.x <= r.x + r.w && at.y >= r.y && at.y <= r.y + r.h;
    return inside(yes) ? 'yes' : inside(no) ? 'no' : null;
  }

  /** Above the horizon, where the scope can point. */
  private inSky(at: Point, view: CampfireView) {
    return at.y < planet(view).y(at.x) - 40 * view.scale;
  }

  animate(ctx: CanvasRenderingContext2D, view: CampfireView) {
    this.drawComet(ctx, view);
    this.drawTwins(ctx, view);
    this.drawCannon(ctx, view);
    this.drawMasks(ctx, view);
    this.drawSun(ctx, view);
  }

  /** How far through the current loop we are, 0..1 — the sun swells and reddens with it. */
  private age(view: CampfireView) {
    return clamp((view.time - this.loopBegan) / LOOP, 0, 1);
  }

  /** The sun's radius right now, before any supernova swell. */
  private sunRadius(view: CampfireView) {
    return sunOf(view).r * (1 + 1.6 * this.age(view) ** 1.6);
  }

  /** A yellow sun that grows into a red giant over the loop, then swells blue-white and collapses. */
  private drawSun(ctx: CanvasRenderingContext2D, view: CampfireView) {
    const t = this.novaStart < 0 ? -1 : view.time - this.novaStart;
    const sun = sunOf(view);
    const age = this.age(view);
    let r = this.sunRadius(view);
    let hot = 0;
    if (t >= 0 && t < SWELL) {
      r *= 1 + 0.9 * ease(t / SWELL);
      hot = t / SWELL;
    } else if (t >= SWELL && t < COLLAPSE) {
      r *= 1.9 * (1 - 0.85 * ease((t - SWELL) / (COLLAPSE - SWELL)));
      hot = 1;
    } else if (t >= COLLAPSE && t < WHITE) {
      r = 0;
    }
    if (r <= 0) return;

    const core = css(mix(mix([255, 241, 207], [255, 168, 112], age), [234, 244, 255], hot));
    const [rr, rg, rb] = mix(mix([255, 170, 90], [255, 88, 52], age), [135, 220, 255], hot);
    const rim = `rgba(${rr | 0}, ${rg | 0}, ${rb | 0}`;
    const g = ctx.createRadialGradient(sun.x, sun.y, r * 0.6, sun.x, sun.y, r * 5);
    g.addColorStop(0, `${rim}, 0.55)`);
    g.addColorStop(1, `${rim}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(sun.x - r * 5, sun.y - r * 5, r * 10, r * 10);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `${rim}, 0.6)`;
    ctx.lineWidth = 1.5 * view.scale;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, r * (1.25 + 0.08 * noise1(view.time)), 0, Math.PI * 2);
    ctx.stroke();
  }

  overlay(ctx: CanvasRenderingContext2D, view: CampfireView) {
    this.drawShard(ctx, view);
    this.drawShip(ctx, view);
    this.drawMarshmallow(ctx, view);
    this.drawScope(ctx, view);
    this.drawEnsemble(ctx, view);
    this.drawPrompt(ctx, view);
    this.drawSupernova(ctx, view);
  }

  dispose() {
    this.voices.close();
  }

  // ---- interactions ----

  /**
   * Keeps the theme running on the audio clock whether or not anyone is listening, so both
   * signals stay in time; each note is only voiced at the strength its signal has right now.
   */
  private playTheme() {
    if (!this.voices.ready) {
      this.loopStart = -1;
      return;
    }
    const now = this.voices.now;
    // Start fresh, or skip ahead after the tab was hidden rather than playing a burst of late notes.
    if (this.loopStart < 0 || now - (this.loopStart + THEME[this.themeStep].at * EIGHTH) > 0.25) {
      this.loopStart = now + 0.05;
      this.themeStep = 0;
    }
    for (;;) {
      const n = THEME[this.themeStep];
      const when = this.loopStart + n.at * EIGHTH;
      if (when > now + LOOKAHEAD) break;
      const signal = this.signals[n.signal];
      const gain = signal.gain * signal.strength;
      const length = n.length * EIGHTH * 0.95;
      if (signal.strength > 0.04) {
        if (signal.voice === 'banjo') this.voices.pluck(midi(n.note), gain, when);
        else if (signal.voice === 'flute') this.voices.flute(midi(n.note), gain, length, when);
        else if (signal.voice === 'harmonica') this.voices.harmonica(midi(n.note), gain, length, when);
        else if (signal.voice === 'piano') this.voices.piano(midi(n.note), gain, length, when);
        else if (signal.voice === 'slide') this.voices.slideWhistle(midi(n.note), gain, length, when);
        else this.voices.drum(n.note === CONGA_HIT ? 'conga' : 'frame', gain, when);
      }
      this.themeStep++;
      if (this.themeStep === THEME.length) {
        this.themeStep = 0;
        this.loopStart += LOOP_EIGHTHS * EIGHTH;
      }
    }
  }

  private restart() {
    this.cannonFired = false;
    this.setShip('docked');
    this.puffs = [];
    this.holding = false;
    this.reach = 0;
    this.roast = 0;
    this.burning = false;
    this.eaten = -1;
    this.shardShimmer = 1;
  }

  private setShip(state: TinyPlanet['ship']) {
    this.ship = state;
    this.shipTime = 0;
  }

  /**
   * Click cycle: push a raw marshmallow into the fire, pull it out, eat it once it's toasted.
   * A burning one gets blown out first.
   */
  private useMarshmallow(tip: Point) {
    if (this.burning) {
      this.burning = false;
      this.holding = false;
      for (let i = 0; i < 6; i++) this.puff(tip, '#6d7380');
    } else if (this.holding) {
      this.holding = false;
    } else if (this.roast >= 0.35) {
      this.eaten = 0;
      this.roast = 0;
      for (let i = 0; i < 6; i++) this.puff(tip, '#f6efe2');
    } else {
      this.holding = true;
    }
  }

  private puff(at: Point, color: string) {
    this.puffs.push({ x: at.x, y: at.y, vx: rand(-40, 40), vy: rand(-60, -20), age: 0, life: rand(0.6, 1.1), size: rand(4, 8), color });
  }

  /** Ship position along its flight; null when it is out of sight. */
  private shipPose(view: CampfireView) {
    const tower = towerOf(view);
    if (!tower) return null;
    const s = view.scale;
    const { dock, up, angle } = tower;
    const t = this.shipTime;
    if (this.ship === 'docked') return { x: dock.x, y: dock.y, angle, size: 1, up };
    if (this.ship === 'away') return null;
    if (this.ship === 'ascent') {
      // Straight up off the tower, then arcing away and shrinking into the distance.
      const climb = 70 * s * t * t;
      const drift = 18 * s * t ** 3;
      return {
        x: dock.x + up.x * climb + drift,
        y: dock.y + up.y * climb,
        angle: angle + 0.35 * ease(clamp(t / ASCENT, 0, 1)),
        size: 1 / (1 + t * 0.45),
        up,
      };
    }
    // Descent: drops back onto the tower from above, slowing as it lands.
    const k = ease(clamp(t / DESCENT, 0, 1));
    const height = (1 - k) * 160 * s;
    return { x: dock.x + up.x * height, y: dock.y + up.y * height, angle, size: 1, up };
  }

  // ---- drawing ----

  private drawShip(ctx: CanvasRenderingContext2D, view: CampfireView) {
    ctx.globalCompositeOperation = 'source-over';
    for (const p of this.puffs) {
      const t = p.age / p.life;
      ctx.globalAlpha = 0.5 * (1 - t);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 + t * 1.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const pose = this.shipPose(view);
    if (!pose) return;
    const thrust = this.ship === 'ascent' ? 1 : this.ship === 'descent' ? 1 - this.shipTime / DESCENT : 0;
    drawShip(ctx, pose.x, pose.y, pose.angle, view.scale * pose.size, thrust, view.time);
  }

  private drawMarshmallow(ctx: CanvasRenderingContext2D, view: CampfireView) {
    const s = view.scale;
    const { base, tip } = stickOf(view, this.reach);
    const angle = Math.atan2(tip.y - base.y, tip.x - base.x);
    ctx.strokeStyle = '#8a6440';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(tip.x + Math.cos(angle) * 10 * s, tip.y + Math.sin(angle) * 10 * s);
    ctx.stroke();
    if (this.eaten >= 0) return;

    const color = toast(this.roast);
    const body = new Path2D();
    body.roundRect(-10 * s, -8 * s, 20 * s, 16 * s, 5 * s);
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(angle);
    shade(
      ctx,
      body,
      {
        base: css(color),
        shadow: css(mix(color, [60, 40, 30], 0.35)),
        light: css(mix(color, [255, 190, 120], 0.25 + 0.4 * view.light * this.reach)),
      },
      { x: -Math.cos(angle) * 0.2, y: -1 },
      2.5 * s,
      3.5 * s,
    );
    ctx.restore();
    if (this.burning) this.marshFlame.draw(ctx);
    if (this.reach > 0.85 && !this.burning) glow(ctx, tip.x, tip.y, 24 * s, [255, 150, 70], 0.25);
  }

  private drawShard(ctx: CanvasRenderingContext2D, view: CampfireView) {
    const spots = shardSpots(view);
    const spot = spots[this.shardSpot];
    if (!spot) return;
    const s = view.scale;
    const bob = spot.floating ? Math.sin(view.time * 1.4) * 4 * s : 0;
    const pulse = 0.5 + 0.5 * Math.sin(view.time * 2.2);
    glow(ctx, spot.x, spot.y - 10 * s + bob, (this.shardSeen ? 46 : 32) * s, [150, 200, 255], (this.shardSeen ? 0.35 : 0.18) + 0.08 * pulse);

    const shard = new Path2D();
    shard.moveTo(0, -24 * s);
    shard.lineTo(7 * s, -8 * s);
    shard.lineTo(5 * s, 0);
    shard.lineTo(-5 * s, 0);
    shard.lineTo(-8 * s, -10 * s);
    shard.closePath();
    shard.moveTo(9 * s, -2 * s);
    shard.lineTo(13 * s, -12 * s);
    shard.lineTo(14 * s, -1 * s);
    shard.closePath();
    ctx.save();
    ctx.translate(spot.x, spot.y + bob);
    ctx.rotate(spot.angle);
    shade(ctx, shard, { base: '#9fb8d6', shadow: '#5a6f92', light: '#eef6ff' }, { x: -1, y: -0.6 }, 2 * s, 3 * s);
    ctx.restore();

    if (this.shardShimmer > 0) {
      ctx.strokeStyle = `rgba(190, 225, 255, ${(this.shardShimmer * 0.7).toFixed(3)})`;
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.arc(spot.x, spot.y - 10 * s + bob, (1 - this.shardShimmer) * 40 * s + 8 * s, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * The probe cannon: a segmented barrel of weathered stone with a round control module at the
   * breech. At the start of each loop it gathers light, fires a probe, and comes apart; the pieces
   * drift off slowly, all but the control module.
   */
  private drawCannon(ctx: CanvasRenderingContext2D, view: CampfireView) {
    const c = cannonOf(view);
    const s = view.scale;
    const since = view.time - this.loopBegan;
    const broken = since >= BREAK_AT;
    const drift = broken ? 1 - Math.exp(-(since - BREAK_AT) * 0.35) : 0;
    const seg = c.length / 5;
    const muzzle = { x: c.x + c.dir.x * c.length * 0.5, y: c.y + c.dir.y * c.length * 0.5 };
    const toSun = sunOf(view);
    const tones = { base: '#8b8299', shadow: '#4f4862', light: '#cdc4da' };

    for (let i = 0; i < 5; i++) {
      const along = -c.length / 2 + (i + 0.5) * seg;
      const d = this.debris[i];
      const x = c.x + c.dir.x * along + d.dx * c.length * drift;
      const y = c.y + c.dir.y * along + d.dy * c.length * drift;
      const angle = c.angle + d.spin * drift * 2.5;
      const piece = new Path2D();
      if (i === 0) {
        piece.arc(0, 0, c.width * 0.85, 0, Math.PI * 2);
      } else if (i === 4) {
        // Launch module, flaring at the mouth.
        piece.moveTo(-seg * 0.45, -c.width * 0.5);
        piece.lineTo(seg * 0.45, -c.width * 0.75);
        piece.lineTo(seg * 0.45, c.width * 0.75);
        piece.lineTo(-seg * 0.45, c.width * 0.5);
        piece.closePath();
      } else {
        piece.roundRect(-seg * 0.45, -c.width * 0.5, seg * 0.9, c.width, c.width * 0.2);
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      const local = { x: toSun.x - x, y: toSun.y - y };
      const cos = Math.cos(-angle);
      const sin = Math.sin(-angle);
      shade(ctx, piece, tones, { x: local.x * cos - local.y * sin, y: local.x * sin + local.y * cos }, 1.5 * s, 2.5 * s);
      // Carved bands, and a faint glow in the seams while the cannon is whole.
      ctx.fillStyle = '#3d3650';
      if (i > 0) ctx.fillRect(-1 * s, -c.width * 0.5, 2 * s, c.width);
      ctx.fillStyle = `rgba(160, 240, 220, ${broken ? 0.15 : 0.6})`;
      ctx.beginPath();
      ctx.arc(i === 0 ? 0 : seg * 0.25, 0, Math.max(1, 1.6 * s), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Charging, the shot, and the probe streaking away.
    if (since >= CHARGE_AT && since < FIRE_AT) {
      const k = (since - CHARGE_AT) / (FIRE_AT - CHARGE_AT);
      glow(ctx, muzzle.x, muzzle.y, c.width * (1 + 3 * k), [170, 240, 255], 0.7 * k);
    }
    if (since >= FIRE_AT && since < FIRE_AT + 0.8) {
      const k = (since - FIRE_AT) / 0.8;
      glow(ctx, muzzle.x, muzzle.y, c.length * (0.4 + 0.6 * k), [200, 245, 255], 0.9 * (1 - k));
      ctx.strokeStyle = `rgba(200, 245, 255, ${(0.8 * (1 - k)).toFixed(3)})`;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(muzzle.x, muzzle.y, c.length * 0.8 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (since >= FIRE_AT && since < FIRE_AT + 1.4) {
      const travel = (since - FIRE_AT) * 650 * s;
      const head = { x: muzzle.x + c.dir.x * travel, y: muzzle.y + c.dir.y * travel };
      const tailLength = Math.min(travel, 140 * s);
      const tail = { x: head.x - c.dir.x * tailLength, y: head.y - c.dir.y * tailLength };
      const trail = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      trail.addColorStop(0, 'rgba(180, 240, 255, 0)');
      trail.addColorStop(1, 'rgba(230, 250, 255, 0.9)');
      ctx.strokeStyle = trail;
      ctx.lineWidth = 2.5 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
      glow(ctx, head.x, head.y, 12 * s, [200, 245, 255], 0.8);
    }
  }

  /**
   * Masks of an old, three-eyed people, standing on stone plinths: a layered diamond face with
   * three gold-framed eyes, and six arms reaching out around it in ivory, dark wood and gold. The
   * eyes light up violet and follow the pointer when it comes near.
   */
  private drawMasks(ctx: CanvasRenderingContext2D, view: CampfireView) {
    const s = view.scale;
    const p = view.pointer;
    masksOf(view).forEach((m, i) => {
      const open = this.maskEyes[i] ?? 0;
      const near = clamp(1 - Math.abs(m.x - view.cx) / (500 * s), 0, 1);
      const warm = clamp(view.light * near, 0, 1) * 0.5;
      const ivory = blend('#e6d9bc', '#ffd2a8', warm);
      const wood = blend('#4a3a2c', '#7a4e34', warm);
      const gold = blend('#c9a24a', '#ffc678', warm);
      const toward = { x: view.cx - m.x, y: -60 * s };
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle);

      const plinth = new Path2D();
      plinth.roundRect(-8 * s, -12 * s, 16 * s, 12 * s, 2 * s);
      shade(ctx, plinth, { base: '#4a4458', shadow: '#2c2836', light: blend('#5e576e', '#e39a6a', warm * 2) }, toward, 2 * s, 3 * s);

      // The mask, centred above the plinth; u is one mask unit.
      ctx.translate(0, -44 * s);
      const u = s * 1.25;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';

      /** A two-tone arm: dark wood with an ivory inner face and a gold line along it. */
      const arm = (draw: () => void, width: number) => {
        ctx.strokeStyle = wood;
        ctx.lineWidth = width * u;
        ctx.beginPath();
        draw();
        ctx.stroke();
        ctx.strokeStyle = ivory;
        ctx.lineWidth = width * 0.45 * u;
        ctx.beginPath();
        draw();
        ctx.stroke();
        ctx.strokeStyle = gold;
        ctx.lineWidth = Math.max(0.6, 0.5 * u);
        ctx.setLineDash([1.2 * u, 1.6 * u]);
        ctx.beginPath();
        draw();
        ctx.stroke();
        ctx.setLineDash([]);
      };
      for (const side of [-1, 1]) {
        // Upper arms: wide arcs sweeping out and down, ending in an inward hook.
        arm(() => {
          ctx.arc(side * 3 * u, -5 * u, 17 * u, side > 0 ? -1.85 : -1.29, side > 0 ? -0.15 : -2.99, side < 0);
          const end = side > 0 ? -0.15 : -2.99;
          const ex = side * 3 * u + Math.cos(end) * 17 * u;
          const ey = -5 * u + Math.sin(end) * 17 * u;
          ctx.lineTo(ex - side * 4 * u, ey + 1 * u);
        }, 3.6);
        // Side brackets.
        arm(() => {
          ctx.moveTo(side * 16 * u, -2 * u);
          ctx.lineTo(side * 21 * u, -2 * u);
          ctx.lineTo(side * 21 * u, 9 * u);
          ctx.lineTo(side * 16 * u, 9 * u);
        }, 3);
        // Lower arms, reaching down and out to a hooked foot.
        arm(() => {
          ctx.moveTo(side * 6 * u, 8 * u);
          ctx.lineTo(side * 15 * u, 18 * u);
          ctx.lineTo(side * 15 * u, 23 * u);
          ctx.lineTo(side * 11 * u, 23 * u);
        }, 3);
      }

      // Face: a diamond in layers — dark rim, ivory band, dark field.
      const diamond = (r: number, y = 0) => {
        const d = new Path2D();
        d.moveTo(0, y - r);
        d.lineTo(r, y);
        d.lineTo(0, y + r);
        d.lineTo(-r, y);
        d.closePath();
        return d;
      };
      shade(ctx, diamond(14 * u), { base: wood, shadow: '#2a2018', light: blend('#6a5440', '#ffb27a', warm * 2) }, toward, 1.5 * u, 2 * u);
      ctx.fillStyle = ivory;
      ctx.fill(diamond(11.5 * u));
      ctx.fillStyle = wood;
      ctx.fill(diamond(9.5 * u));
      // Brow ornaments: small square hooks at the top corners.
      ctx.strokeStyle = ivory;
      ctx.lineWidth = 1.4 * u;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 3 * u, -15 * u);
        ctx.lineTo(side * 7 * u, -15 * u);
        ctx.lineTo(side * 7 * u, -12 * u);
        ctx.stroke();
      }

      // Three eyes in gold frames: one above, two below, with a dark stem down the middle.
      const eyes = [
        { x: 0, y: -4.5 * u },
        { x: -4.5 * u, y: 0.5 * u },
        { x: 4.5 * u, y: 0.5 * u },
      ];
      ctx.fillStyle = wood;
      ctx.fillRect(-1 * u, 3 * u, 2 * u, 8 * u);
      ctx.strokeStyle = ivory;
      ctx.lineWidth = 0.8 * u;
      ctx.beginPath();
      ctx.moveTo(-2.5 * u, 9 * u);
      ctx.lineTo(0, 11.5 * u);
      ctx.lineTo(2.5 * u, 9 * u);
      ctx.stroke();
      let look = { x: 0, y: 0 };
      if (p && open > 0) {
        const dx = p.x - m.x;
        const dy = p.y - (m.y - 44 * s);
        const d = Math.hypot(dx, dy) || 1;
        look = { x: (dx / d) * 0.6 * u, y: (dy / d) * 0.6 * u };
      }
      for (const e of eyes) {
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.fillStyle = gold;
        ctx.fill(diamond(3.6 * u));
        ctx.fillStyle = blend('#2a2018', '#b88a3a', 0.25);
        ctx.fill(diamond(2.5 * u));
        // The eye itself: a small dark square that lights up violet.
        ctx.fillStyle = open > 0.05 ? `rgba(206, 160, 255, ${(0.35 + 0.65 * open).toFixed(3)})` : '#0d0a08';
        ctx.fillRect(-1 * u + look.x, -1 * u + look.y, 2 * u, 2 * u);
        ctx.restore();
      }
      ctx.restore();
      if (open > 0.05) glow(ctx, m.x, m.y - 46 * s, 38 * s, [190, 140, 255], 0.3 * open);
    });
  }

  /** The twin planets, the nearer drawn last, with a thread of sand pouring between them. */
  private drawTwins(ctx: CanvasRenderingContext2D, view: CampfireView) {
    const { a, b } = twinsOf(view);
    ctx.strokeStyle = 'rgba(214, 170, 110, 0.5)';
    ctx.lineWidth = Math.max(1, 1.5 * view.scale);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const [back, front] = a.y < b.y ? [a, b] : [b, a];
    for (const [body, color] of [
      [back, '#b98a52'],
      [front, '#d4a466'],
    ] as const) {
      const g = ctx.createRadialGradient(body.x - body.r * 0.4, body.y - body.r * 0.4, 0, body.x, body.y, body.r);
      g.addColorStop(0, color);
      g.addColorStop(1, '#5a3f28');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(body.x, body.y, body.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** The comet: a bright head with its tail streaming away from the sun. */
  private drawComet(ctx: CanvasRenderingContext2D, view: CampfireView) {
    const c = cometOf(view);
    const sun = sunOf(view);
    const d = Math.hypot(c.x - sun.x, c.y - sun.y) || 1;
    const ux = (c.x - sun.x) / d;
    const uy = (c.y - sun.y) / d;
    const length = 70 * view.scale;
    const tail = ctx.createLinearGradient(c.x, c.y, c.x + ux * length, c.y + uy * length);
    tail.addColorStop(0, 'rgba(200, 235, 255, 0.55)');
    tail.addColorStop(1, 'rgba(200, 235, 255, 0)');
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(c.x - uy * c.r, c.y + ux * c.r);
    ctx.lineTo(c.x + ux * length - uy * c.r * 3, c.y + uy * length + ux * c.r * 3);
    ctx.lineTo(c.x + ux * length + uy * c.r * 3, c.y + uy * length - ux * c.r * 3);
    ctx.lineTo(c.x + uy * c.r, c.y - ux * c.r);
    ctx.closePath();
    ctx.fill();
    glow(ctx, c.x, c.y, c.r * 5, [190, 230, 255], 0.5);
    ctx.fillStyle = '#f2fbff';
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** During the song, every planet sends out rings in time with the beat. */
  private drawEnsemble(ctx: CanvasRenderingContext2D, view: CampfireView) {
    const strength = this.signals.reduce((sum, sig) => sum + sig.strength, 0) / this.signals.length;
    if (!this.ensemble && strength < 0.3) return;
    const beat = ((view.time * TEMPO) / 60) % 1;
    ctx.lineWidth = 1.5 * view.scale;
    sourcesOf(view).forEach((src, i) => {
      const a = this.signals[i].strength * (1 - beat) * 0.5;
      if (a < 0.02) return;
      ctx.strokeStyle = `rgba(140, 230, 215, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(src.x, src.y, src.r + (6 + beat * 22) * view.scale, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  /** "Are you ready?" in the style of an in-game prompt: a dark panel, cream text, two answers. */
  private drawPrompt(ctx: CanvasRenderingContext2D, view: CampfireView) {
    if (!this.prompt) return;
    const { s, box, yes, no } = this.promptLayout(view);
    ctx.fillStyle = 'rgba(8, 11, 20, 0.86)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    // Thin frame with heavier corner brackets.
    ctx.strokeStyle = 'rgba(242, 232, 208, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    ctx.strokeStyle = '#f2e8d0';
    ctx.lineWidth = 2;
    const c = 10 * s;
    for (const [x, y, dx, dy] of [
      [box.x, box.y, 1, 1],
      [box.x + box.w, box.y, -1, 1],
      [box.x, box.y + box.h, 1, -1],
      [box.x + box.w, box.y + box.h, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x + dx * c, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * c);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2e8d0';
    ctx.font = `600 ${Math.round(16 * s)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText('준비가 되셨나요?', box.x + box.w / 2, box.y + box.h * 0.3);
    ctx.font = `600 ${Math.round(14 * s)}px ui-sans-serif, system-ui, sans-serif`;
    for (const [rect, label, key] of [
      [yes, '예', 'yes'],
      [no, '아니오', 'no'],
    ] as const) {
      const hot = this.promptHover === key;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      ctx.fillStyle = hot ? '#ff9a4a' : 'rgba(242, 232, 208, 0.75)';
      ctx.fillText(label, cx, cy);
      if (hot) {
        // A small diamond marks the highlighted answer.
        const w = ctx.measureText(label).width;
        const mx = cx - w / 2 - 10 * s;
        ctx.beginPath();
        ctx.moveTo(mx, cy - 4 * s);
        ctx.lineTo(mx + 4 * s, cy);
        ctx.lineTo(mx, cy + 4 * s);
        ctx.lineTo(mx - 4 * s, cy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** The signal scope reticle, its strength meter and what it is picking up. */
  private drawScope(ctx: CanvasRenderingContext2D, view: CampfireView) {
    const at = this.scope;
    if (!at) return;
    const s = view.scale;
    const best = this.signals.reduce((a, b) => (b.strength > a.strength ? b : a));
    const r = 24 * s;
    const teal = (a: number) => `rgba(140, 230, 215, ${a.toFixed(3)})`;

    ctx.lineWidth = 1.5 * s;
    ctx.strokeStyle = teal(0.65);
    ctx.beginPath();
    ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(at.x + dx * r * 0.45, at.y + dy * r * 0.45);
      ctx.lineTo(at.x + dx * r * 1.25, at.y + dy * r * 1.25);
    }
    ctx.stroke();

    // Strength meter: an arc on the right that fills as the signal locks.
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = teal(0.18);
    ctx.beginPath();
    ctx.arc(at.x, at.y, r + 7 * s, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
    if (best.strength > 0.02) {
      ctx.strokeStyle = teal(0.9);
      ctx.beginPath();
      ctx.arc(at.x, at.y, r + 7 * s, Math.PI / 3 - (best.strength * 2 * Math.PI) / 3, Math.PI / 3);
      ctx.stroke();
    }

    ctx.font = `600 ${Math.round(11 * Math.max(s, 0.9))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const hint = this.canHover ? '클릭하면 신호가 들려요' : '탭하면 신호가 들려요';
    const textWidth = Math.max(ctx.measureText(best.label).width, ctx.measureText(hint).width);
    // Read-outs go on the right of the reticle, or the left when they would run off screen.
    const right = at.x + r + 16 * s + textWidth < view.width - 8;
    ctx.textAlign = right ? 'left' : 'right';
    const tx = right ? at.x + r + 16 * s : at.x - r - 16 * s;
    if (best.strength > 0.25) {
      ctx.fillStyle = teal(0.95);
      ctx.fillText(best.label, tx, at.y - 6 * s);
    }
    if (best.strength > 0.1 && !this.voices.ready) {
      ctx.fillStyle = teal(0.6);
      ctx.fillText(hint, tx, at.y + 9 * s);
    }
  }

  private drawSupernova(ctx: CanvasRenderingContext2D, view: CampfireView) {
    const t = this.novaStart < 0 ? -1 : view.time - this.novaStart;
    if (t < COLLAPSE) return;
    const { width, height, cx, cy } = view;
    const sun = sunOf(view);
    const reach = Math.hypot(Math.max(sun.x, width - sun.x), Math.max(sun.y, height - sun.y)) * 1.15;
    const toFire = Math.hypot(cx - sun.x, cy - sun.y);

    let white: number;
    if (t < SHOCK) {
      // The shockwave: a blue-white ring racing out from where the sun was.
      const radius = ease((t - COLLAPSE) / (SHOCK - COLLAPSE)) * reach;
      const ring = ctx.createRadialGradient(sun.x, sun.y, radius * 0.7, sun.x, sun.y, Math.max(radius, 1));
      ring.addColorStop(0, 'rgba(150, 210, 255, 0)');
      ring.addColorStop(0.75, 'rgba(170, 225, 255, 0.55)');
      ring.addColorStop(1, 'rgba(240, 250, 255, 0.95)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = ring;
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      white = clamp((radius - toFire) / (reach * 0.25), 0, 1);
    } else if (t < WHITE) {
      white = 1;
    } else {
      white = 1 - ease((t - WHITE) / (END - WHITE));
    }
    if (white > 0) {
      ctx.fillStyle = `rgba(244, 249, 255, ${white.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
  }
}

export const outerWildsTheme: FireTheme = {
  id: 'outer-wilds',
  label: 'Outer Wilds',
  palette: {
    titleFrom: '#ffe2b0',
    titleTo: '#ff8a3c',
    titleGlow: 'rgba(255, 140, 60, 0.4)',
    ambient: '#0d1d2c',
  },
  // Low gravity: knocked-loose letters drift down slowly.
  letters: { knock: 'touch', draggable: true, item: false, gravity: 0.22 },
  createRenderer: () => new IllustratedCampfire(new TinyPlanet()),
};
