type ShaderOperator = {
  ratio: number;
  level: number;
  angle: number;
  wave: number;
  phase: number;
  space: number;
  radialBias: number;
  orientation: number;
  twist: number;
};

type ShaderFrame = {
  size: number;
  base: number;
  feedback: number;
  trueValues: boolean;
  motionPhase: number;
  operators: ShaderOperator[];
  inputMasks: number[];
  carrierMask: number;
  carrierLevel: number;
  palette: number[];
};

const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

out vec4 fragmentColor;

uniform vec2 uResolution;
uniform float uBase;
uniform float uFeedback;
uniform float uMotionPhase;
uniform float uCarrierLevel;
uniform int uTrueValues;
uniform int uCarrierMask;
uniform int uInputMasks[4];
uniform float uRatios[4];
uniform float uLevels[4];
uniform float uAngles[4];
uniform float uPhases[4];
uniform float uRadialExponents[4];
uniform float uOrientations[4];
uniform float uTwists[4];
uniform int uWaves[4];
uniform int uSpaces[4];
uniform vec3 uPalette[5];

const float PI = 3.14159265358979323846;
const float TAU = PI * 2.0;
const float MAX_RADIUS = PI * 1.4142135623730951;

bool hasBit(int mask, int bit) {
  return (mask & (1 << bit)) != 0;
}

float wave(float phase, int shape) {
  float sine = sin(phase);
  switch (shape) {
    case 1: return max(0.0, sine) * 2.0 - 0.5;
    case 2: return abs(sine) * 2.0 - 1.0;
    case 3: return sine * abs(sine);
    case 4: return (sine + 0.5 * sin(2.0 * phase)) / 1.5;
    case 5: return 2.0 * asin(clamp(sine, -1.0, 1.0)) / PI;
    case 6: return sine >= 0.0 ? 0.85 : -0.85;
    case 7: return tanh(2.4 * sine);
    case 8: return 2.0 * fract(phase / TAU) - 1.0;
    case 9: return fract(phase / TAU) < 0.25 ? 1.0 : -1.0;
    default: return sine;
  }
}

float spatialPhase(int index, vec2 point, float radius, float polarAngle) {
  float coordinate;
  switch (uSpaces[index]) {
    case 1:
      coordinate = MAX_RADIUS * pow(radius / MAX_RADIUS, uRadialExponents[index]);
      break;
    case 2:
      coordinate = polarAngle - uOrientations[index];
      break;
    case 3:
      coordinate = radius + uTwists[index] * polarAngle;
      break;
    default:
      coordinate = point.x * cos(uAngles[index]) + point.y * sin(uAngles[index]);
      break;
  }
  return uBase * uRatios[index] * coordinate;
}

float evaluateOperator(int index, float modulation, vec2 point, float radius, float polarAngle) {
  float phase = spatialPhase(index, point, radius, polarAngle)
    + uPhases[index]
    + uMotionPhase * uRatios[index];
  return wave(phase + modulation, uWaves[index]) * uLevels[index];
}

void main() {
  vec2 pixel = floor(gl_FragCoord.xy);
  vec2 point = (pixel / uResolution - 0.5) * TAU;
  float radius = length(point);
  float polarAngle = atan(point.y, point.x);

  float phase3 = spatialPhase(3, point, radius, polarAngle)
    + uPhases[3]
    + uMotionPhase * uRatios[3];
  float value3 = 0.0;
  if (uFeedback > 0.0) {
    for (int pass = 0; pass < 4; pass++) {
      value3 = wave(phase3 + value3 * uFeedback, uWaves[3]) * uLevels[3];
    }
  } else {
    value3 = wave(phase3, uWaves[3]) * uLevels[3];
  }

  float modulation2 = hasBit(uInputMasks[2], 3) ? value3 : 0.0;
  float value2 = evaluateOperator(2, modulation2, point, radius, polarAngle);
  float modulation1 = 0.0;
  if (hasBit(uInputMasks[1], 2)) modulation1 += value2;
  if (hasBit(uInputMasks[1], 3)) modulation1 += value3;
  float value1 = evaluateOperator(1, modulation1, point, radius, polarAngle);
  float modulation0 = 0.0;
  if (hasBit(uInputMasks[0], 1)) modulation0 += value1;
  if (hasBit(uInputMasks[0], 2)) modulation0 += value2;
  if (hasBit(uInputMasks[0], 3)) modulation0 += value3;
  float value0 = evaluateOperator(0, modulation0, point, radius, polarAngle);

  float signal = 0.0;
  if (hasBit(uCarrierMask, 0)) signal += value0;
  if (hasBit(uCarrierMask, 1)) signal += value1;
  if (hasBit(uCarrierMask, 2)) signal += value2;
  if (hasBit(uCarrierMask, 3)) signal += value3;
  float normalized = clamp((signal / uCarrierLevel + 1.0) * 0.5, 0.0, 1.0);

  if (uTrueValues != 0) {
    fragmentColor = vec4(vec3(normalized), 1.0);
  } else {
    int band = min(4, int(floor(normalized * 5.0)));
    fragmentColor = vec4(uPalette[band], 1.0);
  }
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Unknown shader compilation error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export type WebGLTextureRenderer = {
  render(frame: ShaderFrame): void;
};

export function createWebGLTextureRenderer(canvas: HTMLCanvasElement): WebGLTextureRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create WebGL program");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Unknown WebGL link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const locations = {
    resolution: uniform("uResolution"),
    base: uniform("uBase"),
    feedback: uniform("uFeedback"),
    motionPhase: uniform("uMotionPhase"),
    carrierLevel: uniform("uCarrierLevel"),
    trueValues: uniform("uTrueValues"),
    carrierMask: uniform("uCarrierMask"),
    inputMasks: uniform("uInputMasks[0]"),
    ratios: uniform("uRatios[0]"),
    levels: uniform("uLevels[0]"),
    angles: uniform("uAngles[0]"),
    phases: uniform("uPhases[0]"),
    radialExponents: uniform("uRadialExponents[0]"),
    orientations: uniform("uOrientations[0]"),
    twists: uniform("uTwists[0]"),
    waves: uniform("uWaves[0]"),
    spaces: uniform("uSpaces[0]"),
    palette: uniform("uPalette[0]"),
  };

  gl.useProgram(program);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  return {
    render(frame) {
      if (canvas.width !== frame.size) canvas.width = frame.size;
      if (canvas.height !== frame.size) canvas.height = frame.size;
      gl.viewport(0, 0, frame.size, frame.size);
      gl.useProgram(program);
      gl.uniform2f(locations.resolution, frame.size, frame.size);
      gl.uniform1f(locations.base, frame.base);
      gl.uniform1f(locations.feedback, frame.feedback);
      gl.uniform1f(locations.motionPhase, frame.motionPhase);
      gl.uniform1f(locations.carrierLevel, frame.carrierLevel);
      gl.uniform1i(locations.trueValues, frame.trueValues ? 1 : 0);
      gl.uniform1i(locations.carrierMask, frame.carrierMask);
      gl.uniform1iv(locations.inputMasks, frame.inputMasks);
      gl.uniform1fv(locations.ratios, frame.operators.map((operator) => operator.ratio));
      gl.uniform1fv(locations.levels, frame.operators.map((operator) => operator.level));
      gl.uniform1fv(locations.angles, frame.operators.map((operator) => operator.angle * Math.PI / 180));
      gl.uniform1fv(locations.phases, frame.operators.map((operator) => operator.phase * Math.PI / 180));
      gl.uniform1fv(locations.radialExponents, frame.operators.map((operator) => 2 ** (operator.radialBias * 2)));
      gl.uniform1fv(locations.orientations, frame.operators.map((operator) => operator.orientation * Math.PI / 180));
      gl.uniform1fv(locations.twists, frame.operators.map((operator) => operator.twist));
      gl.uniform1iv(locations.waves, frame.operators.map((operator) => operator.wave));
      gl.uniform1iv(locations.spaces, frame.operators.map((operator) => operator.space));
      gl.uniform3fv(locations.palette, frame.palette);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
