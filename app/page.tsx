"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { createWebGLTextureRenderer } from "./webgl-renderer";
import type { WebGLTextureRenderer } from "./webgl-renderer";

type Operator = {
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
type Patch = { base: number; algorithm: number; feedback: number; animationSpeed: number; palette: number; trueValues: boolean; operators: Operator[] };
type Algorithm = { diagram: string; inputs: number[][]; carriers: number[] };
type SavedPreset = { name: string; patch: Patch };
type Palette = { name: string; colors: string[] };

const DEFAULT_RESOLUTION = 1024;
const RESOLUTIONS = [128, 256, 512, 768, 1024, 1280, 2048, 4096];
const INTERACTIVE_RESOLUTION = 256;
const MIN_ANIMATION_FPS = 10;
const RECOVERY_ANIMATION_FPS = 13;
const ANIMATION_INTERVAL = 16;
const MIN_ANIMATION_SPEED = 0.01;
const MAX_ANIMATION_SPEED = 2;
const TAU = Math.PI * 2;
const MIN_BASE = 0.03;
const MAX_BASE = 2;
const PRESET_STORAGE_KEY = "phasefield-4op-presets";
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4;
const PALETTES: Palette[] = [
  { name: "Ember", colors: ["#15121a", "#7d2449", "#ef4b23", "#f2b84b", "#eee9df"] },
  { name: "Arctic", colors: ["#eefaff", "#a8e0e8", "#3a91b8", "#ff5d73", "#16243a"] },
  { name: "Sorbet", colors: ["#f6c7d5", "#ef9fbd", "#c7b6e8", "#9ed9d0", "#ffe59a"] },
  { name: "Bauhaus", colors: ["#151515", "#df2935", "#f5c242", "#2468b4", "#f1eee5"] },
  { name: "Desert", colors: ["#2b1812", "#8f3c2e", "#dd7b32", "#f0bc4f", "#218c84"] },
  { name: "Mineral", colors: ["#25292a", "#53635d", "#8b8577", "#b08f82", "#776578"] },
  { name: "Acid", colors: ["#15100f", "#4e1b62", "#d72f70", "#c9ef30", "#f7f6c5"] },
  { name: "Noir", colors: ["#07080a", "#123b46", "#561d35", "#c39a47", "#d9dde0"] },
];

function packHexColor(hex: string) {
  const color = Number.parseInt(hex.slice(1), 16);
  const red = (color >> 16) & 255;
  const green = (color >> 8) & 255;
  const blue = color & 255;
  return LITTLE_ENDIAN
    ? (red | (green << 8) | (blue << 16) | 0xff000000) >>> 0
    : ((red << 24) | (green << 16) | (blue << 8) | 255) >>> 0;
}

const PACKED_PALETTES = PALETTES.map((palette) => palette.colors.map(packHexColor));
const SHADER_PALETTES = PALETTES.map((palette) => palette.colors.flatMap((hex) => {
  const color = Number.parseInt(hex.slice(1), 16);
  return [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];
}));
const CONTINUOUS_GRAYS = Uint32Array.from({ length: 256 }, (_, value) => packHexColor(`#${value.toString(16).padStart(2, "0").repeat(3)}`));
const coordinateCache = new Map<number, Float64Array>();
const polarCache = new Map<number, { radius?: Float32Array; angle?: Float32Array }>();
const SPATIAL_NAMES = ["Linear", "Radial", "Angular", "Spiral"];
const SPATIAL_FORMULAS = [
  "x cos(d) + y sin(d)",
  "R (r / R)^γ",
  "atan2(y, x) − orientation",
  "r + twist · atan2(y, x)",
];
const WAVE_NAMES = ["Sine", "Half +", "Absolute", "Fold", "Odd pair", "Triangle", "Square", "Soft clip", "Sawtooth", "25% pulse"];
const WAVE_FORMULAS = [
  "sin(θ)",
  "2 max(0, sin θ) − 0.5",
  "2 |sin θ| − 1",
  "sin θ |sin θ|",
  "(sin θ + 0.5 sin 2θ) / 1.5",
  "2 asin(sin θ) / π",
  "0.85 sign(sin θ)",
  "tanh(2.4 sin θ)",
  "2 frac(θ / 2π) − 1",
  "frac(θ / 2π) < 0.25 ? 1 : −1",
];

const ALGORITHMS: Algorithm[] = [
  { diagram: "4→3→2→1", inputs: [[1], [2], [3], []], carriers: [0] },
  { diagram: "4+3→2→1", inputs: [[1], [2, 3], [], []], carriers: [0] },
  { diagram: "4→3→1 ←2", inputs: [[1, 2], [], [3], []], carriers: [0] },
  { diagram: "4→3  +  2→1", inputs: [[1], [], [3], []], carriers: [0, 2] },
  { diagram: "4+3+2→1", inputs: [[1, 2, 3], [], [], []], carriers: [0] },
  { diagram: "1←4→2,3", inputs: [[3], [3], [3], []], carriers: [0, 1, 2] },
  { diagram: "4→3  +  2  +  1", inputs: [[], [], [3], []], carriers: [0, 1, 2] },
  { diagram: "1 + 2 + 3 + 4", inputs: [[], [], [], []], carriers: [0, 1, 2, 3] },
];

const op = (ratio: number, level: number, angle: number, wave = 0, phase = 0): Operator => ({
  ratio,
  level,
  angle,
  wave,
  phase,
  space: 0,
  radialBias: 0,
  orientation: 0,
  twist: 1.5,
});

const DEFAULT_PATCH: Patch = {
  base: 0.46,
  algorithm: 0,
  feedback: 0.8,
  animationSpeed: 1,
  palette: 0,
  trueValues: false,
  operators: [op(1, 1, 0), op(3, 3.4, 88), op(7, 2.7, 37, 2), op(13, 2.1, 142)],
};

function baseToSlider(base: number) {
  return Math.log(base / MIN_BASE) / Math.log(MAX_BASE / MIN_BASE) * 100;
}

function sliderToBase(position: number) {
  return MIN_BASE * Math.pow(MAX_BASE / MIN_BASE, position / 100);
}

function animationSpeedToSlider(speed: number) {
  return Math.log(speed / MIN_ANIMATION_SPEED) / Math.log(MAX_ANIMATION_SPEED / MIN_ANIMATION_SPEED) * 100;
}

function sliderToAnimationSpeed(position: number) {
  return MIN_ANIMATION_SPEED * Math.pow(MAX_ANIMATION_SPEED / MIN_ANIMATION_SPEED, position / 100);
}

function coordinatesFor(size: number) {
  const cached = coordinateCache.get(size);
  if (cached) return cached;
  const coordinates = Float64Array.from({ length: size }, (_, position) => (position / size - 0.5) * TAU);
  coordinateCache.set(size, coordinates);
  return coordinates;
}

function polarCoordinatesFor(size: number, needsRadius: boolean, needsAngle: boolean) {
  const coordinates = coordinatesFor(size);
  const cached = polarCache.get(size) ?? {};
  const makeRadius = needsRadius && !cached.radius;
  const makeAngle = needsAngle && !cached.angle;
  if (!makeRadius && !makeAngle) return cached;

  const radius = makeRadius ? new Float32Array(size * size) : cached.radius;
  const angle = makeAngle ? new Float32Array(size * size) : cached.angle;
  for (let py = 0; py < size; py++) {
    const y = coordinates[py];
    for (let px = 0; px < size; px++) {
      const x = coordinates[px];
      const offset = py * size + px;
      if (makeRadius) radius![offset] = Math.sqrt(x * x + y * y);
      if (makeAngle) angle![offset] = Math.atan2(y, x);
    }
  }
  const result = { radius, angle };
  polarCache.set(size, result);
  return result;
}

function wave(phase: number, shape: number) {
  const s = Math.sin(phase);
  switch (shape) {
    case 1: return Math.max(0, s) * 2 - 0.5;
    case 2: return Math.abs(s) * 2 - 1;
    case 3: return s * Math.abs(s);
    case 4: return (s + 0.5 * Math.sin(2 * phase)) / 1.5;
    case 5: return 2 * Math.asin(s) / Math.PI;
    case 6: return s >= 0 ? 0.85 : -0.85;
    case 7: return Math.tanh(2.4 * s);
    case 8: return 2 * (phase / TAU - Math.floor(phase / TAU)) - 1;
    case 9: return phase / TAU - Math.floor(phase / TAU) < 0.25 ? 1 : -1;
    default: return s;
  }
}

function WaveIcon({ shape }: { shape: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = 104;
    const height = 38;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = "rgba(23, 20, 27, 0.24)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
    context.strokeStyle = "#17141b";
    context.lineWidth = 1.5;
    context.beginPath();
    for (let point = 0; point <= width * 2; point++) {
      const x = point / 2;
      const phase = x / width * TAU;
      const y = height / 2 - wave(phase, shape) * height * 0.27;
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }, [shape]);

  return <canvas ref={canvasRef} className="wave-icon" aria-hidden="true" />;
}

function clonePatch(patch: Patch): Patch {
  return { ...patch, operators: patch.operators.map((operator) => ({ ...operator })) };
}

function isSavedPreset(value: unknown): value is SavedPreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as { name?: unknown; patch?: Partial<Patch> };
  if (typeof preset.name !== "string" || !preset.patch) return false;
  if (typeof preset.patch.base !== "number" || typeof preset.patch.algorithm !== "number" || typeof preset.patch.feedback !== "number" || typeof preset.patch.animationSpeed !== "number") return false;
  if (typeof preset.patch.palette !== "number" || !Number.isInteger(preset.patch.palette) || preset.patch.palette < 0 || preset.patch.palette >= PALETTES.length || typeof preset.patch.trueValues !== "boolean") return false;
  if (!Array.isArray(preset.patch.operators) || preset.patch.operators.length !== 4) return false;
  const keys: Array<keyof Operator> = ["ratio", "level", "angle", "wave", "phase", "space", "radialBias", "orientation", "twist"];
  return preset.patch.operators.every((operator) => keys.every((key) => typeof operator?.[key] === "number"));
}

function LockToggle({ locked, label, onToggle }: { locked: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={locked ? "lock-toggle locked" : "lock-toggle"}
      aria-pressed={locked}
      aria-label={`${locked ? "Unlock" : "Lock"} ${label} during randomize`}
      title={`${locked ? "Unlock" : "Lock"} ${label}`}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={locked ? "M4.5 7V5a3.5 3.5 0 0 1 7 0v2" : "M4.5 7V5a3.5 3.5 0 0 1 6.7-1.4"} />
        <rect x="3" y="7" width="10" height="7" rx="1" />
      </svg>
    </button>
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const webglRendererRef = useRef<WebGLTextureRenderer | null | undefined>(undefined);
  const imageCacheRef = useRef(new Map<number, ImageData>());
  const phaseFieldCacheRef = useRef<Array<{ key: string; field: Float64Array } | undefined>>([]);
  const workspaceRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  const motionPhaseRef = useRef(0);
  const interactingRef = useRef(false);
  const adaptiveResolutionRef = useRef(DEFAULT_RESOLUTION);
  const [patch, setPatch] = useState(() => clonePatch(DEFAULT_PATCH));
  const [playing, setPlaying] = useState(false);
  const [previewShare, setPreviewShare] = useState(56);
  const [resolution, setResolution] = useState(DEFAULT_RESOLUTION);
  const [interacting, setInteracting] = useState(false);
  const [adaptiveResolution, setAdaptiveResolution] = useState(DEFAULT_RESOLUTION);
  const [animationFps, setAnimationFps] = useState(0);
  const [locks, setLocks] = useState(() => new Set<string>());
  const [openOperators, setOpenOperators] = useState(() => new Set([0, 1, 2, 3]));
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [presetStatus, setPresetStatus] = useState("");
  const renderSize = interacting ? Math.min(INTERACTIVE_RESOLUTION, resolution) : resolution;

  const toggleLock = (id: string) => {
    setLocks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const draw = useCallback((size = renderSize) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (webglRendererRef.current === undefined) {
      try {
        webglRendererRef.current = createWebGLTextureRenderer(canvas);
        canvas.dataset.renderer = webglRendererRef.current ? "webgl2" : "cpu";
      } catch (error) {
        console.error("[PHASEFIELD_WEBGL] Shader initialization failed; using the CPU renderer.", error);
        webglRendererRef.current = null;
        canvas.dataset.renderer = "cpu";
      }
    }
    const algorithm = ALGORITHMS[patch.algorithm];
    let carrierLevel = 0;
    let carrierMask = 0;
    for (const index of algorithm.carriers) {
      carrierLevel += patch.operators[index].level;
      carrierMask |= 1 << index;
    }
    carrierLevel ||= 1;
    if (webglRendererRef.current) {
      webglRendererRef.current.render({
        size,
        base: patch.base,
        feedback: patch.feedback,
        trueValues: patch.trueValues,
        motionPhase: motionPhaseRef.current,
        operators: patch.operators,
        inputMasks: algorithm.inputs.map((inputs) => inputs.reduce((mask, index) => mask | (1 << index), 0)),
        carrierMask,
        carrierLevel,
        palette: SHADER_PALETTES[patch.palette],
      });
      return;
    }
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    let image = imageCacheRef.current.get(size);
    if (!image) {
      image = context.createImageData(size, size);
      imageCacheRef.current.set(size, image);
    }
    const coordinates = coordinatesFor(size);
    const operatorState = patch.operators.map((operator) => {
      const angle = operator.angle * Math.PI / 180;
      return {
        ...operator,
        cos: Math.cos(angle),
        sin: Math.sin(angle),
        phaseOffset: operator.phase * Math.PI / 180,
        orientationOffset: operator.orientation * Math.PI / 180,
        radialExponent: Math.pow(2, operator.radialBias * 2),
      };
    });
    const needsRadius = operatorState.some((operator) => operator.space === 1 || operator.space === 3);
    const needsAngle = operatorState.some((operator) => operator.space === 2 || operator.space === 3);
    const polar = needsRadius || needsAngle ? polarCoordinatesFor(size, needsRadius, needsAngle) : null;
    const maximumRadius = Math.PI * Math.SQRT2;
    const phaseFields = operatorState.map((operator, index) => {
      const key = [
        size,
        patch.base,
        operator.ratio,
        operator.space,
        operator.angle,
        operator.radialBias,
        operator.orientation,
        operator.twist,
      ].join(":");
      const cached = phaseFieldCacheRef.current[index];
      if (cached?.key === key) return cached.field;

      const field = new Float64Array(size * size);
      for (let py = 0; py < size; py++) {
        const y = coordinates[py];
        for (let px = 0; px < size; px++) {
          const x = coordinates[px];
          const pixelOffset = py * size + px;
          let coordinate: number;
          if (operator.space === 1) {
            coordinate = maximumRadius * Math.pow(polar!.radius![pixelOffset] / maximumRadius, operator.radialExponent);
          } else if (operator.space === 2) {
            coordinate = polar!.angle![pixelOffset] - operator.orientationOffset;
          } else if (operator.space === 3) {
            coordinate = polar!.radius![pixelOffset] + operator.twist * polar!.angle![pixelOffset];
          } else {
            coordinate = x * operator.cos + y * operator.sin;
          }
          field[pixelOffset] = patch.base * operator.ratio * coordinate;
        }
      }
      phaseFieldCacheRef.current[index] = { key, field };
      return field;
    });
    const values = [0, 0, 0, 0];
    const pixels = new Uint32Array(image.data.buffer, image.data.byteOffset, size * size);
    const motionPhase = motionPhaseRef.current;
    const activeColors = PACKED_PALETTES[patch.palette];

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const pixelOffset = py * size + px;

        for (let index = 3; index >= 0; index--) {
          const operator = operatorState[index];
          const basePhase = phaseFields[index][pixelOffset] + operator.phaseOffset + motionPhase * operator.ratio;
          let modulation = 0;
          const inputs = algorithm.inputs[index];
          for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) modulation += values[inputs[inputIndex]];

          if (index === 3 && patch.feedback > 0) {
            let feedbackValue = 0;
            for (let pass = 0; pass < 4; pass++) feedbackValue = wave(basePhase + feedbackValue * patch.feedback, operator.wave) * operator.level;
            values[index] = feedbackValue;
          } else {
            values[index] = wave(basePhase + modulation, operator.wave) * operator.level;
          }
        }

        let signal = 0;
        for (let carrierIndex = 0; carrierIndex < algorithm.carriers.length; carrierIndex++) signal += values[algorithm.carriers[carrierIndex]];
        signal /= carrierLevel;
        const normalized = Math.max(0, Math.min(1, (signal + 1) / 2));
        if (patch.trueValues) {
          pixels[pixelOffset] = CONTINUOUS_GRAYS[Math.round(normalized * 255)];
        } else {
          const band = Math.min(activeColors.length - 1, Math.floor(normalized * activeColors.length));
          pixels[pixelOffset] = activeColors[band];
        }
      }
    }
    context.putImageData(image, 0, 0);
  }, [patch, renderSize]);

  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);
  useEffect(() => { interactingRef.current = interacting; }, [interacting]);

  useEffect(() => {
    if (playing) return;
    adaptiveResolutionRef.current = resolution;
    setAdaptiveResolution(resolution);
    setAnimationFps(0);
    const frame = requestAnimationFrame(() => draw());
    return () => cancelAnimationFrame(frame);
  }, [draw, playing, resolution]);
  useEffect(() => {
    if (!playing) return;
    adaptiveResolutionRef.current = resolution;
    setAdaptiveResolution(resolution);
    setAnimationFps(0);
    let frame = 0;
    let last = 0;
    let lastDrawStartedAt = 0;
    let lastFpsReport = 0;
    let fastFrames = 0;

    const changeAdaptiveResolution = (size: number) => {
      adaptiveResolutionRef.current = size;
      setAdaptiveResolution(size);
    };

    const tick = (time: number) => {
      if (time - last > ANIMATION_INTERVAL) {
        const animationElapsed = last ? Math.min(100, time - last) : ANIMATION_INTERVAL;
        motionPhaseRef.current += animationElapsed * (0.035 / 65) * patch.animationSpeed;
        const renderResolution = interactingRef.current
          ? Math.min(INTERACTIVE_RESOLUTION, adaptiveResolutionRef.current)
          : adaptiveResolutionRef.current;
        const drawStartedAt = performance.now();
        drawRef.current(renderResolution);
        const drawFinishedAt = performance.now();
        const frameDuration = lastDrawStartedAt
          ? drawStartedAt - lastDrawStartedAt
          : drawFinishedAt - drawStartedAt + 16.7;
        const fps = 1000 / Math.max(1, frameDuration);
        lastDrawStartedAt = drawStartedAt;

        if (time - lastFpsReport > 400) {
          setAnimationFps(Math.round(fps));
          lastFpsReport = time;
        }

        if (!interactingRef.current) {
          const currentSize = adaptiveResolutionRef.current;
          const currentIndex = RESOLUTIONS.indexOf(currentSize);
          const targetIndex = RESOLUTIONS.indexOf(resolution);
          if (fps < MIN_ANIMATION_FPS && currentIndex > 0) {
            const estimatedSize = currentSize * Math.sqrt(Math.max(0.05, fps / MIN_ANIMATION_FPS));
            let nextIndex = currentIndex - 1;
            for (let index = currentIndex - 1; index >= 0; index--) {
              if (RESOLUTIONS[index] <= estimatedSize) {
                nextIndex = index;
                break;
              }
            }
            changeAdaptiveResolution(RESOLUTIONS[nextIndex]);
            fastFrames = 0;
          } else if (fps >= RECOVERY_ANIMATION_FPS && currentIndex < targetIndex) {
            fastFrames++;
            if (fastFrames >= 20) {
              changeAdaptiveResolution(RESOLUTIONS[currentIndex + 1]);
              fastFrames = 0;
            }
          } else {
            fastFrames = 0;
          }
        }
        last = time;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, resolution, patch.animationSpeed]);
  useEffect(() => {
    const finishInteraction = () => setInteracting(false);
    window.addEventListener("pointerup", finishInteraction);
    window.addEventListener("pointercancel", finishInteraction);
    return () => {
      window.removeEventListener("pointerup", finishInteraction);
      window.removeEventListener("pointercancel", finishInteraction);
    };
  }, []);
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(PRESET_STORAGE_KEY) ?? "[]");
      if (Array.isArray(stored)) setPresets(stored.filter(isSavedPreset));
    } catch {
      setPresetStatus("Saved presets could not be read");
    }
  }, []);

  const updateOperator = (index: number, key: keyof Operator, value: number) => {
    setPatch((current) => ({ ...current, operators: current.operators.map((operator, position) => position === index ? { ...operator, [key]: value } : operator) }));
  };

  const resizePreview = (event: ReactPointerEvent<HTMLDivElement>) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const bounds = workspace.getBoundingClientRect();
    const mobile = window.matchMedia("(max-width: 850px)").matches;
    const rawShare = mobile
      ? (event.clientY - bounds.top) / bounds.height * 100
      : (event.clientX - bounds.left) / bounds.width * 100;
    const desktopMaximum = Math.min(75, (bounds.width - 329) / bounds.width * 100);
    setPreviewShare(Math.max(mobile ? 24 : 28, Math.min(mobile ? 72 : desktopMaximum, rawShare)));
  };

  const handleSplitterKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    setPreviewShare((share) => Math.max(24, Math.min(72, share + direction * 2)));
  };

  const randomize = () => {
    const ratios = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7, 9.5, 11, 13, 15.75];
    const algorithmChoices = [0, 0, 1, 2, 2, 3, 4, 5, 6];
    setPatch((current) => {
      const algorithm = locks.has("algorithm")
        ? current.algorithm
        : algorithmChoices[Math.floor(Math.random() * algorithmChoices.length)];
      const directionRoot = Math.random() * 180;
      const operators = current.operators.map((currentOperator, index) => {
        const operator = op(
          ratios[Math.floor(Math.random() * ratios.length)],
          ALGORITHMS[algorithm].carriers.includes(index) ? 0.75 + Math.random() * 0.65 : 1.5 + Math.random() * 4.5,
          Math.floor((directionRoot + index * (38 + Math.random() * 18) + (Math.random() - 0.5) * 16) % 180),
          Math.floor(Math.random() * WAVE_NAMES.length),
          Math.floor(Math.random() * 360),
        );
        operator.space = Math.floor(Math.random() * SPATIAL_NAMES.length);
        operator.radialBias = Math.random() * 2 - 1;
        operator.orientation = Math.floor(Math.random() * 360);
        operator.twist = Math.random() * 8 - 4;
        for (const key of Object.keys(operator) as Array<keyof Operator>) {
          if (locks.has(`operator.${index}.${key}`)) operator[key] = currentOperator[key];
        }
        return operator;
      });
      return {
        base: locks.has("base") ? current.base : MIN_BASE * Math.pow(MAX_BASE / MIN_BASE, Math.random()),
        algorithm,
        feedback: locks.has("feedback") ? current.feedback : Math.random() * 4.5,
        animationSpeed: locks.has("animationSpeed")
          ? current.animationSpeed
          : 0.05 * Math.pow(1.25 / 0.05, Math.random()),
        palette: current.palette,
        trueValues: current.trueValues,
        operators,
      };
    });
  };

  const savePreset = () => {
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const next = [...presets.filter((preset) => preset.name !== name), { name, patch: clonePatch(patch) }];
    try {
      window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next));
    } catch {
      setPresetStatus("Preset could not be saved");
      return;
    }
    setPresets(next);
    setPresetName(name);
    setSelectedPreset(name);
    setPresetStatus(`Saved ${name}`);
  };

  const loadPreset = () => {
    const preset = presets.find((candidate) => candidate.name === selectedPreset);
    if (!preset) return;
    setPatch(clonePatch(preset.patch));
    setPresetName(preset.name);
    setPresetStatus(`Loaded ${preset.name}`);
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    draw(resolution);
    const link = document.createElement("a");
    link.download = `phasefield-algorithm-${patch.algorithm + 1}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const resolutionStatus = interacting
    ? `PREVIEW ${renderSize}² → ${resolution}²`
    : playing
      ? `${adaptiveResolution < resolution ? `ADAPTIVE ${adaptiveResolution}² → ${resolution}²` : `${resolution}²`} · ${animationFps ? `${animationFps} FPS` : "MEASURING"}`
      : `${resolution}²`;

  return (
    <main>
      <header><div className="brand"><span /> PHASEFIELD / 4OP</div><p>Four-operator spatial FM synthesizer</p></header>
      <section ref={workspaceRef} className="workspace" style={{ "--preview-share": `${previewShare}%` } as CSSProperties}>
        <div className="visual-panel">
          <div className="visual-head"><span>ALGORITHM {patch.algorithm + 1} · {ALGORITHMS[patch.algorithm].diagram} · {resolutionStatus}</span><span className={playing ? "live active" : "live"}>{playing ? "RUNNING" : "STILL"}</span></div>
          <div className="canvas-wrap"><canvas ref={canvasRef} aria-label="Four-operator FM pixel texture" /></div>
          <p className="explanation">Each operator maps phase through a linear, radial, angular, or spiral field. Arrows route one operator&apos;s output into another operator&apos;s phase—the same role they play in an FM voice.</p>
        </div>

        <div
          className="splitter"
          role="separator"
          aria-label="Resize texture preview"
          aria-valuemin={24}
          aria-valuemax={72}
          aria-valuenow={Math.round(previewShare)}
          tabIndex={0}
          onKeyDown={handleSplitterKey}
          onPointerDown={(event) => { draggingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); resizePreview(event); }}
          onPointerMove={(event) => { if (draggingRef.current) resizePreview(event); }}
          onPointerUp={(event) => { draggingRef.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { draggingRef.current = false; }}
        ><span /></div>

        <aside
          className="controls"
          onPointerDown={(event) => { if (event.target instanceof HTMLInputElement && event.target.type === "range") setInteracting(true); }}
          onKeyDown={(event) => { if (event.target instanceof HTMLInputElement && event.target.type === "range") setInteracting(true); }}
          onKeyUp={(event) => { if (event.target instanceof HTMLInputElement && event.target.type === "range") setInteracting(false); }}
          onBlurCapture={(event) => { if (event.target instanceof HTMLInputElement && event.target.type === "range") setInteracting(false); }}
        >
          <section className="global-controls">
            <div className="control">
              <div className="control-head"><span>Base frequency</span><output>{patch.base.toFixed(3)}</output><LockToggle locked={locks.has("base")} label="base frequency" onToggle={() => toggleLock("base")} /></div>
              <input aria-label="Base frequency" type="range" min="0" max="100" step="0.25" value={baseToSlider(patch.base)} onChange={(event) => setPatch((current) => ({ ...current, base: sliderToBase(Number(event.target.value)) }))} />
            </div>
            <div className="control">
              <div className="control-head"><span>OP4 feedback</span><output>{patch.feedback.toFixed(2)}</output><LockToggle locked={locks.has("feedback")} label="OP4 feedback" onToggle={() => toggleLock("feedback")} /></div>
              <input aria-label="OP4 feedback" type="range" min="0" max="6" step="0.1" value={patch.feedback} onChange={(event) => setPatch((current) => ({ ...current, feedback: Number(event.target.value) }))} />
            </div>
            <div className="control">
              <div className="control-head"><span>Animation speed</span><output>{patch.animationSpeed.toFixed(2)}×</output><LockToggle locked={locks.has("animationSpeed")} label="animation speed" onToggle={() => toggleLock("animationSpeed")} /></div>
              <input aria-label="Animation speed" type="range" min="0" max="100" step="0.25" value={animationSpeedToSlider(patch.animationSpeed)} onChange={(event) => setPatch((current) => ({ ...current, animationSpeed: sliderToAnimationSpeed(Number(event.target.value)) }))} />
            </div>
            <div className="control resolution-control">
              <div className="control-head"><span>Resolution</span><LockToggle locked={locks.has("resolution")} label="resolution" onToggle={() => toggleLock("resolution")} /></div>
              <select aria-label="Resolution" value={resolution} onChange={(event) => setResolution(Number(event.target.value))}>{RESOLUTIONS.map((size) => <option key={size} value={size}>{size} × {size}</option>)}</select>
            </div>
          </section>
          <section className="color-controls" aria-label="Color mapping">
            <fieldset className="palette-picker">
              <legend><span>Color palette</span><LockToggle locked={locks.has("palette")} label="color palette" onToggle={() => toggleLock("palette")} /></legend>
              <div className="palette-grid">
                {PALETTES.map((palette, index) => (
                  <button
                    type="button"
                    key={palette.name}
                    className={!patch.trueValues && patch.palette === index ? "selected" : ""}
                    aria-pressed={!patch.trueValues && patch.palette === index}
                    aria-label={`Color palette ${palette.name}`}
                    onClick={() => setPatch((current) => ({ ...current, palette: index, trueValues: false }))}
                  >
                    <span className="palette-swatch" aria-hidden="true">{palette.colors.map((color) => <i key={color} style={{ background: color }} />)}</span>
                    <b>{palette.name}</b>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="true-values-control">
              <span><b>True values</b><small>Continuous grayscale · no palette bands</small></span>
              <button
                type="button"
                className={patch.trueValues ? "value-toggle active" : "value-toggle"}
                aria-pressed={patch.trueValues}
                aria-label="True values continuous grayscale"
                onClick={() => setPatch((current) => ({ ...current, trueValues: !current.trueValues }))}
              >{patch.trueValues ? "On" : "Off"}</button>
              <LockToggle locked={locks.has("trueValues")} label="true values mode" onToggle={() => toggleLock("trueValues")} />
            </div>
          </section>
          <section className="preset-controls" aria-label="Saved presets">
            <input aria-label="Preset name" type="text" value={presetName} placeholder="Preset name" maxLength={48} onChange={(event) => setPresetName(event.target.value)} />
            <button type="button" onClick={savePreset}>Save preset</button>
            <select aria-label="Saved preset" value={selectedPreset} onChange={(event) => { setSelectedPreset(event.target.value); setPresetStatus(""); }}>
              <option value="">{presets.length ? "Choose preset" : "No saved presets"}</option>
              {presets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
            </select>
            <button type="button" disabled={!selectedPreset} onClick={loadPreset}>Load preset</button>
            <span className="preset-status" role="status">{presetStatus}</span>
          </section>
          <div className="algorithm-control">
            <div className="control-group-head"><span>FM routing algorithm</span><LockToggle locked={locks.has("algorithm")} label="FM routing algorithm" onToggle={() => toggleLock("algorithm")} /></div>
            <div className="algorithm-grid" aria-label="FM routing algorithm">
              {ALGORITHMS.map((algorithm, index) => <button key={algorithm.diagram} className={patch.algorithm === index ? "selected" : ""} onClick={() => setPatch((current) => ({ ...current, algorithm: index }))}><b>{index + 1}</b><span>{algorithm.diagram}</span></button>)}
            </div>
          </div>
          <div className="operators">
            {patch.operators.map((operator, index) => (
              <details
                key={index}
                open={openOperators.has(index)}
                onToggle={(event) => {
                  const isOpen = event.currentTarget.open;
                  setOpenOperators((current) => {
                    if (current.has(index) === isOpen) return current;
                    const next = new Set(current);
                    if (isOpen) next.add(index);
                    else next.delete(index);
                    return next;
                  });
                }}
              >
                <summary><b>OP{index + 1}</b><span>{ALGORITHMS[patch.algorithm].carriers.includes(index) ? "CARRIER" : "MODULATOR"}</span><em>{operator.ratio.toFixed(2)}×</em></summary>
                <div className="operator-body">
                  <fieldset className="space-picker">
                    <legend><span>Spatial phase</span><LockToggle locked={locks.has(`operator.${index}.space`)} label={`OP${index + 1} spatial phase`} onToggle={() => toggleLock(`operator.${index}.space`)} /></legend>
                    <div className="space-grid">
                      {SPATIAL_NAMES.map((name, spaceIndex) => (
                        <button
                          type="button"
                          key={name}
                          className={operator.space === spaceIndex ? "selected" : ""}
                          aria-pressed={operator.space === spaceIndex}
                          aria-label={`OP${index + 1} spatial mode ${name}`}
                          title={SPATIAL_FORMULAS[spaceIndex]}
                          onClick={() => updateOperator(index, "space", spaceIndex)}
                        >{name}</button>
                      ))}
                    </div>
                  </fieldset>
                  <div className="control">
                    <div className="control-head"><span>Ratio</span><output>{operator.ratio.toFixed(2)}</output><LockToggle locked={locks.has(`operator.${index}.ratio`)} label={`OP${index + 1} ratio`} onToggle={() => toggleLock(`operator.${index}.ratio`)} /></div>
                    <input aria-label={`OP${index + 1} ratio`} type="range" min="0.25" max="16" step="0.25" value={operator.ratio} onChange={(event) => updateOperator(index, "ratio", Number(event.target.value))} />
                  </div>
                  <div className="control">
                    <div className="control-head"><span>Level</span><output>{operator.level.toFixed(1)}</output><LockToggle locked={locks.has(`operator.${index}.level`)} label={`OP${index + 1} level`} onToggle={() => toggleLock(`operator.${index}.level`)} /></div>
                    <input aria-label={`OP${index + 1} level`} type="range" min="0" max="8" step="0.1" value={operator.level} onChange={(event) => updateOperator(index, "level", Number(event.target.value))} />
                  </div>
                  {operator.space === 0 && <div className="control">
                    <div className="control-head"><span>Direction</span><output>{operator.angle.toFixed(0)}°</output><LockToggle locked={locks.has(`operator.${index}.angle`)} label={`OP${index + 1} direction`} onToggle={() => toggleLock(`operator.${index}.angle`)} /></div>
                    <input aria-label={`OP${index + 1} direction`} type="range" min="0" max="180" step="1" value={operator.angle} onChange={(event) => updateOperator(index, "angle", Number(event.target.value))} />
                  </div>}
                  {operator.space === 1 && <div className="control">
                    <div className="control-head"><span>Bias</span><output>γ {Math.pow(2, operator.radialBias * 2).toFixed(2)}</output><LockToggle locked={locks.has(`operator.${index}.radialBias`)} label={`OP${index + 1} radial bias`} onToggle={() => toggleLock(`operator.${index}.radialBias`)} /></div>
                    <input aria-label={`OP${index + 1} radial bias`} type="range" min="-1" max="1" step="0.01" value={operator.radialBias} onChange={(event) => updateOperator(index, "radialBias", Number(event.target.value))} />
                  </div>}
                  {operator.space === 2 && <div className="control">
                    <div className="control-head"><span>Orientation</span><output>{operator.orientation.toFixed(0)}°</output><LockToggle locked={locks.has(`operator.${index}.orientation`)} label={`OP${index + 1} orientation`} onToggle={() => toggleLock(`operator.${index}.orientation`)} /></div>
                    <input aria-label={`OP${index + 1} orientation`} type="range" min="0" max="360" step="1" value={operator.orientation} onChange={(event) => updateOperator(index, "orientation", Number(event.target.value))} />
                  </div>}
                  {operator.space === 3 && <div className="control">
                    <div className="control-head"><span>Twist</span><output>{operator.twist.toFixed(2)}</output><LockToggle locked={locks.has(`operator.${index}.twist`)} label={`OP${index + 1} twist`} onToggle={() => toggleLock(`operator.${index}.twist`)} /></div>
                    <input aria-label={`OP${index + 1} twist`} type="range" min="-4" max="4" step="0.05" value={operator.twist} onChange={(event) => updateOperator(index, "twist", Number(event.target.value))} />
                  </div>}
                  <div className="control">
                    <div className="control-head"><span>Phase</span><output>{operator.phase.toFixed(0)}°</output><LockToggle locked={locks.has(`operator.${index}.phase`)} label={`OP${index + 1} phase`} onToggle={() => toggleLock(`operator.${index}.phase`)} /></div>
                    <input aria-label={`OP${index + 1} phase`} type="range" min="0" max="360" step="1" value={operator.phase} onChange={(event) => updateOperator(index, "phase", Number(event.target.value))} />
                  </div>
                  <fieldset className="wave-picker">
                    <legend><span>Waveform · exact function</span><LockToggle locked={locks.has(`operator.${index}.wave`)} label={`OP${index + 1} waveform`} onToggle={() => toggleLock(`operator.${index}.wave`)} /></legend>
                    <div className="wave-grid">
                      {WAVE_NAMES.map((name, waveIndex) => (
                        <button
                          type="button"
                          key={name}
                          className={operator.wave === waveIndex ? "selected" : ""}
                          aria-pressed={operator.wave === waveIndex}
                          aria-label={`${name}: ${WAVE_FORMULAS[waveIndex]}`}
                          title={WAVE_FORMULAS[waveIndex]}
                          onClick={() => updateOperator(index, "wave", waveIndex)}
                        >
                          <WaveIcon shape={waveIndex} />
                          <span>{waveIndex + 1} · {name}</span>
                          <code>{WAVE_FORMULAS[waveIndex]}</code>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </details>
            ))}
          </div>
          <div className="actions"><button className="primary" onClick={randomize}>Random patch</button><button onClick={() => setPlaying((value) => !value)}>{playing ? "Freeze" : "Animate"}</button><button onClick={download}>Save PNG</button></div>
        </aside>
      </section>
      <footer><span>4 operators · 8 algorithms · 10 waveforms · 4 spatial modes · 8 palettes</span></footer>
    </main>
  );
}
