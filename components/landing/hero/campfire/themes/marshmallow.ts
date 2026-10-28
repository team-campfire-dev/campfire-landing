import { noise1, noise2 } from '../noise';
import { blend, placed, ridge, seeded, shade } from '../illustration';
import type { FireTheme } from '../types';
import {
  IllustratedCampfire,
  framingPines,
  groundPath,
  ridgePines,
  type CampfireSetting,
  type CampfireView,
} from './classic';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Where the moon hangs and where the lake lies, shared by the static and animated layers. */
function layout({ width, height, scale: s, cy }: CampfireView) {
  const r = clamp(Math.min(width, height) * 0.05, 18, 40);
  return {
    moon: { x: width * 0.68, y: Math.max(r * 2.4, height * 0.17), r },
    lakeTop: height * 0.71,
    shore: cy - 46 * s,
  };
}

/**
 * A clear night by a mountain lake: full moon, its reflection shimmering on the water, a tent
 * and a log to sit on by the fire.
 */
const LAKESIDE: CampfireSetting = {
  paint(ctx, view) {
    const { width, height, scale: s } = view;
    const { moon, lakeTop, shore } = layout(view);
    const rand = seeded(21);

    const sky = ctx.createLinearGradient(0, 0, 0, lakeTop);
    sky.addColorStop(0, '#070b1c');
    sky.addColorStop(0.55, '#0f1631');
    sky.addColorStop(1, '#1d2747');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#e9eefc';
    for (let i = 0; i < 160; i++) {
      ctx.globalAlpha = 0.12 + rand() * 0.5;
      const size = rand() < 0.08 ? 1.7 : 1;
      ctx.fillRect(rand() * width, rand() ** 1.3 * lakeTop * 0.85, size, size);
    }
    ctx.globalAlpha = 1;

    // Moon with soft rings of light around it.
    for (const [k, a] of [[2.6, 0.03], [1.9, 0.045], [1.4, 0.07]]) {
      ctx.fillStyle = `rgba(240, 230, 205, ${a})`;
      ctx.beginPath();
      ctx.arc(moon.x, moon.y, moon.r * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f3e8cc';
    ctx.beginPath();
    ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e2d4b2';
    for (const [dx, dy, k] of [[-0.3, -0.2, 0.28], [0.25, 0.15, 0.2], [-0.05, 0.4, 0.14]]) {
      ctx.beginPath();
      ctx.arc(moon.x + dx * moon.r, moon.y + dy * moon.r, moon.r * k, 0, Math.PI * 2);
      ctx.fill();
    }

    const far = { base: lakeTop, amp: height * 0.16, freq: 0.0035, seed: 5 };
    ctx.fillStyle = '#1b2443';
    ctx.fill(ridge(width, far.base, far.amp, far.freq, far.seed, height));
    const mid = { base: lakeTop + 2, amp: height * 0.06, freq: 0.007, seed: 17 };
    const midPath = ridge(width, mid.base, mid.amp, mid.freq, mid.seed, lakeTop + 4);
    ridgePines(midPath, width, mid.base, mid.amp, mid.freq, mid.seed, 22 * s, rand);
    ctx.fillStyle = '#131a33';
    ctx.fill(midPath);

    // Still water, a shade lighter than the hills it mirrors.
    ctx.fillStyle = '#111a34';
    ctx.fillRect(0, lakeTop, width, shore - lakeTop + 10);
    ctx.fillStyle = 'rgba(70, 90, 140, 0.18)';
    for (let i = 0; i < 14; i++) {
      const y = lakeTop + 6 + rand() * (shore - lakeTop - 10);
      const x = rand() * width;
      ctx.fillRect(x, y, 30 + rand() * 90, 1);
    }

    const near = new Path2D();
    framingPines(near, width, shore, height, rand);
    ctx.fillStyle = '#0d1122';
    ctx.fill(near);
    ctx.fillStyle = '#0f111d';
    ctx.fill(groundPath(width, shore, height));
  },

  animate(ctx, view) {
    const { width, time } = view;
    const { moon, lakeTop, shore } = layout(view);
    // The moon's reflection: short dashes that shimmer and break up.
    ctx.fillStyle = '#efe3c3';
    const rows = Math.floor((shore - lakeTop - 8) / 5);
    for (let i = 0; i < rows; i++) {
      const y = lakeTop + 4 + i * 5;
      const depth = i / rows;
      const w = moon.r * (1.4 - depth * 0.6) * (0.4 + 0.8 * noise2(i * 0.9, time * 1.2));
      const x = moon.x + (noise2(i * 1.7, time * 0.6) - 0.5) * moon.r * 0.8;
      ctx.globalAlpha = 0.45 * (1 - depth * 0.7);
      ctx.fillRect(x - w / 2, y, w, 1.6);
    }
    ctx.globalAlpha = 1;
    // A few stars twinkle.
    const rand = seeded(99);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 10; i++) {
      const x = rand() * width;
      const y = rand() ** 1.3 * lakeTop * 0.7;
      const a = noise1(time * 1.5 + i * 7);
      ctx.globalAlpha = clamp((a - 0.45) * 2, 0, 0.9);
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  },

  props(ctx, { width, scale: s, cx, cy, light }) {
    const warm = clamp(light, 0, 1.2);

    // Tent to the left, its right side lit by the fire. Sized to the screen as well as the scale,
    // so it still fits beside the fire on narrow screens.
    const tw = Math.min(160 * s, width * 0.22);
    const th = tw * 0.7;
    const tx = cx - Math.min(260 * s, width * 0.33);
    const ty = cy + 6 * s;
    if (tx - tw / 2 > 4) {
      const body = new Path2D();
      body.moveTo(tx - tw / 2, ty);
      body.lineTo(tx - tw * 0.04, ty - th);
      body.lineTo(tx + tw / 2, ty);
      body.closePath();
      shade(
        ctx,
        body,
        { base: '#34436a', shadow: '#202a45', light: blend('#45577f', '#ffa366', warm * 0.85) },
        { x: cx - tx, y: -40 * s },
        5 * s,
        14 * s,
      );
      // Door flap, open a little, glowing faintly inside.
      ctx.fillStyle = '#0c0d18';
      ctx.beginPath();
      ctx.moveTo(tx - tw * 0.04, ty - th * 0.82);
      ctx.lineTo(tx - tw * 0.16, ty);
      ctx.lineTo(tx + tw * 0.14, ty);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = blend('#26314f', '#d9895a', warm * 0.6);
      ctx.beginPath();
      ctx.moveTo(tx - tw * 0.04, ty - th * 0.82);
      ctx.lineTo(tx + tw * 0.14, ty);
      ctx.lineTo(tx + tw * 0.24, ty);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(150, 165, 200, 0.4)';
      ctx.lineWidth = Math.max(1, s);
      ctx.beginPath();
      ctx.moveTo(tx - tw * 0.04, ty - th);
      ctx.lineTo(tx - tw * 0.72, ty + 4 * s);
      ctx.moveTo(tx - tw * 0.04, ty - th);
      ctx.lineTo(tx + tw * 0.66, ty + 4 * s);
      ctx.stroke();
    }

    // A log to sit on, to the right.
    const length = Math.min(150 * s, width * 0.2);
    const lx = cx + Math.min(200 * s, width * 0.25);
    const r = Math.min(15 * s, length * 0.1);
    if (lx + length < width - 4) {
      const log = new Path2D();
      log.roundRect(0, -r, length, r * 2, r * 0.8);
      const shape = placed(log, lx, cy + 22 * s, -0.04);
      shade(
        ctx,
        shape,
        { base: '#3a2a25', shadow: '#1b1311', light: blend('#4b3a33', '#f39a55', warm) },
        { x: -1, y: -0.6 },
        3.5 * s,
        8 * s,
      );
      ctx.fillStyle = '#9c6a43';
      ctx.beginPath();
      ctx.ellipse(lx + length, cy + 22 * s - length * 0.04, r * 0.45, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

export const marshmallowTheme: FireTheme = {
  id: 'marshmallow',
  label: 'Marshmallow',
  palette: {
    titleFrom: '#fffaf2',
    titleTo: '#f4e3c8',
    titleGlow: 'rgba(255, 170, 90, 0.35)',
    ambient: '#141a2e',
  },
  letters: {
    knock: 'touch',
    draggable: true,
    item: false,
    // Toasts slowly beside the flames and quickly in them; a toasted marshmallow stays toasted.
    heat: { rate: 0.55, reach: 170, cool: 0 },
  },
  createRenderer: () => new IllustratedCampfire(LAKESIDE),
};
