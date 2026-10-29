import { noise1, noise2 } from '../noise';
import { Backdrop, TongueFire, blend, css, drawEmbers, glow, hexRgb, mix, pine, ridge, seeded, shade, type Ember, type Tones } from '../illustration';
import type { FireFrame, FireRenderer, FireTap, FireTheme, HotZone, PointerSample } from '../types';
import { fadeToPage } from './classic';

// The team's own winter camp: a bitter, snowless evening in the hills — bare oaks, a rope fence
// over a misty valley, the yellow tarp over the red tent, the car, and a fire in a pit dug into
// the dirt so it couldn't spread. Left alone the fire sinks low and the chill creeps back: everyone
// sits up and holds their hands out, and a little frost gathers at the edges. Keep it fed.

const MAX_EMBERS = 120;
const MAX_LEAVES = 60;
const MAX_PUFFS = 80;
/** Fire strength: where it starts, what it never sinks below, the most it takes, and how fast it burns down. */
const FUEL_START = 1.2;
const FUEL_FLOOR = 0.45;
const FUEL_MAX = 2.6;
const FUEL_BURN = 0.03;
/** A camper's own frame (feet at the origin, facing right) that every pose fits inside. */
const SILHOUETTE_BOX = { x: -52, y: -126, w: 136, h: 138 };
const LEAF_TONES = ['#7a3f22', '#94522a', '#5e331d', '#a8693a', '#6b4a2a'];

interface Leaf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  size: number;
  tone: string;
  /** Where on the ground it comes to rest. */
  floor: number;
  airborne: boolean;
  seed: number;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  alpha: number;
  smoke: boolean;
}

interface Camper {
  kind: 'sit' | 'crouch' | 'stand';
  x: number;
  y: number;
  /** 1 faces right, -1 faces left — always towards the fire. */
  dir: 1 | -1;
  size: number;
  /** Colour of their coat, which tints the silhouette. */
  tint: string;
  /** Seconds left of a startled hop after a tap, 0..1. */
  poke: number;
  /** Poking the fire with a stick, 0..1. */
  jab: number;
  breath: number;
  /** Seconds until the next wisp of steam off a hot drink. */
  steam: number;
  seed: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** A capsule that tapers from radius r1 at one end to r2 at the other — limbs. */
function taper(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const p = new Path2D();
  p.arc(x1, y1, r1, a + Math.PI / 2, a + (Math.PI * 3) / 2);
  p.arc(x2, y2, r2, a - Math.PI / 2, a + Math.PI / 2);
  p.closePath();
  return p;
}

/** A bare winter tree: a tall straight trunk that forks into thinning branches near the top. */
function bareTree(ctx: CanvasRenderingContext2D, x: number, y: number, height: number, width: number, rand: () => number) {
  const forkAt = y - height * (0.5 + rand() * 0.15);
  const lean = (rand() - 0.5) * 0.08;
  const topX = x + lean * height * 0.5;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, y);
  ctx.lineTo(topX - width * 0.3, forkAt);
  ctx.lineTo(topX + width * 0.3, forkAt);
  ctx.lineTo(x + width / 2, y);
  ctx.closePath();
  ctx.fill();
  // Short dead twigs along the trunk.
  for (let i = 0; i < 4; i++) {
    const ty = y - (y - forkAt) * (0.3 + rand() * 0.7);
    const side = rand() < 0.5 ? -1 : 1;
    ctx.lineWidth = Math.max(0.5, width * 0.18);
    ctx.beginPath();
    ctx.moveTo(x + (topX - x) * ((y - ty) / (y - forkAt)), ty);
    ctx.lineTo(x + side * height * (0.03 + rand() * 0.05), ty - height * (0.02 + rand() * 0.04));
    ctx.stroke();
  }
  const branch = (bx: number, by: number, angle: number, len: number, w: number, depth: number) => {
    const ex = bx + Math.cos(angle) * len;
    const ey = by + Math.sin(angle) * len;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    if (depth === 0 || w < 0.35) return;
    const n = rand() < 0.35 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * 0.55;
      // Branches curl back towards upright, like oaks reaching for light.
      const up = (-Math.PI / 2 - angle) * 0.18;
      branch(ex, ey, angle + spread + up + (rand() - 0.5) * 0.6, len * (0.66 + rand() * 0.14), w * 0.62, depth - 1);
    }
  };
  for (let i = 0; i < 3; i++) {
    branch(topX, forkAt, -Math.PI / 2 + (i - 1) * 0.5 + (rand() - 0.5) * 0.3, height * (0.16 + rand() * 0.06), width * 0.55, 5);
  }
}

/** Soft white blobs in an offscreen canvas — the drifting mist and the frost, painted once per resize. */
function offscreen(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx);
  return canvas;
}

/**
 * A fire in a pit dug into a clearing in the winter woods, with the team gathered round it and
 * the camp behind them.
 */
class WinterCamp implements FireRenderer {
  private readonly fire = new TongueFire(6);
  private readonly backdrop = new Backdrop();
  private mist: HTMLCanvasElement | null = null;
  private frost: HTMLCanvasElement | null = null;
  /** Scratch canvas each camper's silhouette is lit in. */
  private silhouette: HTMLCanvasElement | null = null;
  private embers: Ember[] = [];
  private leaves: Leaf[] = [];
  private puffs: Puff[] = [];
  private campers: Camper[] = [];

  private width = 0;
  private height = 0;
  private scale = 1;
  private cx = 0;
  private ground = 0;
  /** The fence along the back of the clearing; beyond it the hill drops away into the mist. */
  private fenceY = 0;
  /** The pit: centre and radii of the hole. */
  private pitX = 0;
  private pitY = 0;
  private pitRx = 0;
  private pitRy = 0;
  private carX = 0;
  private carY = 0;

  private time = 0;
  private ignition = 0;
  private fuel = FUEL_START;
  /** How warm everyone is, 0..1 — trails the fire. */
  private warmth = 0.6;
  private flicker = 1;
  private wind = 0;
  private flameH = 0;
  private pointer: PointerSample | null = null;
  private reducedMotion = false;
  private emberDebt = 0;
  private smokeDebt = 0;
  private leafDebt = 0;
  /** Seconds left of the car's lights flashing after it's tapped. */
  private blink = 0;

  resize(width: number, height: number) {
    const first = this.width === 0;
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    const s = this.scale;
    this.cx = width / 2;
    this.ground = height - 64 * s;
    this.fenceY = this.ground - 84 * s;
    this.pitX = this.cx;
    this.pitY = this.ground - 4 * s;
    this.pitRx = 46 * s;
    this.pitRy = 13 * s;
    this.carX = Math.min(width - 60 * s, Math.max(this.cx + 300 * s, width * 0.85));
    this.carY = this.ground - 30 * s;

    const old = this.campers;
    this.campers = [
      this.camper('stand', this.cx + 205 * s, this.ground - 26 * s, -1, 0.9, '#1b2560', 2),
      this.camper('sit', this.cx - 118 * s, this.ground + 8 * s, 1, 1, '#121833', 0),
      this.camper('crouch', this.cx + 104 * s, this.ground + 6 * s, -1, 1, '#0b0b0e', 1),
    ];
    this.campers.forEach((c, i) => {
      if (old[i]) c.breath = old[i].breath;
    });

    this.backdrop.paint(width, height, (ctx) => this.paintScene(ctx));
    this.paintMist();
    this.paintFrost();
    if (first || this.leaves.length === 0) this.scatterLeaves();
    else for (const l of this.leaves) l.floor = clamp(l.floor, this.fenceY + 14 * s, height - 30 * s);
  }

  hotZone(): HotZone | null {
    if (this.ignition <= 0) return null;
    const s = this.scale;
    const top = this.pitY - this.flameH * 1.1 - 20 * s;
    return { x: this.pitX - 52 * s, y: top, width: 104 * s, height: this.pitY + 8 * s - top };
  }

  groundY() {
    return this.ground;
  }

  tap({ x, y, onFire, onLetter }: FireTap) {
    if (onLetter) return;
    const s = this.scale;
    if (Math.abs(x - this.carX) < 82 * s && y > this.carY - 104 * s && y < this.carY + 6 * s) {
      // Beep beep — the car's lights flash, like checking it's locked.
      this.blink = 1.2;
      return;
    }
    for (const c of this.campers) {
      const h = (c.kind === 'stand' ? 120 : c.kind === 'sit' ? 96 : 92) * c.size;
      if (Math.abs(x - c.x) < 28 * c.size && y > c.y - h && y < c.y + 4 * s) {
        // Startled: a hop and a big puff of breath. Brr.
        c.poke = 1;
        this.breathe(c, 2.2);
        return;
      }
    }
    if (onFire) {
      this.fuel = Math.min(this.fuel + 0.35, FUEL_MAX);
      for (const c of this.campers) if (c.kind === 'crouch') c.jab = 1;
      const bx = clamp(x, this.pitX - 30 * s, this.pitX + 30 * s);
      for (let i = 0; i < 18; i++) this.burstEmber(bx, this.pitY - 8 * s, 0.9);
      this.fire.burst(bx, this.pitY - 24 * s, 3);
      return;
    }
    // Anywhere else kicks up the leaves around it.
    this.stir(x, y, 90 * s, 0, 1);
  }

  feed(x: number, y: number, fuel: number) {
    const s = this.scale;
    this.fuel = Math.min(this.fuel + 0.55 * fuel, FUEL_MAX);
    this.ignition = Math.max(this.ignition, 0.6);
    for (let i = 0; i < 32 * fuel; i++) this.burstEmber(x, Math.min(y, this.pitY - 6 * s), 1.1);
    this.fire.burst(x, Math.min(y, this.pitY - 20 * s), Math.round(5 * fuel));
    for (let i = 0; i < 3; i++) this.puff(x + gauss() * 10 * s, this.pitY - this.flameH * 0.8, true);
  }

  update({ time, dt, pointer, reducedMotion }: FireFrame) {
    this.time = time;
    this.pointer = pointer;
    this.reducedMotion = reducedMotion;
    const s = this.scale;

    this.ignition = Math.min(1, this.ignition + dt / 1.6);
    const lit = 1 - (1 - this.ignition) ** 3;
    // The fire burns down by itself, faster the bigger it is, but never quite out.
    this.fuel = Math.max(FUEL_FLOOR, this.fuel - FUEL_BURN * (0.5 + this.fuel * 0.5) * dt);
    const target = clamp((this.fuel - 0.15) / 1.0, 0, 1) * lit;
    this.warmth += (target - this.warmth) * Math.min(1, dt * (target > this.warmth ? 0.9 : 0.35));
    this.flicker = 0.85 + 0.2 * noise1(time * 3.1) + 0.08 * noise1(time * 9.7 + 40);
    this.blink = Math.max(0, this.blink - dt);

    // Still air most of the time, with now and then a cold gust down the hill.
    const gust = Math.max(0, noise1(time * 0.16 + 300) - 0.6) * 3.2 * (noise1(time * 0.05 + 70) < 0.5 ? -1 : 1);
    const ambient = (noise1(time * 0.35 + 90) - 0.5) * 0.35 + gust;
    if (pointer) {
      const proximity = clamp(1 - Math.hypot(pointer.x - this.pitX, pointer.y - this.pitY) / (300 * s), 0, 1);
      this.wind += clamp(pointer.vx / 1500, -1.5, 1.5) * proximity * dt * 6;
      const speed = Math.hypot(pointer.vx, pointer.vy);
      if (pointer.y > this.fenceY && speed > 400) this.stir(pointer.x, pointer.y, 50 * s, pointer.vx, Math.min(1, speed / 1600) * dt * 8);
    }
    this.wind += (ambient - this.wind) * Math.min(1, dt * 1.2);
    this.wind = clamp(this.wind, -1.2, 1.2);

    const strength = 0.35 + 0.5 * this.fuel;
    this.flameH = 120 * s * lit * this.flicker * strength;
    this.fire.place(this.pitX, this.pitY + 3 * s, 62 * s * (0.75 + 0.2 * this.fuel), this.flameH, this.wind * 0.8);
    this.fire.update(reducedMotion ? dt * 0.5 : dt, time);

    this.emberDebt += (reducedMotion ? 1.5 : 5) * lit * strength * strength * dt;
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      this.pushEmber(this.pitX + gauss() * 18 * s, this.pitY - rand(10, 50) * s, rand(-30, 30) * s, -rand(80, 190) * s);
    }
    this.smokeDebt += (reducedMotion ? 0.6 : 1.6) * lit * dt;
    while (this.smokeDebt >= 1) {
      this.smokeDebt -= 1;
      this.puff(this.pitX + gauss() * 14 * s, this.pitY - this.flameH * 0.9, true);
    }

    this.stepEmbers(dt);
    this.stepLeaves(dt);
    this.stepCampers(dt);
    this.stepPuffs(dt);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const s = this.scale;
    const lit = 1 - (1 - this.ignition) ** 3;
    const light = lit * this.flicker * (0.45 + 0.45 * Math.min(this.fuel, 2.2));
    const cold = 1 - this.warmth;

    this.backdrop.draw(ctx);
    this.drawMist(ctx);
    this.drawCarLights(ctx);

    // Firelight across the clearing, reaching the tent and the car when it's high.
    glow(ctx, this.pitX, this.pitY - 50 * s, 380 * s * (0.7 + 0.3 * light), [255, 136, 64], 0.2 * light);
    ctx.save();
    ctx.translate(this.pitX, this.ground);
    ctx.scale(1, 0.24);
    glow(ctx, 0, 0, 300 * s, [255, 140, 70], 0.34 * light);
    ctx.restore();

    for (const l of this.leaves) if (!l.airborne) this.drawLeaf(ctx, l);

    const behind = this.campers.filter((c) => c.y < this.pitY);
    const before = this.campers.filter((c) => c.y >= this.pitY);
    for (const c of behind) this.drawCamper(ctx, c, light);
    this.drawPit(ctx, light, 'back');
    this.fire.draw(ctx);
    this.drawPit(ctx, light, 'front');
    for (const c of before) this.drawCamper(ctx, c, light);

    drawEmbers(ctx, this.embers, this.time);
    for (const l of this.leaves) if (l.airborne) this.drawLeaf(ctx, l);
    this.drawPuffs(ctx, cold);

    // The cold: a blue chill over everything, and frost growing in from the edges.
    if (cold > 0.05) {
      ctx.fillStyle = `rgba(30, 50, 100, ${(0.08 * cold).toFixed(3)})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    const frost = clamp((cold - 0.55) / 0.45, 0, 1) * 0.6;
    if (frost > 0.01 && this.frost) {
      ctx.globalAlpha = frost;
      ctx.drawImage(this.frost, 0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }
    fadeToPage(ctx, this.width, this.height);
  }

  // ---- people ----

  private camper(kind: Camper['kind'], x: number, y: number, dir: 1 | -1, size: number, tint: string, i: number): Camper {
    return { kind, x, y, dir, size: size * this.scale, tint, poke: 0, jab: 0, breath: i * 0.9, steam: 0, seed: i * 37.1 };
  }

  private stepCampers(dt: number) {
    const cold = 1 - this.warmth;
    const s = this.scale;
    for (const c of this.campers) {
      c.poke = Math.max(0, c.poke - dt * 2);
      c.jab = Math.max(0, c.jab - dt * 3);
      // Everyone breathes out every few seconds; it shows more in the cold.
      c.breath -= dt;
      if (c.breath <= 0) {
        c.breath = 3 + noise1(this.time + c.seed) * 1.6;
        this.breathe(c, 0.4 + cold * 0.5);
      }
      // A wisp of steam off the hot drink.
      if (c.kind === 'stand') {
        c.steam -= dt;
        if (c.steam <= 0 && this.puffs.length < MAX_PUFFS) {
          c.steam = rand(0.5, 0.9);
          const cup = this.local(c, 16, -79);
          this.puffs.push({ x: cup.x, y: cup.y, vx: rand(-3, 3) * s, vy: -rand(10, 18) * s, age: 0, life: rand(1.2, 1.8), size: rand(1.5, 2.5) * s, alpha: 0.18, smoke: false });
        }
      }
    }
  }

  /** A point in a camper's own frame (facing right, feet at the origin) in canvas px. */
  private local(c: Camper, x: number, y: number) {
    return { x: c.x + x * c.dir * c.size, y: c.y + y * c.size };
  }

  /** How far each camper has sat up and reached towards the fire, 0..1 — only once it gets chilly. */
  private reach() {
    return clamp((0.65 - this.warmth) / 0.65, 0, 1);
  }

  /** The sitter's body: hips, shoulders and head, leaning back in the chair until it gets cold. */
  private sitPose(c: Camper) {
    const up = this.reach();
    const a = -0.42 + up * 0.34;
    const bob = Math.sin(this.time * 1.5 + c.seed) * 0.6;
    const hip = { x: -8, y: -38 };
    const sh = { x: hip.x + Math.sin(a) * 30, y: hip.y - Math.cos(a) * 30 + bob };
    const head = { x: sh.x + Math.sin(a) * 14 + 2, y: sh.y - Math.cos(a) * 14 - 1 };
    return { up, a, hip, sh, head };
  }

  private crouchPose(c: Camper) {
    const up = this.reach();
    const a = 0.32 + up * 0.12;
    const bob = Math.sin(this.time * 1.5 + c.seed) * 0.6;
    const hip = { x: -10, y: -26 };
    const sh = { x: hip.x + Math.sin(a) * 34, y: hip.y - Math.cos(a) * 34 + bob };
    const head = { x: sh.x + 8, y: sh.y - 13 };
    return { up, a, hip, sh, head };
  }

  /** Where a camper's mouth is, in canvas px. */
  private mouth(c: Camper) {
    if (c.kind === 'sit') {
      const { head } = this.sitPose(c);
      return this.local(c, head.x + 10, head.y + 4);
    }
    if (c.kind === 'crouch') {
      const { head } = this.crouchPose(c);
      return this.local(c, head.x + 10, head.y + 5);
    }
    return this.local(c, 14, -98);
  }

  private breathe(c: Camper, amount: number) {
    const m = this.mouth(c);
    const s = this.scale;
    const n = Math.round(2 + amount * 2);
    for (let i = 0; i < n; i++) {
      if (this.puffs.length >= MAX_PUFFS) return;
      this.puffs.push({
        x: m.x,
        y: m.y,
        vx: c.dir * rand(12, 24) * s * amount,
        vy: -rand(2, 8) * s,
        age: -i * 0.06,
        life: rand(0.8, 1.3),
        size: rand(2.5, 4) * s * (0.6 + amount * 0.4),
        alpha: 0.08 + 0.1 * Math.min(1, amount),
        smoke: false,
      });
    }
  }

  /**
   * A camper as a backlit silhouette: one dark shape, with the firelight catching only the edge that
   * faces the fire — a thin bright rim and a softer glow just inside it.
   */
  private drawCamper(ctx: CanvasRenderingContext2D, c: Camper, light: number) {
    const s = this.scale;
    const k = c.size;
    const hop = c.poke > 0 ? Math.sin(c.poke * Math.PI) * 6 : 0;
    const warm = clamp(light * (1.1 - Math.abs(this.pitX - c.x) / (520 * s)), 0, 1);
    const fx = (this.pitX - c.x) / (c.dir * k);
    const fy = (this.pitY - this.flameH * 0.45 - c.y) / k;

    ctx.save();
    ctx.translate(c.x, c.y - hop * k);
    ctx.scale(c.dir * k, k);
    ctx.fillStyle = 'rgba(8, 5, 3, 0.4)';
    ctx.beginPath();
    ctx.ellipse(4, hop, 28, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const parts: Path2D[] = [];
    const add = (p: Path2D) => parts.push(p);
    let glint: { x: number; y: number } | null = null;
    let ember: { x: number; y: number } | null = null;
    let cup: { x: number; y: number } | null = null;
    let centre = { x: 0, y: -50 };

    if (c.kind === 'sit') {
      const { up, a, hip, sh, head } = this.sitPose(c);
      centre = { x: hip.x, y: hip.y - 10 };
      // The camp chair: crossed legs, sling seat and back.
      add(taper(-22, 0, 1.3, 12, -36, 1.3));
      add(taper(12, 0, 1.3, -22, -36, 1.3));
      const chair = new Path2D();
      chair.moveTo(-24, -38);
      chair.quadraticCurveTo(-4, -28, 16, -38);
      chair.lineTo(14, -32);
      chair.quadraticCurveTo(-4, -22, -22, -32);
      chair.lineTo(-42, -88);
      chair.lineTo(-32, -91);
      chair.lineTo(-14, -38);
      chair.closePath();
      add(chair);
      const knee = { x: 22 - up * 4, y: -42 };
      const foot = { x: 44 - up * 20, y: -4 };
      add(taper(hip.x, hip.y, 9, knee.x, knee.y, 7));
      add(taper(knee.x, knee.y, 7, foot.x, foot.y - 2, 5.5));
      add(this.footPath(foot.x + 3, foot.y));
      add(taper(hip.x, hip.y, 13, sh.x, sh.y, 15));
      const rub = Math.sin(this.time * 6 + c.seed) * up;
      const elbow = { x: sh.x + 4 + up * 10, y: sh.y + 20 - up * 8 };
      const hand = { x: hip.x + 18 + up * (sh.x + 30 - hip.x - 18) + rub, y: hip.y - 6 + up * (sh.y + 4 - hip.y + 6) };
      add(taper(sh.x, sh.y + 3, 6.5, elbow.x, elbow.y, 5.5));
      add(taper(elbow.x, elbow.y, 5.5, hand.x, hand.y, 4.2));
      add(this.headPath(head.x, head.y, 10.5, a * 0.5, 'bowl'));
    } else if (c.kind === 'crouch') {
      const { up, hip, sh, head } = this.crouchPose(c);
      centre = { x: 0, y: -36 };
      const knee = { x: 17, y: -31 };
      const ankle = { x: -1, y: -5 };
      add(taper(hip.x, hip.y, 9, knee.x, knee.y, 7.5));
      add(taper(knee.x, knee.y, 7.5, ankle.x, ankle.y, 5.5));
      add(this.footPath(4, -3));
      add(taper(hip.x, hip.y, 13, sh.x, sh.y, 16));
      // Elbow on the knee, poking the fire with a stick.
      const jab = Math.sin(c.jab * Math.PI) * 9;
      const elbow = { x: knee.x + 2, y: knee.y - 5 };
      const hand = { x: 30 + up * 4 + jab * 0.6, y: -38 + jab * 0.3 };
      const tip = { x: 66 + jab, y: -12 + jab * 0.2 };
      add(taper(hand.x - 9, hand.y - 6, 1.6, tip.x, tip.y, 1.1));
      add(taper(sh.x + 2, sh.y + 4, 7, elbow.x, elbow.y, 6));
      add(taper(elbow.x, elbow.y, 6, hand.x, hand.y, 4.2));
      add(this.headPath(head.x, head.y, 10.5, 0.1, 'buzz'));
      glint = { x: head.x + 6.3, y: head.y - 0.6 };
      ember = tip;
    } else {
      const sway = Math.sin(this.time * 0.9 + c.seed) * 0.025;
      ctx.rotate(sway);
      centre = { x: 0, y: -60 };
      add(taper(-4, -3, 5, -4, -34, 6));
      add(taper(5, -3, 5, 4, -34, 6));
      add(this.footPath(-1, -2));
      add(this.footPath(9, -2));
      // A long padded coat down to the shins, hood up.
      const coat = new Path2D();
      coat.moveTo(-13, -88);
      coat.quadraticCurveTo(-16, -60, -19, -24);
      coat.quadraticCurveTo(0, -20, 19, -24);
      coat.quadraticCurveTo(16, -60, 13, -88);
      coat.quadraticCurveTo(0, -95, -13, -88);
      coat.closePath();
      add(coat);
      const hood = new Path2D();
      hood.arc(2, -101, 13, 0, Math.PI * 2);
      hood.ellipse(8, -100, 7.5, 9.5, 0, 0, Math.PI * 2);
      add(hood);
      // Both hands round a hot paper cup.
      add(taper(1, -84, 6.5, 5, -64, 5.5));
      add(taper(5, -64, 5.5, 13, -70, 4.5));
      cup = { x: 16, y: -72 };
    }

    // Rim light, built offscreen: the shape filled bright, then covered by copies of itself nudged
    // away from the fire, which leaves only the edge facing the fire lit.
    const d = Math.hypot(fx - centre.x, fy - centre.y) || 1;
    const ux = (fx - centre.x) / d;
    const uy = (fy - centre.y) / d;
    const dark = blend(c.tint, '#060508', 0.6);
    const box = SILHOUETTE_BOX;
    // Sized for the biggest camper, so it's only reallocated on resize.
    const px = s * Math.min(window.devicePixelRatio || 1, 2);
    this.silhouette ??= document.createElement('canvas');
    const off = this.silhouette;
    const ow = Math.ceil(box.w * px);
    const oh = Math.ceil(box.h * px);
    if (off.width !== ow || off.height !== oh) {
      off.width = ow;
      off.height = oh;
    }
    const octx = off.getContext('2d');
    if (octx) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      octx.clearRect(0, 0, ow, oh);
      octx.setTransform(px, 0, 0, px, -box.x * px, -box.y * px);
      octx.fillStyle = blend('#2a2028', '#ffb874', warm);
      for (const p of parts) octx.fill(p);
      octx.globalCompositeOperation = 'source-atop';
      for (const [shift, color] of [
        [1.4, blend(dark, '#b8582a', 0.15 + 0.4 * warm)],
        [4, dark],
      ] as const) {
        octx.fillStyle = color;
        octx.save();
        octx.translate(-ux * shift, -uy * shift);
        for (const p of parts) octx.fill(p);
        octx.restore();
      }
      ctx.drawImage(off, box.x, box.y, box.w, box.h);
    }

    if (cup) {
      // The paper cup is the one pale thing, catching the light.
      ctx.fillStyle = blend('#6a625a', '#ffe4c4', warm);
      ctx.beginPath();
      ctx.moveTo(cup.x - 4.5, cup.y - 7);
      ctx.lineTo(cup.x + 4.5, cup.y - 7);
      ctx.lineTo(cup.x + 3.5, cup.y + 6);
      ctx.lineTo(cup.x - 3.5, cup.y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(cup.x - 3, cup.y + 2, 4, 3.2, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (glint) {
      // Glasses catching the fire.
      ctx.fillStyle = `rgba(255, 220, 170, ${(0.25 + 0.6 * warm).toFixed(3)})`;
      ctx.fillRect(glint.x - 0.6, glint.y - 1.8, 1.4, 3);
    }
    if (ember) {
      ctx.fillStyle = `rgba(255, 140, 60, ${(0.4 + 0.5 * warm).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(ember.x, ember.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** A head in profile facing right, centred on (x, y), with its haircut. */
  private headPath(x: number, y: number, r: number, tilt: number, hair: 'bowl' | 'buzz') {
    const p = new Path2D();
    p.arc(0, 0, r, 0, Math.PI * 2);
    // Nose and chin.
    p.ellipse(r * 0.94, r * 0.08, r * 0.17, r * 0.22, 0, 0, Math.PI * 2);
    p.ellipse(r * 0.55, r * 0.72, r * 0.32, r * 0.28, 0, 0, Math.PI * 2);
    p.moveTo(-r * 0.4, r * 0.5);
    p.lineTo(-r * 0.2, r * 1.5);
    p.lineTo(r * 0.45, r * 1.5);
    p.lineTo(r * 0.35, r * 0.6);
    p.closePath();
    if (hair === 'bowl') {
      // A thick mop with a straight fringe.
      p.moveTo(-r * 0.5, r * 0.68);
      p.bezierCurveTo(-r * 1.3, r * 0.25, -r * 1.05, -r * 1.2, 0, -r * 1.16);
      p.bezierCurveTo(r * 0.8, -r * 1.12, r * 1.15, -r * 0.6, r * 1.0, -r * 0.18);
      p.lineTo(r * 0.2, -r * 0.2);
      p.lineTo(-r * 0.4, r * 0.3);
      p.closePath();
    }
    const out = new Path2D();
    out.addPath(p, new DOMMatrix().translateSelf(x, y).rotateSelf((tilt * 180) / Math.PI));
    return out;
  }

  private footPath(x: number, y: number) {
    const p = new Path2D();
    p.ellipse(x, y, 7.5, 3.4, 0, 0, Math.PI * 2);
    return p;
  }

  // ---- the pit ----

  /** A hole dug in the dirt with the spoil heaped round it. The front lip is drawn over the flames' base. */
  private drawPit(ctx: CanvasRenderingContext2D, light: number, part: 'back' | 'front') {
    const s = this.scale;
    const { pitX: x, pitY: y, pitRx: rx, pitRy: ry } = this;
    const l = clamp(light, 0, 1.3);
    if (part === 'back') {
      // A shovel left standing in the heap — the pit was dug to keep the fire contained.
      const sx = x - rx * 1.45;
      ctx.strokeStyle = blend('#4a3424', '#c08050', l * 0.6);
      ctx.lineWidth = 3.4 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx, y - 6 * s);
      ctx.lineTo(sx - 20 * s, y - 74 * s);
      ctx.stroke();
      ctx.lineWidth = 2.4 * s;
      ctx.beginPath();
      ctx.moveTo(sx - 26 * s, y - 78 * s);
      ctx.lineTo(sx - 16 * s, y - 82 * s);
      ctx.stroke();
      ctx.fillStyle = blend('#5a5e66', '#d0a070', l * 0.5);
      ctx.beginPath();
      ctx.moveTo(sx - 7 * s, y - 10 * s);
      ctx.lineTo(sx + 6 * s, y - 14 * s);
      ctx.lineTo(sx + 8 * s, y - 2 * s);
      ctx.lineTo(sx - 4 * s, y + 2 * s);
      ctx.closePath();
      ctx.fill();

      const heap = new Path2D();
      heap.ellipse(x, y + 1 * s, rx * 1.55, ry * 2.1, 0, 0, Math.PI * 2);
      shade(ctx, heap, { base: '#4e3626', shadow: '#2c1e15', light: blend('#5e4430', '#e09a5e', l * 0.8) }, { x: 0, y: 1 }, 4 * s, 3 * s);
      // The hole, its back wall lit by the fire inside.
      ctx.fillStyle = '#120a06';
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, Math.PI, 0);
      ctx.clip();
      const wall = ctx.createLinearGradient(0, y - ry, 0, y + ry * 0.5);
      wall.addColorStop(0, `rgba(255, 140, 60, ${(0.55 * l).toFixed(3)})`);
      wall.addColorStop(1, 'rgba(255, 90, 30, 0)');
      ctx.fillStyle = wall;
      ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
      ctx.restore();
      // Coals in the bottom.
      glow(ctx, x, y + ry * 0.3, rx * 0.9, [255, 110, 40], 0.5 * l);
      return;
    }

    const lip = new Path2D();
    lip.ellipse(x, y + 1 * s, rx * 1.55, ry * 2.1, 0, 0, Math.PI);
    lip.ellipse(x, y, rx, ry, 0, Math.PI, 0, true);
    lip.closePath();
    ctx.fillStyle = '#3c291c';
    ctx.fill(lip);
    ctx.strokeStyle = blend('#5e4430', '#ffb070', l * 0.85);
    ctx.lineWidth = 2.2 * s;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0.1, Math.PI - 0.1);
    ctx.stroke();

    // Rocks round the rim.
    const rock = (rx0: number, ry0: number, r: number) => {
      const p = new Path2D();
      p.ellipse(rx0, ry0, r, r * 0.72, 0, 0, Math.PI * 2);
      shade(ctx, p, { base: '#4a4440', shadow: '#24201e', light: blend('#6a6460', '#f0a870', l * 0.85) }, { x: x - rx0, y: y - 60 * s - ry0 }, 2.5 * s, 6 * s);
    };
    rock(x + rx * 1.25, y + 3 * s, 15 * s);
    rock(x - rx * 1.3, y + 6 * s, 9 * s);
    rock(x - rx * 0.55, y + ry * 1.75, 6.5 * s);
    rock(x + rx * 0.35, y + ry * 1.9, 5 * s);
  }

  // ---- scene ----

  /** Sky, moon, the misty valley, bare woods, the fence, the camp and the clearing. Painted once per resize. */
  private paintScene(ctx: CanvasRenderingContext2D) {
    const { width: w, height: h, scale: s, ground, fenceY } = this;
    const rand = seeded(1223);

    const sky = ctx.createLinearGradient(0, 0, 0, fenceY);
    sky.addColorStop(0, '#161a26');
    sky.addColorStop(0.45, '#2c3142');
    sky.addColorStop(0.8, '#4c5064');
    sky.addColorStop(1, '#646678');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // The moon behind thin cloud.
    const mx = w * 0.74;
    const my = h * 0.15;
    glow(ctx, mx, my, 260 * s, [200, 210, 240], 0.32);
    ctx.fillStyle = '#e8ecf6';
    ctx.beginPath();
    ctx.arc(mx, my, 15 * s, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 14; i++) {
      const cx = rand() * w;
      const cy = rand() ** 1.4 * h * 0.4;
      const r = (60 + rand() * 120) * s;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const near = clamp(1 - Math.hypot(cx - mx, cy - my) / (300 * s), 0, 1);
      const tone = mix(hexRgb('#3a3e52'), hexRgb('#a8acc0'), near * 0.8);
      g.addColorStop(0, css(tone, 0.5));
      g.addColorStop(1, css(tone, 0));
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1.8, 0.6);
      ctx.translate(-cx, -cy);
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    }

    // Across the valley: a mountainside fading into the mist.
    ctx.fillStyle = '#3e4254';
    ctx.fill(ridge(w, fenceY - h * 0.16, h * 0.3, 0.0016, 41, h));
    const haze = ctx.createLinearGradient(0, fenceY - h * 0.3, 0, fenceY);
    haze.addColorStop(0, 'rgba(120, 124, 146, 0)');
    haze.addColorStop(1, 'rgba(120, 124, 146, 0.75)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, fenceY - h * 0.3, w, h * 0.3);

    // Far woods down the slope, soft in the mist.
    ctx.fillStyle = '#4e5266';
    ctx.strokeStyle = '#4e5266';
    ctx.lineCap = 'round';
    for (let x = rand() * 30 * s; x < w; x += (22 + rand() * 30) * s) {
      bareTree(ctx, x, fenceY + 10 * s, (90 + rand() * 90) * s, (2.5 + rand() * 2) * s, rand);
    }
    const mist = ctx.createLinearGradient(0, fenceY - 90 * s, 0, fenceY + 10 * s);
    mist.addColorStop(0, 'rgba(110, 114, 136, 0)');
    mist.addColorStop(1, 'rgba(110, 114, 136, 0.6)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, fenceY - 90 * s, w, 100 * s);

    // The tall oaks and a few pines round the site.
    const pines = new Path2D();
    for (const fx of [0.31, 0.58, 0.97]) pine(pines, w * fx, fenceY + 6 * s, (150 + rand() * 60) * s, rand);
    ctx.fillStyle = '#1d2422';
    ctx.fill(pines);
    ctx.fillStyle = '#1c1c24';
    ctx.strokeStyle = '#1c1c24';
    for (let x = rand() * 50 * s; x < w + 40 * s; x += (60 + rand() * 70) * s) {
      if (Math.abs(x - this.cx) < 70 * s) continue;
      const tall = Math.max(h - (h - fenceY) * 0.4, (260 + rand() * 160) * s);
      bareTree(ctx, x, fenceY + (4 + rand() * 10) * s, tall, (5 + rand() * 4) * s, rand);
    }

    // The leafy bank on the left, with the mossy boulder.
    const bankR = Math.max(w * 0.3, 260 * s);
    const bank = new Path2D();
    bank.moveTo(0, ground);
    bank.lineTo(0, fenceY - 120 * s);
    bank.bezierCurveTo(bankR * 0.35, fenceY - 130 * s, bankR * 0.6, fenceY - 40 * s, bankR, fenceY + 12 * s);
    bank.lineTo(bankR, ground);
    bank.closePath();
    shade(ctx, bank, { base: '#4a2c1e', shadow: '#2c1a12', light: '#5e3a26' }, { x: 1, y: -1 }, 3 * s, 6 * s);
    const boulder = new Path2D();
    boulder.ellipse(bankR * 0.32, fenceY - 70 * s, 54 * s, 34 * s, -0.15, Math.PI, 0);
    boulder.closePath();
    shade(ctx, boulder, { base: '#3e4a32', shadow: '#232a1c', light: '#56653e' }, { x: 1, y: -1 }, 3 * s, 8 * s);
    ctx.fillStyle = 'rgba(110, 130, 70, 0.35)';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.ellipse(bankR * 0.32 + (rand() - 0.5) * 70 * s, fenceY - (75 + rand() * 20) * s, (6 + rand() * 8) * s, (3 + rand() * 3) * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    this.litter(ctx, bank, 160, rand);

    // The rope fence along the edge of the drop.
    ctx.fillStyle = '#4a4034';
    const posts: number[] = [];
    for (let x = bankR * 0.9; x < w + 60 * s; x += 118 * s) posts.push(x);
    for (const px of posts) ctx.fillRect(px - 2.5 * s, fenceY - 36 * s, 5 * s, 40 * s);
    ctx.strokeStyle = '#8a8478';
    ctx.lineWidth = 2 * s;
    for (const off of [30, 14]) {
      ctx.beginPath();
      for (let i = 0; i < posts.length - 1; i++) {
        const a = posts[i];
        const b = posts[i + 1];
        ctx.moveTo(a, fenceY - off * s);
        ctx.quadraticCurveTo((a + b) / 2, fenceY - (off - 9) * s, b, fenceY - off * s);
      }
      ctx.stroke();
    }

    // The clearing: packed dirt, gravel towards the car, leaves drifted against the fence.
    const dirt = ctx.createLinearGradient(0, fenceY, 0, h);
    dirt.addColorStop(0, '#4a3628');
    dirt.addColorStop(1, '#2a1e16');
    ctx.fillStyle = dirt;
    ctx.beginPath();
    ctx.moveTo(bankR * 0.85, fenceY);
    ctx.lineTo(w, fenceY);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.lineTo(0, ground - 10 * s);
    ctx.quadraticCurveTo(bankR * 0.6, ground - 20 * s, bankR * 0.85, fenceY);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 260; i++) {
      const gx = w * (0.6 + rand() * 0.4);
      const gy = fenceY + rand() * (h - fenceY);
      ctx.fillStyle = rand() < 0.5 ? 'rgba(130, 128, 120, 0.35)' : 'rgba(30, 26, 22, 0.4)';
      ctx.fillRect(gx, gy, (1 + rand() * 2) * s, (1 + rand()) * s);
    }
    const drift = new Path2D();
    drift.rect(bankR * 0.8, fenceY - 6 * s, w, 18 * s);
    this.litter(ctx, drift, 120, rand);
    const floor = new Path2D();
    floor.rect(0, fenceY + 10 * s, w, h - fenceY);
    this.litter(ctx, floor, 140, rand, true);

    // A log bench at the foot of the bank.
    const bx = Math.max(bankR * 0.75, this.cx - 300 * s);
    ctx.fillStyle = '#3e3a2c';
    ctx.fillRect(bx - 34 * s, fenceY + 2 * s, 7 * s, 12 * s);
    ctx.fillRect(bx + 27 * s, fenceY + 2 * s, 7 * s, 12 * s);
    ctx.fillStyle = '#5a5642';
    ctx.fillRect(bx - 42 * s, fenceY - 3 * s, 84 * s, 6 * s);

    this.paintCamp(ctx);
    this.paintCar(ctx);
  }

  /** Fallen oak leaves scattered inside `area`. */
  private litter(ctx: CanvasRenderingContext2D, area: Path2D, count: number, rand: () => number, sparse = false) {
    const { width: w, height: h, scale: s } = this;
    ctx.save();
    ctx.clip(area);
    for (let i = 0; i < count; i++) {
      const x = rand() * w;
      const y = rand() * h;
      // Kept clear round the pit, where the ground was swept before the fire.
      if (sparse && Math.hypot((x - this.pitX) / 2.6, y - this.pitY) < 50 * s) continue;
      ctx.fillStyle = LEAF_TONES[Math.floor(rand() * LEAF_TONES.length)];
      ctx.globalAlpha = 0.55 + rand() * 0.35;
      ctx.beginPath();
      ctx.ellipse(x, y, (3 + rand() * 3) * s, (1.4 + rand() * 1.2) * s, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** The yellow tarp on its poles, and the red dome tent under it. */
  private paintCamp(ctx: CanvasRenderingContext2D) {
    const { scale: s, ground } = this;
    const L = Math.max(this.width * 0.04, this.cx - 470 * s);
    const base = ground - 34 * s;
    const toward = { x: 1, y: -0.6 };

    // Tent: a red dome with its door half unzipped.
    const tx = L + 128 * s;
    const tent = new Path2D();
    tent.moveTo(tx - 74 * s, base);
    tent.bezierCurveTo(tx - 64 * s, base - 70 * s, tx + 50 * s, base - 76 * s, tx + 76 * s, base);
    tent.closePath();
    ctx.fillStyle = 'rgba(160, 150, 140, 0.3)';
    ctx.fillRect(tx - 82 * s, base - 2 * s, 164 * s, 5 * s);
    shade(ctx, tent, { base: '#a8201f', shadow: '#5e1012', light: '#d24434' }, toward, 3 * s, 10 * s);
    ctx.strokeStyle = 'rgba(30, 6, 6, 0.6)';
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.moveTo(tx - 40 * s, base);
    ctx.bezierCurveTo(tx - 30 * s, base - 50 * s, tx + 20 * s, base - 56 * s, tx + 30 * s, base);
    ctx.stroke();
    ctx.fillStyle = '#2a0c0c';
    ctx.beginPath();
    ctx.moveTo(tx - 4 * s, base);
    ctx.quadraticCurveTo(tx + 2 * s, base - 40 * s, tx + 22 * s, base - 42 * s);
    ctx.quadraticCurveTo(tx + 30 * s, base - 20 * s, tx + 26 * s, base);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#16161a';
    ctx.fillRect(tx - 74 * s, base - 4 * s, 150 * s, 4 * s);

    // Tarp poles and guy lines.
    const A = { x: L, y: base - 108 * s };
    const B = { x: L + 92 * s, y: base - 168 * s };
    const C = { x: L + 290 * s, y: base - 150 * s };
    const D = { x: L + 230 * s, y: base - 104 * s };
    ctx.strokeStyle = 'rgba(210, 205, 195, 0.45)';
    ctx.lineWidth = 0.8 * s;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(A.x - 40 * s, ground + 6 * s);
    ctx.moveTo(D.x, D.y);
    ctx.lineTo(D.x + 30 * s, ground + 14 * s);
    ctx.moveTo(C.x, C.y);
    ctx.lineTo(C.x + 50 * s, base + 4 * s);
    ctx.stroke();
    ctx.strokeStyle = '#c09a26';
    ctx.lineWidth = 2.6 * s;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y - 6 * s);
    ctx.lineTo(A.x, ground);
    ctx.moveTo(D.x, D.y - 6 * s);
    ctx.lineTo(D.x, ground + 6 * s);
    ctx.moveTo(B.x, B.y - 8 * s);
    ctx.lineTo(B.x + 6 * s, base);
    ctx.stroke();

    // The tarp: yellow with an olive band down the ridge and a red-brown hem.
    const tarp = new Path2D();
    tarp.moveTo(A.x, A.y);
    tarp.lineTo(B.x, B.y);
    tarp.lineTo(C.x, C.y);
    tarp.quadraticCurveTo(C.x - 20 * s, C.y + 26 * s, D.x, D.y);
    tarp.quadraticCurveTo((A.x + D.x) / 2, A.y + 8 * s, A.x, A.y);
    tarp.closePath();
    shade(ctx, tarp, { base: '#c9a51e', shadow: '#8a6e12', light: '#e6c640' }, { x: 0.3, y: -1 }, 3 * s, 12 * s);
    ctx.save();
    ctx.clip(tarp);
    const band = new Path2D();
    band.moveTo(B.x - 30 * s, B.y - 10 * s);
    band.lineTo(C.x + 10 * s, C.y - 10 * s);
    band.lineTo(C.x + 10 * s, C.y + 16 * s);
    band.lineTo(B.x - 16 * s, B.y + 22 * s);
    band.closePath();
    ctx.fillStyle = '#5e5a2c';
    ctx.fill(band);
    ctx.restore();
    ctx.strokeStyle = '#7a2420';
    ctx.lineWidth = 1.6 * s;
    ctx.stroke(tarp);
  }

  /** The car parked on the gravel, from behind: a grey compact SUV. */
  private paintCar(ctx: CanvasRenderingContext2D) {
    const s = this.scale;
    const x = this.carX;
    const y = this.carY;
    const toward = { x: -1, y: -0.8 };
    ctx.fillStyle = 'rgba(8, 6, 4, 0.5)';
    ctx.beginPath();
    ctx.ellipse(x, y + 2 * s, 84 * s, 8 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tyres under the body.
    ctx.fillStyle = '#121214';
    ctx.fillRect(x - 70 * s, y - 20 * s, 22 * s, 22 * s);
    ctx.fillRect(x + 48 * s, y - 20 * s, 22 * s, 22 * s);
    const cabin = new Path2D();
    cabin.moveTo(x - 62 * s, y - 62 * s);
    cabin.lineTo(x - 52 * s, y - 98 * s);
    cabin.quadraticCurveTo(x, y - 104 * s, x + 52 * s, y - 98 * s);
    cabin.lineTo(x + 62 * s, y - 62 * s);
    cabin.closePath();
    shade(ctx, cabin, { base: '#6c6a66', shadow: '#3c3a38', light: '#8a8884' }, toward, 2 * s, 6 * s);
    ctx.fillStyle = '#22262c';
    ctx.beginPath();
    ctx.moveTo(x - 52 * s, y - 66 * s);
    ctx.lineTo(x - 44 * s, y - 92 * s);
    ctx.quadraticCurveTo(x, y - 97 * s, x + 44 * s, y - 92 * s);
    ctx.lineTo(x + 52 * s, y - 66 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(160, 170, 190, 0.12)';
    ctx.beginPath();
    ctx.moveTo(x - 36 * s, y - 68 * s);
    ctx.lineTo(x - 18 * s, y - 92 * s);
    ctx.lineTo(x - 6 * s, y - 92 * s);
    ctx.lineTo(x - 24 * s, y - 68 * s);
    ctx.closePath();
    ctx.fill();
    // Roof rails.
    ctx.fillStyle = '#2a2a2c';
    ctx.fillRect(x - 46 * s, y - 104 * s, 8 * s, 4 * s);
    ctx.fillRect(x + 38 * s, y - 104 * s, 8 * s, 4 * s);
    const body = new Path2D();
    body.moveTo(x - 76 * s, y - 16 * s);
    body.lineTo(x - 74 * s, y - 56 * s);
    body.quadraticCurveTo(x - 70 * s, y - 64 * s, x - 60 * s, y - 64 * s);
    body.lineTo(x + 60 * s, y - 64 * s);
    body.quadraticCurveTo(x + 70 * s, y - 64 * s, x + 74 * s, y - 56 * s);
    body.lineTo(x + 76 * s, y - 16 * s);
    body.closePath();
    shade(ctx, body, { base: '#77746e', shadow: '#45433f', light: '#9a9790' }, toward, 2 * s, 8 * s);
    // Bumper, a blank plate and the tail lamps (lit separately).
    ctx.fillStyle = '#3a3a3c';
    ctx.fillRect(x - 76 * s, y - 22 * s, 152 * s, 9 * s);
    ctx.fillStyle = '#c8c8c0';
    ctx.fillRect(x - 18 * s, y - 44 * s, 36 * s, 11 * s);
    ctx.fillStyle = '#5c1414';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * 74 * s, y - 56 * s);
      ctx.lineTo(x + side * 56 * s, y - 54 * s);
      ctx.lineTo(x + side * 58 * s, y - 42 * s);
      ctx.lineTo(x + side * 75 * s, y - 40 * s);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** The tail lamps and indicators, flashing when the car is tapped. */
  private drawCarLights(ctx: CanvasRenderingContext2D) {
    if (this.blink <= 0) return;
    const on = Math.floor((1.2 - this.blink) / 0.3) % 2 === 0;
    if (!on) return;
    const s = this.scale;
    for (const side of [-1, 1]) {
      const lx = this.carX + side * 66 * s;
      const ly = this.carY - 48 * s;
      ctx.fillStyle = '#ff5a3a';
      ctx.beginPath();
      ctx.moveTo(this.carX + side * 74 * s, ly - 8 * s);
      ctx.lineTo(this.carX + side * 56 * s, ly - 6 * s);
      ctx.lineTo(this.carX + side * 58 * s, ly + 6 * s);
      ctx.lineTo(this.carX + side * 75 * s, ly + 8 * s);
      ctx.closePath();
      ctx.fill();
      glow(ctx, lx, ly, 40 * s, [255, 150, 60], 0.6);
    }
  }

  // ---- mist and frost ----

  private paintMist() {
    const { width: w, scale: s } = this;
    const band = 220 * s;
    const rand = seeded(77);
    this.mist = offscreen(w, band, (ctx) => {
      for (let i = 0; i < 26; i++) {
        const x = rand() * w;
        const y = band * (0.3 + rand() * 0.5);
        const r = (50 + rand() * 90) * s;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(170, 172, 192, 0.22)');
        g.addColorStop(1, 'rgba(170, 172, 192, 0)');
        ctx.fillStyle = g;
        // Wrapped, so the band tiles as it drifts.
        for (const o of [-w, 0, w]) {
          ctx.save();
          ctx.translate(x + o, y);
          ctx.scale(2.4, 0.6);
          ctx.fillRect(-r, -r, r * 2, r * 2);
          ctx.restore();
        }
      }
    });
  }

  /** Mist drifting along the valley below the fence. */
  private drawMist(ctx: CanvasRenderingContext2D) {
    if (!this.mist) return;
    const band = this.mist.height;
    const top = this.fenceY - band * 0.75;
    const shift = (this.time * 9 * this.scale) % this.width;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.mist, shift, top, this.width, band);
    ctx.drawImage(this.mist, shift - this.width, top, this.width, band);
    ctx.globalAlpha = 1;
  }

  /** Frost feathering in from the edges of the view, as if on a cold lens. */
  private paintFrost() {
    const { width: w, height: h, scale: s } = this;
    const rand = seeded(5);
    this.frost = offscreen(w, h, (ctx) => {
      const edge = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      edge.addColorStop(0, 'rgba(200, 220, 255, 0)');
      edge.addColorStop(1, 'rgba(210, 228, 255, 0.4)');
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, w, h);
      // Feathery crystals creeping in from the border: a wandering spine with fine needles off it.
      ctx.lineCap = 'round';
      const feather = (x: number, y: number, angle: number, len: number, width: number) => {
        let px = x;
        let py = y;
        let a = angle;
        const steps = 10;
        for (let i = 0; i < steps; i++) {
          a += (rand() - 0.5) * 0.5;
          const step = len / steps;
          const nx = px + Math.cos(a) * step;
          const ny = py + Math.sin(a) * step;
          const fade = 1 - i / steps;
          ctx.strokeStyle = `rgba(232, 242, 255, ${(0.5 * fade).toFixed(3)})`;
          ctx.lineWidth = Math.max(0.4, width * fade);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(nx, ny);
          // Needles, angled back towards the border on alternating sides.
          const side = i % 2 ? 1 : -1;
          const nl = step * (0.6 + rand() * 0.8) * fade;
          ctx.moveTo(nx, ny);
          ctx.lineTo(nx + Math.cos(a + side * 2.2) * nl, ny + Math.sin(a + side * 2.2) * nl);
          ctx.stroke();
          if (rand() < 0.12 && width > 0.8) feather(nx, ny, a + side * 0.7, len * 0.45 * fade, width * 0.6);
          px = nx;
          py = ny;
        }
      };
      const count = Math.round((w + h) / (9 * s));
      for (let i = 0; i < count; i++) {
        // A point on the border, growing inwards — longer from the corners.
        const along = rand() * (w * 2 + h * 2);
        let x = 0;
        let y = 0;
        if (along < w) [x, y] = [along, 0];
        else if (along < w * 2) [x, y] = [along - w, h];
        else if (along < w * 2 + h) [x, y] = [0, along - w * 2];
        else [x, y] = [w, along - w * 2 - h];
        const toCorner = Math.min(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y));
        const reach = (20 + rand() * 40 + Math.max(0, 1 - toCorner / (300 * s)) * 110) * s;
        const angle = Math.atan2(h / 2 - y, w / 2 - x) + (rand() - 0.5) * 1.4;
        feather(x, y, angle, reach, 1.4 * s);
      }
    });
  }

  // ---- leaves ----

  private scatterLeaves() {
    this.leaves = [];
    for (let i = 0; i < 36; i++) {
      const l = this.newLeaf(Math.random() * this.width, 0);
      l.airborne = false;
      l.y = l.floor;
      if (this.inPit(l.x, l.y)) l.x += this.pitRx * 3;
      this.leaves.push(l);
    }
  }

  private newLeaf(x: number, y: number): Leaf {
    const s = this.scale;
    const floor = this.fenceY + 14 * s + Math.random() ** 0.7 * (this.height - 30 * s - this.fenceY - 14 * s);
    return {
      x,
      y,
      vx: 0,
      vy: 0,
      rot: Math.random() * Math.PI * 2,
      spin: rand(-3, 3),
      size: rand(3.2, 5.5) * s,
      tone: LEAF_TONES[Math.floor(Math.random() * LEAF_TONES.length)],
      floor,
      airborne: true,
      seed: Math.random() * 100,
    };
  }

  private inPit(x: number, y: number) {
    const dx = (x - this.pitX) / (this.pitRx * 1.1);
    const dy = (y - this.pitY) / (this.pitRy * 2.2);
    return dx * dx + dy * dy < 1;
  }

  /** Kicks the leaves within `radius` of (x, y) into the air, pushed along by `vx` (or outwards). */
  private stir(x: number, y: number, radius: number, vx: number, amount: number) {
    const s = this.scale;
    for (const l of this.leaves) {
      const d = Math.hypot(l.x - x, (l.y - y) * 1.6);
      if (d > radius || (l.airborne && l.y < l.floor - 30 * s)) continue;
      const push = (1 - d / radius) * amount;
      if (Math.random() > push * 1.5) continue;
      l.airborne = true;
      l.vx += vx ? vx * 0.35 * push : Math.sign(l.x - x || 1) * rand(60, 160) * s * push;
      l.vy = -rand(80, 200) * s * push;
      l.spin = rand(-8, 8);
    }
  }

  private stepLeaves(dt: number) {
    const s = this.scale;
    // Oak leaves still clinging to the branches let go now and then, more in a gust.
    const want = this.reducedMotion ? 0.15 : 0.35 + Math.abs(this.wind) * 1.4;
    this.leafDebt += want * dt;
    while (this.leafDebt >= 1) {
      this.leafDebt -= 1;
      if (this.leaves.length < MAX_LEAVES) this.leaves.push(this.newLeaf(Math.random() * this.width, -10 * s));
    }
    const gusting = Math.abs(this.wind) > 0.55;
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const l = this.leaves[i];
      if (l.airborne) {
        // Fluttering down: sideways rocking, drag, carried by the wind.
        l.vy += 90 * s * dt;
        l.vy = Math.min(l.vy, 46 * s);
        l.vx += ((this.wind * 90 + Math.sin(this.time * 2.5 + l.seed) * 40) * s - l.vx) * Math.min(1, dt * 1.6);
        l.rot += l.spin * dt;
        l.x += l.vx * dt;
        l.y += l.vy * dt;
        if (l.y >= l.floor && l.vy > 0) {
          l.y = l.floor;
          l.airborne = false;
          l.vx *= 0.3;
        }
      } else {
        // On the ground: a strong gust sends them skittering.
        if (gusting && Math.random() < dt * 1.2) {
          l.vx += this.wind * rand(60, 140) * s;
          if (Math.random() < 0.3) {
            l.airborne = true;
            l.vy = -rand(30, 90) * s;
          }
        }
        l.vx *= Math.exp(-3 * dt);
        l.x += l.vx * dt;
        l.rot += l.vx * 0.02 * dt;
      }
      // Into the pit, or through the flames: it burns.
      const flames = l.airborne && Math.abs(l.x - this.pitX) < 36 * s && l.y > this.pitY - this.flameH * 0.8 && l.y < this.pitY;
      if (this.inPit(l.x, l.y) || flames) {
        this.fuel = Math.min(this.fuel + 0.04, FUEL_MAX);
        this.fire.burst(l.x, this.pitY - 10 * s, 1);
        for (let k = 0; k < 6; k++) this.burstEmber(l.x, l.y, 0.6);
        this.leaves.splice(i, 1);
        continue;
      }
      if (l.x < -30 * s || l.x > this.width + 30 * s) this.leaves.splice(i, 1);
    }
  }

  private drawLeaf(ctx: CanvasRenderingContext2D, l: Leaf) {
    const near = clamp(1 - Math.hypot(l.x - this.pitX, (l.y - this.pitY) * 2) / (260 * this.scale), 0, 1);
    const light = near * (0.45 + 0.45 * Math.min(this.fuel, 2.2)) * this.flicker;
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.rot);
    // Tumbling leaves flip edge-on.
    ctx.scale(1, l.airborne ? 0.35 + 0.65 * Math.abs(Math.sin(l.rot * 1.3)) : 0.55);
    ctx.fillStyle = light > 0.05 ? blend(l.tone, '#ffa060', light * 0.6) : l.tone;
    ctx.beginPath();
    ctx.moveTo(-l.size, 0);
    ctx.quadraticCurveTo(0, -l.size * 0.75, l.size, 0);
    ctx.quadraticCurveTo(0, l.size * 0.75, -l.size, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 14, 6, 0.5)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-l.size, 0);
    ctx.lineTo(l.size * 1.2, 0);
    ctx.stroke();
    ctx.restore();
  }

  // ---- smoke, breath and embers ----

  private puff(x: number, y: number, smoke: boolean) {
    if (this.puffs.length >= MAX_PUFFS) return;
    const s = this.scale;
    this.puffs.push({ x, y, vx: rand(-6, 6) * s, vy: -rand(26, 46) * s, age: 0, life: rand(2.6, 4), size: rand(8, 14) * s, alpha: 0.13, smoke });
  }

  private stepPuffs(dt: number) {
    const s = this.scale;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.puffs[i] = this.puffs[this.puffs.length - 1];
        this.puffs.pop();
        continue;
      }
      if (p.age < 0) continue;
      const drag = Math.exp(-(p.smoke ? 0.4 : 1.8) * dt);
      p.vx = p.vx * drag + this.wind * (p.smoke ? 40 : 14) * s * dt;
      p.vy = p.vy * drag - (p.smoke ? 0 : 6 * s * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += (p.smoke ? 9 : 12) * s * dt;
    }
  }

  private drawPuffs(ctx: CanvasRenderingContext2D, cold: number) {
    for (const p of this.puffs) {
      if (p.age < 0) continue;
      const t = p.age / p.life;
      const fade = Math.sin(Math.min(1, t * 1.2) * Math.PI) ** 0.8;
      // Breath shows more in the cold.
      const alpha = p.alpha * fade * (p.smoke ? 1 : 0.5 + 0.5 * cold);
      if (alpha < 0.005) continue;
      ctx.fillStyle = p.smoke ? `rgba(150, 146, 150, ${alpha.toFixed(3)})` : `rgba(235, 240, 250, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x + p.size * 0.5, p.y - p.size * 0.2, p.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private burstEmber(x: number, y: number, power: number) {
    const angle = -Math.PI / 2 + rand(-1.1, 1.1);
    const speed = rand(150, 420) * this.scale * power;
    this.pushEmber(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  private pushEmber(x: number, y: number, vx: number, vy: number) {
    if (this.embers.length >= MAX_EMBERS) return;
    this.embers.push({ x, y, vx, vy, age: 0, life: rand(1.1, 2.6), size: rand(1, 2) * Math.max(this.scale, 0.8), seed: Math.random() * 100 });
  }

  private stepEmbers(dt: number) {
    const s = this.scale;
    const drag = Math.max(0, 1 - 0.7 * dt);
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.age += dt;
      if (e.age >= e.life || e.y < -20 || e.x < -20 || e.x > this.width + 20) {
        this.embers[i] = this.embers[this.embers.length - 1];
        this.embers.pop();
        continue;
      }
      e.vy -= 40 * s * dt;
      e.vx += (noise2(e.seed, this.time * 0.9) - 0.5) * 480 * s * dt + this.wind * 150 * s * dt;
      e.vx *= drag;
      e.vy *= drag;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
  }
}

export const winterCampTheme: FireTheme = {
  id: 'winter-camp',
  label: 'Winter Camp',
  palette: {
    titleFrom: '#f2f5ff',
    titleTo: '#ffd3a0',
    titleGlow: 'rgba(255, 160, 90, 0.35)',
    ambient: '#1a1f2c',
  },
  letters: { knock: 'touch', draggable: true, item: false },
  createRenderer: () => new WinterCamp(),
};
