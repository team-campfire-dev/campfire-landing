import { noise1 } from '../noise';
import { PixelFire, PixelFireCanvas, packPalette } from '../pixelFire';
import type { FireFrame, FireHost, FireRenderer, FireTap, FireTheme, HotZone } from '../types';

// The 36 lit colors of the PSX DOOM fire palette, coolest to hottest (index 0, black, is "no fire").
const DOOM_FIRE = [
  '#1f0707', '#2f0f07', '#470f07', '#571707', '#671f07', '#771f07', '#8f2707', '#9f2f07',
  '#af3f07', '#bf4707', '#c74707', '#df4f07', '#df5707', '#df5707', '#d75f07', '#d75f07',
  '#d7670f', '#cf6f0f', '#cf770f', '#cf7f0f', '#cf8717', '#c78717', '#c78f17', '#c7971f',
  '#bf9f1f', '#bf9f1f', '#bfa727', '#bfa727', '#bfaf2f', '#b7af2f', '#b7b72f', '#b7b737',
  '#cfcf6f', '#dfdf9f', '#efefc7', '#ffffff',
];
const MAX_HEAT = DOOM_FIRE.length;
/** DOOM ran its game logic at 35 tics per second; the fire spreads once per tic. */
const TIC = 1 / 35;
const MAX_HOLES = 60;
const HOLE_SPRITE = 48;

interface Hole {
  x: number;
  y: number;
  sprite: number;
  size: number;
}

interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  dust: boolean;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** A chipped bullet hole: dark core, broken rim, hairline cracks. */
function makeHoleSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = HOLE_SPRITE;
  canvas.height = HOLE_SPRITE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const c = HOLE_SPRITE / 2;

  const scorch = ctx.createRadialGradient(c, c, 0, c, c, c);
  scorch.addColorStop(0, 'rgba(0,0,0,0.7)');
  scorch.addColorStop(0.45, 'rgba(30,18,12,0.35)');
  scorch.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = scorch;
  ctx.fillRect(0, 0, HOLE_SPRITE, HOLE_SPRITE);

  ctx.strokeStyle = 'rgba(150,140,130,0.45)';
  ctx.lineWidth = 1;
  const cracks = 5 + ((Math.random() * 4) | 0);
  for (let i = 0; i < cracks; i++) {
    let angle = (i / cracks) * Math.PI * 2 + rand(-0.3, 0.3);
    let r = 6;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * r, c + Math.sin(angle) * r);
    const length = rand(10, 20);
    while (r < length) {
      r += rand(3, 5);
      angle += rand(-0.35, 0.35);
      ctx.lineTo(c + Math.cos(angle) * r, c + Math.sin(angle) * r);
    }
    ctx.stroke();
  }

  // Broken rim, then the hole itself.
  ctx.fillStyle = '#4a433e';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const r = rand(5.5, 7.5);
    ctx.lineTo(c + Math.cos(angle) * r, c + Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7a706a';
  ctx.beginPath();
  ctx.arc(c - 1, c - 1, 5, Math.PI * 0.9, Math.PI * 1.6);
  ctx.lineTo(c - 1, c - 1);
  ctx.fill();
  ctx.fillStyle = '#030202';
  ctx.beginPath();
  ctx.arc(c, c, 3.6, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

class DoomFire implements FireRenderer {
  private readonly fire = new PixelFire(1, 1, MAX_HEAT);
  private readonly view = new PixelFireCanvas();
  private readonly palette = packPalette(DOOM_FIRE);
  private readonly holeSprites = Array.from({ length: 4 }, makeHoleSprite);
  private holes: Hole[] = [];
  private debris: Debris[] = [];
  private audio: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  private width = 0;
  private height = 0;
  private scale = 1;
  private cell = 4;
  private time = 0;
  private ignition = 0;
  private boost = 0;
  private wind = 0;
  private flash = 0;
  private lastShot = { x: 0, y: 0 };
  private tics = 0;
  private pointer: FireFrame['pointer'] = null;

  constructor(private readonly host: FireHost) {}

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    this.cell = clamp(Math.round(4 * this.scale), 3, 6);
    this.fire.resize(Math.ceil(width / this.cell) + 2, Math.ceil((height * 0.85) / this.cell));
  }

  hotZone(): HotZone {
    const top = this.height - this.flameHeight() * 0.45;
    return { x: 0, y: top, width: this.width, height: this.height - top };
  }

  tap({ x, y }: FireTap) {
    this.holes.push({ x, y, sprite: (Math.random() * this.holeSprites.length) | 0, size: rand(30, 40) * this.scale });
    if (this.holes.length > MAX_HOLES) this.holes.shift();

    for (let i = 0; i < 14; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(250, 700) * this.scale;
      this.debris.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 150, age: 0, life: rand(0.2, 0.45), size: rand(1.2, 2.2), dust: false });
    }
    for (let i = 0; i < 6; i++) {
      this.debris.push({ x, y, vx: rand(-60, 60), vy: rand(-90, -20), age: 0, life: rand(0.5, 0.9), size: rand(5, 10) * this.scale, dust: true });
    }

    // Shots into the flames make them flare; shots at the wall just leave holes.
    if (y > this.height - this.flameHeight()) {
      this.fire.heat(x / this.cell + 1, (y - this.fireTop()) / this.cell, 5, MAX_HEAT);
      this.boost = Math.min(this.boost + 0.2, 1.5);
    }

    this.lastShot = { x, y };
    this.flash = 1;
    this.host.shake(5);
    this.bang();
  }

  feed(x: number, y: number, fuel: number) {
    this.boost = Math.min(this.boost + 0.6 * fuel, 1.5);
    const gy = (y - this.fireTop()) / this.cell;
    this.fire.heat(x / this.cell + 1, Math.max(gy, 0), 10, MAX_HEAT);
  }

  update({ time, dt, pointer }: FireFrame) {
    this.time = time;
    this.pointer = pointer;
    this.ignition = Math.min(1, this.ignition + dt / 1.2);
    this.boost *= Math.exp(-0.45 * dt);
    this.flash *= Math.exp(-28 * dt);

    const ambient = (noise1(time * 0.3 + 7) - 0.5) * 0.3;
    if (pointer) this.wind += clamp(pointer.vx / 1800, -1, 1) * dt * 5;
    this.wind += (ambient - this.wind) * Math.min(1, dt * 1.5);
    this.wind = clamp(this.wind, -0.8, 0.8);

    this.tics += dt;
    while (this.tics >= TIC) {
      this.tics -= TIC;
      this.tic();
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      if (d.age >= d.life) {
        this.debris[i] = this.debris[this.debris.length - 1];
        this.debris.pop();
        continue;
      }
      if (!d.dust) d.vy += 1400 * dt;
      d.vx *= 1 - 3 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { width, height } = this;

    // Firelight washing up the wall.
    ctx.globalCompositeOperation = 'lighter';
    const light = ctx.createLinearGradient(0, height, 0, height * 0.25);
    const strength = this.ignition * (0.75 + 0.25 * noise1(this.time * 6)) * (1 + 0.4 * this.boost);
    light.addColorStop(0, `rgba(255,70,10,${Math.min(1, 0.22 * strength).toFixed(3)})`);
    light.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'source-over';
    for (const hole of this.holes) {
      ctx.drawImage(this.holeSprites[hole.sprite], hole.x - hole.size / 2, hole.y - hole.size / 2, hole.size, hole.size);
    }

    const { cell } = this;
    const sprite = this.view.render(this.fire, this.palette);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, -cell, this.fireTop(), this.fire.width * cell, this.fire.height * cell);
    ctx.imageSmoothingEnabled = true;

    for (const d of this.debris) {
      const t = d.age / d.life;
      if (d.dust) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.35 * (1 - t);
        ctx.fillStyle = '#8a7f76';
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.size * (1 + t), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = '#ffd27a';
        ctx.lineWidth = d.size;
        ctx.beginPath();
        ctx.moveTo(d.x - d.vx * 0.02, d.y - d.vy * 0.02);
        ctx.lineTo(d.x, d.y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    if (this.flash > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,190,110,${(0.16 * this.flash).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
      const { x, y } = this.lastShot;
      const r = 70 * this.scale;
      const muzzle = ctx.createRadialGradient(x, y, 0, x, y, r);
      muzzle.addColorStop(0, `rgba(255,240,180,${(0.9 * this.flash).toFixed(3)})`);
      muzzle.addColorStop(1, 'rgba(255,120,20,0)');
      ctx.fillStyle = muzzle;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose() {
    void this.audio?.close();
    this.audio = null;
  }

  private tic() {
    const { fire } = this;
    fire.setSource(() => MAX_HEAT * this.ignition);
    const rows = this.flameHeight() / this.cell;
    fire.step(clamp(MAX_HEAT / rows, 0.15, 1), this.wind);

    // The pointer parts the flames.
    const p = this.pointer;
    if (p) {
      const gy = (p.y - this.fireTop()) / this.cell;
      if (gy > 0) fire.cool(p.x / this.cell + 1, gy, (45 * this.scale) / this.cell, 0.55);
    }
  }

  private fireTop() {
    return this.height - this.fire.height * this.cell;
  }

  /** Typical flame height in px; grows when the fire is fed or shot. */
  private flameHeight() {
    return Math.min(this.height * 0.3 * (1 + 0.4 * this.boost), this.fire.height * this.cell * 0.7);
  }

  /** A synthesized gunshot: a filtered noise crack over a low thump. */
  private bang() {
    try {
      this.audio ??= new AudioContext();
      const ac = this.audio;
      const now = ac.currentTime;
      if (!this.noise) {
        const length = Math.floor(ac.sampleRate * 0.4);
        this.noise = ac.createBuffer(1, length, ac.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
      }
      const crack = ac.createBufferSource();
      crack.buffer = this.noise;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3200, now);
      filter.frequency.exponentialRampToValueAtTime(300, now + 0.3);
      const crackGain = ac.createGain();
      crackGain.gain.setValueAtTime(0.32, now);
      crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      crack.connect(filter).connect(crackGain).connect(ac.destination);

      const thump = ac.createOscillator();
      thump.frequency.setValueAtTime(140, now);
      thump.frequency.exponentialRampToValueAtTime(40, now + 0.15);
      const thumpGain = ac.createGain();
      thumpGain.gain.setValueAtTime(0.4, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      thump.connect(thumpGain).connect(ac.destination);

      crack.start(now);
      thump.start(now);
      thump.stop(now + 0.2);
    } catch {
      // Audio is optional.
    }
  }
}

export const doomTheme: FireTheme = {
  id: 'doom',
  label: 'DOOM',
  palette: {
    titleFrom: '#ffe08a',
    titleTo: '#c2410c',
    titleGlow: 'rgba(255, 60, 10, 0.5)',
    ambient: '#2a0905',
  },
  letters: { knock: 'shoot', draggable: false, item: false },
  createRenderer: (host) => new DoomFire(host),
};
