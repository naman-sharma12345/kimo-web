import {
  Filter,
  GlProgram,
  GpuProgram,
  Matrix,
  Texture,
  UniformGroup,
} from 'pixi.js';
import type { FilterSystem, RenderSurface, Sprite } from 'pixi.js';
import type { ResolvedEffect } from './types';

export type RGB = readonly [number, number, number];
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export function scalar(
  p: ResolvedEffect['params'],
  key: string,
  fallback = 0,
): number {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
export const linearize = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export const encode = (v: number) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
/** CPU oracle for the declared preview formula, not server equivalence. */
export function gradeRGB(rgb: RGB, p: ResolvedEffect['params']): RGB {
  p = normalizeFilterParams('grade', p).params;
  const base = (v: number) =>
    (linearize(v) * 2 ** scalar(p, 'exposure') - 0.18) *
      scalar(p, 'contrast', 1) +
    0.18;
  const c: RGB = [base(rgb[0]), base(rgb[1]), base(rgb[2])];
  const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const temp = scalar(p, 'temperature', scalar(p, 'temp')) * 0.1,
    tint = scalar(p, 'tint') * 0.1;
  const channel = (v: number, name: string, offset: number) =>
    clamp01(
      encode(
        Math.max(
          0,
          l +
            (v - l) * scalar(p, 'saturation', 1) +
            offset +
            scalar(p, `lift${name}`, scalar(p, 'lift')),
        ) **
          (1 /
            Math.max(0.001, scalar(p, `gamma${name}`, scalar(p, 'gamma', 1)))) *
          scalar(p, `gain${name}`, scalar(p, 'gain', 1)),
      ),
    );
  return [
    channel(c[0], 'R', temp),
    channel(c[1], 'G', -tint),
    channel(c[2], 'B', -temp),
  ];
}
export function decodeRLE(
  width: number,
  height: number,
  counts: readonly number[],
): Uint8Array {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 16777216
  )
    throw new Error('invalid RLE dimensions');
  if (
    counts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    counts.reduce((a, b) => a + b, 0) !== width * height
  )
    throw new Error('invalid RLE runs');
  const data = new Uint8Array(width * height * 4);
  let offset = 0;
  counts.forEach((count, run) => {
    for (let i = 0; i < count; i++) {
      const a = (run % 2) * 255;
      data.set([a, a, a, a], offset++ * 4);
    }
  });
  return data;
}
export function lutAtlasUV(
  r: number,
  g: number,
  slice: number,
): readonly [number, number] {
  return [
    ((slice % 8) * 64 + clamp01(r) * 63 + 0.5) / 512,
    (Math.floor(slice / 8) * 64 + clamp01(g) * 63 + 0.5) / 512,
  ];
}
export function sampleLUT(rgb: RGB, texel: (x: number, y: number) => RGB): RGB {
  const v: RGB = [
    clamp01(rgb[0]) * 63,
    clamp01(rgb[1]) * 63,
    clamp01(rgb[2]) * 63,
  ];
  const lo: RGB = [Math.floor(v[0]), Math.floor(v[1]), Math.floor(v[2])];
  const f: RGB = [v[0] - lo[0], v[1] - lo[1], v[2] - lo[2]];
  const out: [number, number, number] = [0, 0, 0];
  for (let b = 0; b < 2; b++)
    for (let g = 0; g < 2; g++)
      for (let r = 0; r < 2; r++) {
        const z = Math.min(63, lo[2] + b),
          x = Math.min(63, lo[0] + r),
          y = Math.min(63, lo[1] + g);
        const c = texel((z % 8) * 64 + x, Math.floor(z / 8) * 64 + y);
        const w =
          (r ? f[0] : 1 - f[0]) * (g ? f[1] : 1 - f[1]) * (b ? f[2] : 1 - f[2]);
        out[0] += c[0] * w;
        out[1] += c[1] * w;
        out[2] += c[2] * w;
      }
  return out;
}
const vertexGL = `in vec2 aPosition; out vec2 vTextureCoord;
uniform vec4 uInputSize,uOutputFrame,uOutputTexture;
void main(){vec2 p=aPosition*uOutputFrame.zw+uOutputFrame.xy;gl_Position=vec4(p.x*2./uOutputTexture.x-1.,p.y*2.*uOutputTexture.z/uOutputTexture.y-uOutputTexture.z,0.,1.);vTextureCoord=aPosition*uOutputFrame.zw*uInputSize.zw;}`;
const headerGPU = `struct Globals {uInputSize:vec4f,uInputPixel:vec4f,uInputClamp:vec4f,uOutputFrame:vec4f,uGlobalFrame:vec4f,uOutputTexture:vec4f};
struct Params { p0:vec4f,p1:vec4f,p2:vec4f,p3:vec4f,p4:vec4f,p5:vec4f,p6:vec4f,p7:vec4f,uMap:mat3x3f };
@group(0) @binding(0) var<uniform> g:Globals;
@group(0) @binding(1) var uTexture:texture_2d<f32>;
@group(0) @binding(2) var uSampler:sampler;
@group(1) @binding(0) var<uniform> fx:Params;
@group(1) @binding(1) var uMask:texture_2d<f32>;
@group(1) @binding(2) var maskSampler:sampler;
@group(1) @binding(3) var uLut:texture_2d<f32>;
@group(1) @binding(4) var lutSampler:sampler;
struct Out {@builtin(position) position:vec4f,@location(0) uv:vec2f};
@vertex fn mainVertex(@location(0) a:vec2f)->Out {var p=a*g.uOutputFrame.zw+g.uOutputFrame.xy;p=vec2f(p.x*2./g.uOutputTexture.x-1.,p.y*2.*g.uOutputTexture.z/g.uOutputTexture.y-g.uOutputTexture.z);return Out(vec4f(p,0.,1.),a*g.uOutputFrame.zw*g.uInputSize.zw);}
fn read(uv:vec2f)->vec4f{return textureSample(uTexture,uSampler,clamp(uv,g.uInputClamp.xy,g.uInputClamp.zw));}
fn lut(c:vec3f,z:f32)->vec3f {let uv=(vec2f((z%8.)*64.,floor(z/8.)*64.)+c.xy*63.+vec2f(0.5))/512.;return textureSample(uLut,lutSampler,uv).rgb;}
`;
// A compact common shader body is translated only for explicit GLSL/WGSL syntax.
const body = `
V2 uv=UV;
V4 original=read(uv); V4 color=original; F alpha=original.a;
V3 c=original.rgb/max(original.a,0.000001);
V2 local=uv*INPUT.xy/FRAME.zw;
if(P5.z>0.){local=(MAP*V3(uv,1.)).xy;}
F mode=P0.x;
if(mode==1.) {
 c=mix(c/12.92,pow(max((c+V3(0.055))/1.055,V3(0.)),V3(2.4)),step(V3(0.04045),c));
 c=(c*exp2(P1.x)-V3(0.18))*P1.y+V3(0.18);
 c=mix(V3(dot(c,V3(0.2126,0.7152,0.0722))),c,P1.z)+V3(P1.w,-P2.w,-P1.w)*0.1;
 c=pow(max(c+P2.xyz,V3(0.)),V3(1.)/max(P3.xyz,V3(0.001)))*P4.xyz;
 c=mix(c*12.92,1.055*pow(max(c,V3(0.)),V3(1./2.4))-V3(0.055),step(V3(0.0031308),c));
} else if(mode==2.) {F d=length((local-V2(0.5))*2.);c*=1.-P1.x*smoothstep(P1.y,P1.z,d);
} else if(mode==3.) {F n=fract(sin(dot(floor(local*P7.xy),V2(12.9898,78.233))+P1.y)*43758.5453);c+=V3((n-0.5)*P1.x);
} else if(mode==4. || mode==8.) {
 V4 sum=V4(0.); F total=0.;
 for(int j=-4;j<=4;j++){for(int i=-4;i<=4;i++){
  V2 d=V2(F(i),F(j)); F w=exp(-dot(d,d)/8.);
  V2 delta=d*max(P1.x,0.)/4.*INPUT.zw;
  sum+=read(uv+delta)*w;total+=w;
 }}
 V3 blurred=(sum/total).rgb/max((sum/total).a,0.000001);
 if(mode==4.){c+=P1.z*(c-blurred);}else{c=blurred;alpha=(sum/total).a;}
} else if(mode==6.) {
 V4 sum=V4(0.); F total=0.;
 for(int i=-4;i<=4;i++){F x=F(i); F w=exp(-x*x/8.);sum+=read(uv+P1.xy*INPUT.zw*x/4.)*w;total+=w;}
 c=(sum/total).rgb/max((sum/total).a,0.000001);alpha=(sum/total).a;
} else if(mode==5.) {c=V3(dot(c,V3(0.2126,0.7152,0.0722)));
} else if(mode==7.) {V3 v=clamp(c,V3(0.),V3(1.));F z=v.b*63.;c=mix(lut(v,floor(z)),lut(v,min(63.,floor(z)+1.)),fract(z));}
color=V4(clamp(c,V3(0.),V3(1.))*alpha,alpha);
if(mode==0.){color=original;}
F m=1.;
if(P0.z>0.) {
 m=0.;F total=0.;
 for(int j=-2;j<=2;j++){for(int i=-2;i<=2;i++){V2 d=V2(F(i),F(j));F w=exp(-dot(d,d)/2.);V4 s=MASK(local+d*P5.xy);m+=dot(s,P6)*w;total+=w;}}
 m/=total;if(P0.w>0.){m=1.-m;}
}
if(P0.y==1.){color=mix(original,color,m);}else if(P0.y==2.){color=mix(original,color,1.-m);}else if(P0.y==3.){color*=m;}
RETURN color;`;
function shaderBody(gpu: boolean): string {
  let s = body
    .replaceAll('MAP', gpu ? 'fx.uMap' : 'uMap')
    .replaceAll('INPUT', gpu ? 'g.uInputSize' : 'uInputSize')
    .replaceAll('FRAME', gpu ? 'g.uOutputFrame' : 'uOutputFrame')
    .replaceAll('UV', gpu ? 'inputUV' : 'vTextureCoord');
  for (let i = 0; i < 8; i++)
    s = s.replaceAll(`P${i}`, gpu ? `fx.p${i}` : `p${i}`);
  if (gpu) {
    s = s
      .replace(/V([234]) (\w+)=/g, 'var $2:vec$1f=')
      .replace(/F (\w+)=/g, 'var $1:f32=');
    s = s
      .replaceAll('V2', 'vec2f')
      .replaceAll('V3', 'vec3f')
      .replaceAll('V4', 'vec4f')
      .replaceAll('F(', 'f32(');
    s = s.replace(
      /for\(int (\w+)=(-?\d+);(\w+)<=(-?\d+);\3\+\+\)/g,
      'for(var $1:i32=$2;$3<=$4;$3++)',
    );
    s = s
      .replaceAll('MASK(', 'textureSample(uMask,maskSampler,')
      .replace('RETURN color;', 'return color;');
  } else
    s = s
      .replaceAll('V2', 'vec2')
      .replaceAll('V3', 'vec3')
      .replaceAll('V4', 'vec4')
      .replace(/\bF\b/g, 'float')
      .replaceAll('MASK(', 'texture(uMask,')
      .replace('RETURN color;', 'finalColor=color;');
  return s;
}
export const filterShaderSources = {
  gl: `in vec2 vTextureCoord;out vec4 finalColor;uniform sampler2D uTexture,uMask,uLut;uniform vec4 uInputSize,uInputClamp,uOutputFrame,p0,p1,p2,p3,p4,p5,p6,p7;uniform mat3 uMap;
vec4 read(vec2 uv){return texture(uTexture,clamp(uv,uInputClamp.xy,uInputClamp.zw));}
vec3 lut(vec3 c,float z){return texture(uLut,(vec2(mod(z,8.)*64.,floor(z/8.)*64.)+c.xy*63.+vec2(0.5))/512.).rgb;}
void main(){${shaderBody(false)}}`,
  gpu: `${headerGPU}@fragment fn mainFragment(@location(0) inputUV:vec2f)->@location(0) vec4f {${shaderBody(true)}}`,
};
export type FilterMode =
  | 'grade'
  | 'vignette'
  | 'grain'
  | 'sharpen'
  | 'bw'
  | 'whip'
  | 'lut'
  | 'blur'
  | 'mask';
const gradeRanges: Readonly<Record<string, readonly [number, number]>> = {
  exposure: [-16, 16],
  contrast: [0, 8],
  saturation: [0, 8],
  temperature: [-1, 1],
  temp: [-1, 1],
  tint: [-1, 1],
  lift: [-1, 1],
  gamma: [0.001, 16],
  gain: [0, 16],
  ...Object.fromEntries(
    ['R', 'G', 'B'].flatMap((c) => [
      [`lift${c}`, [-1, 1] as const],
      [`gamma${c}`, [0.001, 16] as const],
      [`gain${c}`, [0, 16] as const],
    ]),
  ),
};
const controlRanges: Readonly<
  Record<FilterMode, Readonly<Record<string, readonly [number, number]>>>
> = {
  grade: gradeRanges,
  vignette: { strength: [0, 1], inner: [0, 2], outer: [0, 2] },
  grain: { amount: [0, 1], seed: [-16777216, 16777216] },
  sharpen: { amount: [0, 8], radius: [0, 256] },
  bw: {},
  whip: { x: [-256, 256], y: [-256, 256], radius: [0, 256] },
  lut: {},
  blur: { radius: [0, 256], strength: [0, 256], x: [0, 256], y: [0, 256] },
  mask: {},
};
export function normalizeFilterParams(
  mode: FilterMode,
  input: ResolvedEffect['params'],
): { params: ResolvedEffect['params']; issues: string[] } {
  const params: ResolvedEffect['params'] = {},
    issues: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (
      (key === 'lutAssetId' || key === 'assetId') &&
      (mode === 'grade' || mode === 'lut')
    ) {
      if (typeof value === 'string') params[key] = value;
      else issues.push(`invalid ${key}; LUT omitted`);
      continue;
    }
    const range = controlRanges[mode][key];
    if (!range) {
      issues.push(`unrecognized ${mode} parameter ${key}; ignored`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push(`invalid ${mode} parameter ${key}; default used`);
      continue;
    }
    params[key] = Math.max(range[0], Math.min(range[1], value));
    if (params[key] !== value)
      issues.push(
        `${mode} parameter ${key} clamped to [${range[0]},${range[1]}]`,
      );
  }
  if (
    mode === 'vignette' &&
    scalar(params, 'outer', 1) <= scalar(params, 'inner', 0.4)
  ) {
    params.outer = scalar(params, 'inner', 0.4) + 0.000001;
    issues.push('vignette outer adjusted above inner');
  }
  return { params, issues };
}
const modes: Record<FilterMode, number> = {
  grade: 1,
  vignette: 2,
  grain: 3,
  sharpen: 4,
  bw: 5,
  whip: 6,
  lut: 7,
  blur: 8,
  mask: 0,
};
type Slots = [
  Float32Array,
  Float32Array,
  Float32Array,
  Float32Array,
  Float32Array,
  Float32Array,
  Float32Array,
  Float32Array,
];
function vectorSlots(): Slots {
  return [
    new Float32Array(4),
    new Float32Array(4),
    new Float32Array(4),
    new Float32Array(4),
    new Float32Array(4),
    new Float32Array(4),
    new Float32Array(4),
    new Float32Array(4),
  ];
}
export class LiveFilter extends Filter {
  readonly values: Slots;
  private readonly uniforms: UniformGroup;
  private readonly mapping = new Matrix();
  private sprite?: Sprite;
  setMapping(sprite?: Sprite): void {
    this.sprite = sprite;
    this.values[5][2] = sprite ? 1 : 0;
    this.values[7].set([
      sprite?.texture.orig.width ?? 1920,
      sprite?.texture.orig.height ?? 1080,
      0,
      0,
    ]);
    this.uniforms.update();
  }
  override apply(
    manager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clear: boolean,
  ): void {
    if (this.sprite) {
      manager.calculateSpriteMatrix(this.mapping, this.sprite);
      this.uniforms.update();
    }
    manager.applyFilter(this, input, output, clear);
  }
  constructor() {
    const values = vectorSlots();
    const mapping = new Matrix();
    const uniforms = new UniformGroup({
      ...Object.fromEntries(
        values.map((value, i) => [
          `p${i}`,
          { value, type: 'vec4<f32>' as const },
        ]),
      ),
      uMap: { value: mapping, type: 'mat3x3<f32>' },
    });
    super({
      glProgram: GlProgram.from({
        vertex: vertexGL,
        fragment: filterShaderSources.gl,
        name: 'kimo-live',
      }),
      gpuProgram: GpuProgram.from({
        vertex: { source: filterShaderSources.gpu, entryPoint: 'mainVertex' },
        fragment: {
          source: filterShaderSources.gpu,
          entryPoint: 'mainFragment',
        },
      }),
      resources: {
        fx: uniforms,
        uMask: Texture.WHITE.source,
        maskSampler: Texture.WHITE.source.style,
        uLut: Texture.WHITE.source,
        lutSampler: Texture.WHITE.source.style,
      },
    });
    this.values = values;
    this.uniforms = uniforms;
    this.mapping = mapping;
  }
  configure(
    mode: FilterMode,
    p: ResolvedEffect['params'],
    frame: number,
    scope: ResolvedEffect['scope'] = 'all',
    mask?: Texture,
    lut?: Texture,
    invert = false,
    feather = 0,
    channel: 'alpha' | 'luma' | 'red' = 'red',
    pixelsPerProjectUnit = 1,
  ): string[] {
    const normalized = normalizeFilterParams(mode, p);
    p = normalized.params;
    const v = this.values;
    v.forEach((x) => x.fill(0));
    v[0].set([
      modes[mode],
      mode === 'mask'
        ? 3
        : scope === 'inside_mask'
          ? 1
          : scope === 'outside_mask'
            ? 2
            : 0,
      mask ? 1 : 0,
      invert ? 1 : 0,
    ]);
    v[1].set([
      scalar(p, 'exposure'),
      scalar(p, 'contrast', 1),
      scalar(p, 'saturation', 1),
      scalar(p, 'temperature', scalar(p, 'temp')),
    ]);
    v[2].set([
      scalar(p, 'liftR', scalar(p, 'lift')),
      scalar(p, 'liftG', scalar(p, 'lift')),
      scalar(p, 'liftB', scalar(p, 'lift')),
      scalar(p, 'tint'),
    ]);
    v[3].set(
      ['R', 'G', 'B'].map((x) => scalar(p, `gamma${x}`, scalar(p, 'gamma', 1))),
    );
    v[4].set(
      ['R', 'G', 'B'].map((x) => scalar(p, `gain${x}`, scalar(p, 'gain', 1))),
    );
    if (mode === 'vignette')
      v[1].set([
        scalar(p, 'strength', 0.5),
        scalar(p, 'inner', 0.4),
        scalar(p, 'outer', 1),
        0,
      ]);
    if (mode === 'grain')
      v[1].set([scalar(p, 'amount', 0.1), frame + scalar(p, 'seed'), 0, 0]);
    if (mode === 'sharpen')
      v[1].set([scalar(p, 'radius', 1), 0, scalar(p, 'amount', 1), 0]);
    if (mode === 'whip' || mode === 'blur')
      v[1].set([scalar(p, 'x', scalar(p, 'radius', 8)), scalar(p, 'y'), 0, 0]);
    if (mode === 'blur' || mode === 'sharpen' || mode === 'whip') {
      v[1][0] = (v[1][0] ?? 0) * pixelsPerProjectUnit;
      v[1][1] = (v[1][1] ?? 0) * pixelsPerProjectUnit;
    }
    v[5].set([
      feather / Math.max(1, mask?.width ?? 1),
      feather / Math.max(1, mask?.height ?? 1),
      0,
      0,
    ]);
    v[6].set(
      channel === 'alpha'
        ? [0, 0, 0, 1]
        : channel === 'luma'
          ? [0.2126, 0.7152, 0.0722, 0]
          : [1, 0, 0, 0],
    );
    this.resources.uMask = (mask ?? Texture.WHITE).source;
    this.resources.maskSampler = (mask ?? Texture.WHITE).source.style;
    this.resources.uLut = (lut ?? Texture.WHITE).source;
    this.resources.lutSampler = (lut ?? Texture.WHITE).source.style;
    this.uniforms.update();
    return normalized.issues;
  }
}

export type RGBA = readonly [number, number, number, number];
/** Inputs and output are premultiplied; the result is composited once, not stacked. */
export function mixPremultiplied(
  a: RGBA,
  b: RGBA,
  outgoingWeight: number,
  incomingWeight: number,
  blackWeight = 0,
): RGBA {
  return [
    a[0] * outgoingWeight + b[0] * incomingWeight,
    a[1] * outgoingWeight + b[1] * incomingWeight,
    a[2] * outgoingWeight + b[2] * incomingWeight,
    a[3] * outgoingWeight + b[3] * incomingWeight + blackWeight,
  ];
}
export function gaussianWeights(): readonly number[] {
  const raw = Array.from({ length: 9 }, (_, i) =>
    Math.exp(-((i - 4) ** 2) / 8),
  );
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / sum);
}
export function vignetteFactor(
  u: number,
  v: number,
  strength = 0.5,
  inner = 0.4,
  outer = 1,
): number {
  const r = Math.hypot((u - 0.5) * 2, (v - 0.5) * 2),
    t = clamp01((r - inner) / Math.max(0.000001, outer - inner));
  return 1 - strength * t * t * (3 - 2 * t);
}
export function grainValue(
  x: number,
  y: number,
  frame: number,
  seed = 0,
  amount = 0.1,
): number {
  const hash =
    Math.sin(Math.floor(x) * 12.9898 + Math.floor(y) * 78.233 + frame + seed) *
    43758.5453;
  return (hash - Math.floor(hash) - 0.5) * amount;
}
export function compositeMasked(
  original: RGBA,
  effected: RGBA,
  mask: number,
  scope: 'inside_mask' | 'outside_mask',
  invert = false,
): RGBA {
  const coverage = invert ? 1 - clamp01(mask) : clamp01(mask),
    m = scope === 'inside_mask' ? coverage : 1 - coverage;
  return [
    original[0] * (1 - m) + effected[0] * m,
    original[1] * (1 - m) + effected[1] * m,
    original[2] * (1 - m) + effected[2] * m,
    original[3] * (1 - m) + effected[3] * m,
  ];
}
