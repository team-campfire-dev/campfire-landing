import { noise1 } from '../noise';
import { blend, glow, placed, shade } from '../illustration';
import type { FireFrame, FireHost, FireRenderer, FireTap, FireTheme, HotZone } from '../types';
import { classicTheme, fadeToPage } from './classic';

// Fire and smoke from a real fluid simulation (Jos Stam's "stable fluids") running on the GPU:
// heat is injected at the base of the fire, rises by buoyancy, cools into smoke, and the
// pointer stirs the flow. Rendered with WebGL2 into an offscreen canvas and drawn onto the 2D
// hero canvas.

const PRESSURE_ITERATIONS = 20;
/** Vorticity confinement strength: puts back the small swirls the grid smooths away. */
const CURL = 34;
/** How fast heat lifts the fluid, and how hard smoke drags it back down. */
const LIFT = 110;
const WEIGHT = 30;
/** Heat lost per second; what's lost turns into smoke. */
const COOLING = 3.8;
const SMOKE_YIELD = 0.55;
const SMOKE_FADE = 0.5;
const VELOCITY_FADE = 0.25;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

const VERTEX = `#version 300 es
precision highp float;
in vec2 aPosition;
uniform vec2 texelSize;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 outColor;
`;

const SHADERS = {
  splat: `${HEADER}
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
void main() {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  outColor = vec4(texture(uTarget, vUv).xyz + splat, 1.0);
}`,
  advectVelocity: `${HEADER}
uniform sampler2D uVelocity;
uniform vec2 velocityTexel;
uniform float dt;
uniform float dissipation;
void main() {
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * velocityTexel;
  outColor = texture(uVelocity, coord) / (1.0 + dissipation * dt);
}`,
  // Heat (r) and smoke (g): heat cools as it's carried along, and the heat lost becomes smoke.
  advectDye: `${HEADER}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 velocityTexel;
uniform float dt;
uniform float cooling;
uniform float smokeYield;
uniform float smokeFade;
void main() {
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * velocityTexel;
  vec4 s = texture(uSource, coord);
  float heat = s.r * exp(-cooling * dt);
  float smoke = s.g * exp(-smokeFade * dt) + (s.r - heat) * smokeYield;
  outColor = vec4(heat, smoke, 0.0, 1.0);
}`,
  buoyancy: `${HEADER}
uniform sampler2D uVelocity;
uniform sampler2D uDye;
uniform float dt;
uniform float lift;
uniform float weight;
void main() {
  vec2 v = texture(uVelocity, vUv).xy;
  vec4 d = texture(uDye, vUv);
  v.y += (d.r * lift - d.g * weight) * dt;
  outColor = vec4(v, 0.0, 1.0);
}`,
  curl: `${HEADER}
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  outColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`,
  vorticity: `${HEADER}
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
void main() {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  outColor = vec4(texture(uVelocity, vUv).xy + force * dt, 0.0, 1.0);
}`,
  divergence: `${HEADER}
uniform sampler2D uVelocity;
void main() {
  vec2 C = texture(uVelocity, vUv).xy;
  float L = vL.x < 0.0 ? -C.x : texture(uVelocity, vL).x;
  float R = vR.x > 1.0 ? -C.x : texture(uVelocity, vR).x;
  float T = vT.y > 1.0 ? -C.y : texture(uVelocity, vT).y;
  float B = vB.y < 0.0 ? -C.y : texture(uVelocity, vB).y;
  outColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`,
  pressure: `${HEADER}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main() {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float div = texture(uDivergence, vUv).x;
  outColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`,
  gradient: `${HEADER}
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main() {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 v = texture(uVelocity, vUv).xy - vec2(R - L, T - B);
  outColor = vec4(v, 0.0, 1.0);
}`,
  fade: `${HEADER}
uniform sampler2D uTexture;
uniform float value;
void main() {
  outColor = value * texture(uTexture, vUv);
}`,
  // Heat through a black-body ramp, smoke as a soft grey, composited premultiplied.
  display: `${HEADER}
uniform sampler2D uDye;
void main() {
  vec4 d = texture(uDye, vUv);
  float t = d.r;
  vec3 fire = mix(vec3(0.0), vec3(0.62, 0.08, 0.02), smoothstep(0.0, 0.25, t));
  fire = mix(fire, vec3(1.0, 0.42, 0.06), smoothstep(0.2, 0.6, t));
  fire = mix(fire, vec3(1.0, 0.8, 0.32), smoothstep(0.55, 1.1, t));
  fire = mix(fire, vec3(1.0, 0.97, 0.85), smoothstep(1.0, 1.9, t));
  float fireA = smoothstep(0.08, 0.7, t);
  float smokeA = clamp(d.g * 0.55, 0.0, 0.7);
  vec3 smoke = vec3(0.3, 0.28, 0.33);
  vec3 col = fire * fireA + smoke * smokeA * (1.0 - fireA);
  outColor = vec4(col, fireA + smokeA * (1.0 - fireA));
}`,
};

type ProgramName = keyof typeof SHADERS;

interface Target {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

/** Two targets to read from one and write to the other, then swap. */
interface DoubleTarget {
  read: Target;
  write: Target;
  width: number;
  height: number;
  swap(): void;
}

interface Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

/** WebGL2 with renderable half-float textures — everything the simulation needs. */
export function supportsFluid() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const ok = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

/** The GPU side: framebuffers, shader programs and one simulation step. */
class FluidSim {
  readonly canvas = document.createElement('canvas');
  private readonly gl: WebGL2RenderingContext;
  private readonly programs = {} as Record<ProgramName, Program>;
  private velocity!: DoubleTarget;
  private dye!: DoubleTarget;
  private pressure!: DoubleTarget;
  private divergence!: Target;
  private curl!: Target;
  private aspect = 1;

  constructor() {
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    gl.getExtension('EXT_color_buffer_float') ?? gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');

    const vertex = this.compile(gl.VERTEX_SHADER, VERTEX);
    for (const name of Object.keys(SHADERS) as ProgramName[]) {
      const program = gl.createProgram()!;
      gl.attachShader(program, vertex);
      gl.attachShader(program, this.compile(gl.FRAGMENT_SHADER, SHADERS[name]));
      gl.bindAttribLocation(program, 0, 'aPosition');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
      const uniforms: Program['uniforms'] = {};
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
      for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(program, i);
        if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
      }
      this.programs[name] = { program, uniforms };
    }

    // One full-screen quad, drawn for every pass.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
  }

  /** (Re)allocates the grids: `sim` cells on the short side for velocity, `dye` for heat and smoke. */
  allocate(aspect: number, sim: number, dye: number) {
    this.aspect = aspect;
    const size = (n: number): [number, number] => (aspect >= 1 ? [Math.round(n * aspect), n] : [n, Math.round(n / aspect)]);
    const [sw, sh] = size(sim);
    const [dw, dh] = size(dye);
    this.velocity = this.double(sw, sh);
    this.pressure = this.double(sw, sh);
    this.divergence = this.target(sw, sh);
    this.curl = this.target(sw, sh);
    this.dye = this.double(dw, dh);
    this.canvas.width = dw;
    this.canvas.height = dh;
  }

  /** Adds a gaussian blob of heat/smoke to the dye and of velocity to the flow. `x`, `y` in 0..1, y up. */
  splat(x: number, y: number, radius: number, heat: number, smoke: number, vx: number, vy: number) {
    const p = this.use('splat');
    const { gl } = this;
    gl.uniform1f(p.uniforms.aspectRatio, this.aspect);
    gl.uniform2f(p.uniforms.point, x, y);
    gl.uniform1f(p.uniforms.radius, radius);
    if (vx || vy) {
      gl.uniform1i(p.uniforms.uTarget, this.bind(this.velocity.read, 0));
      gl.uniform3f(p.uniforms.color, vx, vy, 0);
      this.blit(this.velocity.write);
      this.velocity.swap();
    }
    if (heat || smoke) {
      gl.uniform1i(p.uniforms.uTarget, this.bind(this.dye.read, 0));
      gl.uniform3f(p.uniforms.color, heat, smoke, 0);
      this.blit(this.dye.write);
      this.dye.swap();
    }
  }

  step(dt: number) {
    const { gl } = this;
    const vt = [1 / this.velocity.width, 1 / this.velocity.height] as const;
    gl.disable(gl.BLEND);

    let p = this.use('buoyancy', vt);
    gl.uniform1i(p.uniforms.uVelocity, this.bind(this.velocity.read, 0));
    gl.uniform1i(p.uniforms.uDye, this.bind(this.dye.read, 1));
    gl.uniform1f(p.uniforms.dt, dt);
    gl.uniform1f(p.uniforms.lift, LIFT);
    gl.uniform1f(p.uniforms.weight, WEIGHT);
    this.blit(this.velocity.write);
    this.velocity.swap();

    p = this.use('curl', vt);
    gl.uniform1i(p.uniforms.uVelocity, this.bind(this.velocity.read, 0));
    this.blit(this.curl);

    p = this.use('vorticity', vt);
    gl.uniform1i(p.uniforms.uVelocity, this.bind(this.velocity.read, 0));
    gl.uniform1i(p.uniforms.uCurl, this.bind(this.curl, 1));
    gl.uniform1f(p.uniforms.curl, CURL);
    gl.uniform1f(p.uniforms.dt, dt);
    this.blit(this.velocity.write);
    this.velocity.swap();

    p = this.use('divergence', vt);
    gl.uniform1i(p.uniforms.uVelocity, this.bind(this.velocity.read, 0));
    this.blit(this.divergence);

    p = this.use('fade', vt);
    gl.uniform1i(p.uniforms.uTexture, this.bind(this.pressure.read, 0));
    gl.uniform1f(p.uniforms.value, 0.8);
    this.blit(this.pressure.write);
    this.pressure.swap();

    p = this.use('pressure', vt);
    gl.uniform1i(p.uniforms.uDivergence, this.bind(this.divergence, 1));
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(p.uniforms.uPressure, this.bind(this.pressure.read, 0));
      this.blit(this.pressure.write);
      this.pressure.swap();
    }

    p = this.use('gradient', vt);
    gl.uniform1i(p.uniforms.uPressure, this.bind(this.pressure.read, 0));
    gl.uniform1i(p.uniforms.uVelocity, this.bind(this.velocity.read, 1));
    this.blit(this.velocity.write);
    this.velocity.swap();

    p = this.use('advectVelocity', vt);
    gl.uniform1i(p.uniforms.uVelocity, this.bind(this.velocity.read, 0));
    gl.uniform2f(p.uniforms.velocityTexel, vt[0], vt[1]);
    gl.uniform1f(p.uniforms.dt, dt);
    gl.uniform1f(p.uniforms.dissipation, VELOCITY_FADE);
    this.blit(this.velocity.write);
    this.velocity.swap();

    p = this.use('advectDye', [1 / this.dye.width, 1 / this.dye.height]);
    gl.uniform1i(p.uniforms.uVelocity, this.bind(this.velocity.read, 0));
    gl.uniform1i(p.uniforms.uSource, this.bind(this.dye.read, 1));
    gl.uniform2f(p.uniforms.velocityTexel, vt[0], vt[1]);
    gl.uniform1f(p.uniforms.dt, dt);
    gl.uniform1f(p.uniforms.cooling, COOLING);
    gl.uniform1f(p.uniforms.smokeYield, SMOKE_YIELD);
    gl.uniform1f(p.uniforms.smokeFade, SMOKE_FADE);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  /** Renders heat and smoke to the canvas, transparent where there's neither. */
  render() {
    const { gl } = this;
    const p = this.use('display', [1 / this.dye.width, 1 / this.dye.height]);
    gl.uniform1i(p.uniforms.uDye, this.bind(this.dye.read, 0));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  /** Velocity grid cells across, for converting pointer speeds into grid units. */
  get gridWidth() {
    return this.velocity.width;
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private compile(type: number, source: string) {
    const { gl } = this;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'compile failed');
    return shader;
  }

  private use(name: ProgramName, texel: readonly [number, number] = [1 / this.velocity.width, 1 / this.velocity.height]) {
    const p = this.programs[name];
    this.gl.useProgram(p.program);
    if (p.uniforms.texelSize) this.gl.uniform2f(p.uniforms.texelSize, texel[0], texel[1]);
    return p;
  }

  private bind(target: Target, unit: number) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    return unit;
  }

  private blit(target: Target) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  private target(width: number, height: number): Target {
    const { gl } = this;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, fbo, width, height };
  }

  private double(width: number, height: number): DoubleTarget {
    const pair = {
      read: this.target(width, height),
      write: this.target(width, height),
      width,
      height,
      swap() {
        [pair.read, pair.write] = [pair.write, pair.read];
      },
    };
    return pair;
  }
}

/**
 * A campfire whose flames and smoke are a live fluid: heat pours up from the logs, curls and
 * cools into smoke, and swirls wherever the pointer stirs it.
 */
class FluidCampfire implements FireRenderer {
  private readonly sim = new FluidSim();
  private width = 0;
  private height = 0;
  private scale = 1;
  private cx = 0;
  private cy = 0;
  private time = 0;
  private ignition = 0;
  private boost = 0;
  /** Size the grids were built for; small changes (a mobile toolbar sliding) just stretch them. */
  private built = { width: 0, height: 0 };

  constructor(private readonly host: FireHost) {}

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    this.cx = width / 2;
    this.cy = height - 70 * this.scale;
    const changed = Math.abs(width - this.built.width) > 40 || Math.abs(height - this.built.height) / Math.max(1, this.built.height) > 0.25;
    if (!changed) return;
    this.built = { width, height };
    const small = Math.min(width, height) < 500;
    this.sim.allocate(width / Math.max(1, height), small ? 96 : 128, small ? 256 : 384);
  }

  hotZone(): HotZone {
    const s = this.scale;
    const top = this.cy - (170 + 60 * Math.min(this.boost, 2)) * s;
    return { x: this.cx - 100 * s, y: top, width: 200 * s, height: this.height - top };
  }

  tap({ x, onFire, onLetter }: FireTap) {
    if (!onFire || onLetter) return;
    this.boost = Math.min(this.boost + 0.5, 2);
    const s = this.scale;
    for (let i = 0; i < 5; i++) {
      this.heat(clamp(x, this.cx - 60 * s, this.cx + 60 * s) + rand(-20, 20) * s, this.cy - rand(10, 40) * s, 0.0012, 2.5, 260);
    }
    this.host.shake(1.5);
  }

  feed(x: number, y: number, fuel: number) {
    this.boost = Math.min(this.boost + 0.8 * fuel, 2);
    for (let i = 0; i < 6; i++) this.heat(x + rand(-15, 15), y + rand(-10, 10), 0.0015, 3 * fuel, 200);
  }

  update({ time, dt, pointer }: FireFrame) {
    this.time = time;
    this.ignition = Math.min(1, this.ignition + dt / 1.5);
    this.boost *= Math.exp(-0.5 * dt);
    const s = this.scale;
    const step = Math.min(dt, 1 / 30);

    // Fuel: heat and a little updraft along the base of the fire, flickering.
    const strength = this.ignition * (1 + 0.6 * this.boost);
    for (let i = 0; i < 7; i++) {
      const k = (i + Math.random()) / 7 - 0.5;
      const x = this.cx + k * 120 * s * (1 + 0.2 * this.boost);
      const flicker = 0.6 + 0.8 * noise1(time * 3 + i * 17);
      const heat = (1 - Math.abs(k) * 1.4) * flicker * strength * 13 * step;
      if (heat > 0) this.heat(x, this.cy - rand(0, 18) * s, 0.0011, heat, 40);
    }

    // The pointer stirs the flow: its speed, in grid cells per second, pushed into the fluid.
    if (pointer && (pointer.vx || pointer.vy)) {
      const { x, y } = this.uv(pointer.x, pointer.y);
      const k = (this.sim.gridWidth / Math.max(1, this.width)) * 0.6;
      this.sim.splat(x, y, 0.0018, 0, 0, pointer.vx * k, -pointer.vy * k);
    }

    this.sim.step(step);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { width, height, cx, cy } = this;
    const s = this.scale;
    const light = this.ignition * (0.85 + 0.15 * noise1(this.time * 5)) * (1 + 0.3 * this.boost);

    // Night behind the fire.
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#0a0a12');
    sky.addColorStop(0.7, '#17111c');
    sky.addColorStop(1, '#1d1418');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    glow(ctx, cx, cy - 60 * s, 480 * s, [255, 110, 40], 0.22 * light);
    ctx.fillStyle = '#100c12';
    ctx.fillRect(0, cy - 30 * s, width, height);

    this.drawLogs(ctx, light, true);

    this.sim.render();
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.sim.canvas, 0, 0, width, height);
    // A second, additive pass so the hottest parts bloom.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35;
    ctx.drawImage(this.sim.canvas, 0, 0, width, height);
    ctx.restore();

    this.drawLogs(ctx, light, false);
    fadeToPage(ctx, width, height);
  }

  dispose() {
    this.sim.dispose();
  }

  /** Canvas px to simulation coordinates (0..1, y up). */
  private uv(x: number, y: number) {
    return { x: x / Math.max(1, this.width), y: 1 - y / Math.max(1, this.height) };
  }

  private heat(x: number, y: number, radius: number, amount: number, lift: number) {
    const p = this.uv(x, y);
    this.sim.splat(p.x, p.y, radius, amount, 0, rand(-0.2, 0.2) * lift, lift);
  }

  /** Crossed logs on a ring of stones; the back log behind the fire, the front one over it. */
  private drawLogs(ctx: CanvasRenderingContext2D, light: number, back: boolean) {
    const s = this.scale;
    const { cx, cy } = this;
    const warm = clamp(light, 0, 1.2);
    const logs: [number, number, number, number][] = back
      ? [[-120, 20, 90, -14]]
      : [[120, 20, -90, -14]];
    for (const [x1, y1, x2, y2] of logs) {
      const r = 14 * s;
      const ax = cx + x1 * s;
      const ay = cy + y1 * s;
      const length = Math.hypot((x2 - x1) * s, (y2 - y1) * s);
      const body = new Path2D();
      body.roundRect(0, -r, length, r * 2, r * 0.7);
      const shape = placed(body, ax, ay, Math.atan2((y2 - y1) * s, (x2 - x1) * s));
      shade(
        ctx,
        shape,
        { base: '#3a2820', shadow: '#1d140f', light: blend('#4f3a2c', '#f39a55', warm) },
        { x: cx - ax, y: -80 * s },
        3.5 * s,
        7 * s,
      );
    }
    if (back) return;
    for (let i = -3; i <= 3; i++) {
      const stone = new Path2D();
      stone.ellipse(0, 0, 24 * s, 14 * s, i * 0.1, 0, Math.PI * 2);
      const x = cx + i * 46 * s;
      const y = cy + (34 - Math.abs(i) * 4) * s;
      shade(
        ctx,
        placed(stone, x, y),
        { base: '#2b2633', shadow: '#16131c', light: blend('#3e3749', '#ef8c50', warm * (1 - Math.abs(i) / 5)) },
        { x: cx - x, y: -70 * s },
        4 * s,
        6 * s,
      );
    }
  }
}

export const fluidTheme: FireTheme = {
  id: 'fluid',
  label: 'Fluid',
  palette: {
    titleFrom: '#ffd28a',
    titleTo: '#ff6a1a',
    titleGlow: 'rgba(255, 110, 30, 0.45)',
    ambient: '#1a1016',
  },
  letters: { knock: 'touch', draggable: true, item: false },
  createRenderer: (host) => {
    if (supportsFluid()) {
      try {
        return new FluidCampfire(host);
      } catch {
        // Fall through to the classic fire if the GPU setup fails.
      }
    }
    return classicTheme.createRenderer(host);
  },
};
