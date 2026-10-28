import { noise1 } from '../noise';
import { TongueFire, css, glow, mix, pine, seeded, shade, type RGB } from '../illustration';
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

function giantOf({ width, height, scale: s }: CampfireView) {
  const r = Math.min(70 * s, width * 0.1);
  return { x: width * 0.82, y: height * 0.2, r };
}

function moonOf(view: CampfireView) {
  const g = giantOf(view);
  return { x: g.x - g.r * 1.6, y: g.y + g.r * 0.9, r: g.r * 0.14 };
}

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

  get ready() {
    return this.ac?.state === 'running';
  }

  start() {
    try {
      this.ac ??= new AudioContext();
      void this.ac.resume();
    } catch {
      // Audio is optional.
    }
  }

  /** A plucked string, banjo-ish: bright attack, quick decay. */
  pluck(freq: number, gain: number) {
    const ac = this.ac;
    if (!ac || gain < 0.002) return;
    const now = ac.currentTime;
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
    osc.connect(filter).connect(env).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.75);
  }

  /** A breathy flute note with a little vibrato. */
  flute(freq: number, gain: number, length: number) {
    const ac = this.ac;
    if (!ac || gain < 0.002) return;
    const now = ac.currentTime;
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
    osc.connect(env).connect(ac.destination);
    osc.start(now);
    vibrato.start(now);
    osc.stop(now + length + 0.05);
    vibrato.stop(now + length + 0.05);
  }

  /** Low engine roar for a launch. */
  rumble(seconds: number) {
    const ac = this.ac;
    if (!ac) return;
    const now = ac.currentTime;
    if (!this.noise) {
      const length = Math.floor(ac.sampleRate * 2);
      this.noise = ac.createBuffer(1, length, ac.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    const env = ac.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.35, now + 0.3);
    env.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    src.connect(filter).connect(env).connect(ac.destination);
    src.start(now);
    src.stop(now + seconds);
  }

  close() {
    void this.ac?.close();
    this.ac = null;
  }
}

interface Signal {
  /** What the scope reads out when it locks on. */
  label: string;
  voice: 'pluck' | 'flute';
  /** MIDI notes; -1 is a rest. */
  notes: number[];
  beats: number[];
  step: number;
  next: number;
  strength: number;
}

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

  // A banded gas giant, lit from the sun's side, and its little moon.
  const g = giantOf(view);
  ctx.save();
  ctx.beginPath();
  ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
  ctx.clip();
  const bands = ['#b9834f', '#d6a46a', '#a86c3e', '#e2b98a', '#c08a55', '#9a6036'];
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = bands[i % bands.length];
    const y = g.y - g.r + (i / 9) * g.r * 2;
    ctx.fillRect(g.x - g.r, y + Math.sin(i * 2.1) * 2 * s, g.r * 2, (g.r * 2) / 9 + 2);
  }
  const night = ctx.createLinearGradient(g.x - g.r, g.y - g.r, g.x + g.r, g.y + g.r);
  night.addColorStop(0.25, 'rgba(6, 12, 31, 0)');
  night.addColorStop(1, 'rgba(6, 12, 31, 0.9)');
  ctx.fillStyle = night;
  ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
  ctx.restore();
  const moon = moonOf(view);
  ctx.fillStyle = '#9aa3b5';
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
  ctx.fill();

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
    {
      label: '가스 행성 · 밴조',
      voice: 'pluck',
      notes: [62, 66, 69, 74, 71, 69, 66, 69, 64, 66, 62, -1],
      beats: [0.28, 0.28, 0.28, 0.56, 0.28, 0.28, 0.28, 0.28, 0.28, 0.28, 0.56, 0.56],
      step: 0,
      next: 0,
      strength: 0,
    },
    {
      label: '작은 위성 · 플루트',
      voice: 'flute',
      notes: [69, 71, 74, 76, 74, 71, 69, 66, -1],
      beats: [0.6, 0.3, 0.9, 0.6, 0.6, 0.3, 0.9, 1.2, 0.8],
      step: 0,
      next: 0,
      strength: 0,
    },
  ];
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

    // Signal scope: aimed by the pointer whenever it is over the sky.
    const p = view.pointer;
    const ground = planet(view);
    this.scope = p && p.y < ground.y(p.x) - 40 * s ? { x: p.x, y: p.y } : null;
    const sources = [giantOf(view), moonOf(view)];
    this.signals.forEach((signal, i) => {
      const src = sources[i];
      const target = this.scope
        ? clamp(1 - (Math.hypot(this.scope.x - src.x, this.scope.y - src.y) - src.r) / (170 * s), 0, 1) ** 1.4
        : 0;
      signal.strength += (target - signal.strength) * Math.min(1, dt * 6);
      if (signal.strength < 0.04 || !this.voices.ready) {
        signal.next = time;
        return;
      }
      if (time < signal.next) return;
      const note = signal.notes[signal.step];
      const beat = signal.beats[signal.step];
      if (note >= 0) {
        const gain = 0.12 * signal.strength;
        if (signal.voice === 'pluck') this.voices.pluck(midi(note), gain);
        else this.voices.flute(midi(note), gain * 0.8, beat * 0.95);
      }
      signal.step = (signal.step + 1) % signal.notes.length;
      signal.next = time + beat;
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

    const sun = sunOf(view);
    if (Math.hypot(at.x - sun.x, at.y - sun.y) < Math.max(36 * s, sun.r * 3)) {
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
    return false;
  }

  animate(ctx: CanvasRenderingContext2D, view: CampfireView) {
    const t = this.novaStart < 0 ? -1 : view.time - this.novaStart;
    const sun = sunOf(view);
    let r = sun.r;
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

    const core = hot > 0.5 ? '#eaf4ff' : '#fff1cf';
    const rim = `rgba(${Math.round(255 - 120 * hot)}, ${Math.round(170 + 50 * hot)}, ${Math.round(90 + 165 * hot)}`;
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
    this.drawSupernova(ctx, view);
  }

  dispose() {
    this.voices.close();
  }

  // ---- interactions ----

  private restart() {
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
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (best.strength > 0.25) {
      ctx.fillStyle = teal(0.95);
      ctx.fillText(best.label, at.x + r + 16 * s, at.y - 6 * s);
    }
    if (best.strength > 0.1 && !this.voices.ready) {
      ctx.fillStyle = teal(0.6);
      ctx.fillText('클릭하면 신호가 들려요', at.x + r + 16 * s, at.y + 9 * s);
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
