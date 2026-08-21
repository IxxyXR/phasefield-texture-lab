"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

type Operator = { ratio: number; level: number; angle: number; wave: number; phase: number };
type Patch = { base: number; algorithm: number; feedback: number; operators: Operator[] };
type Algorithm = { diagram: string; inputs: number[][]; carriers: number[] };

const DEFAULT_RESOLUTION = 1024;
const RESOLUTIONS = [128, 256, 512, 768, 1024, 1280];
const INTERACTIVE_RESOLUTION = 256;
const TAU = Math.PI * 2;
const MIN_BASE = 0.03;
const MAX_BASE = 2;
const COLORS = ["#15121a", "#7d2449", "#ef4b23", "#f2b84b", "#eee9df"];
const COLOR_VALUES = COLORS.map((hex) => Number.parseInt(hex.slice(1), 16));
const coordinateCache = new Map<number, Float64Array>();
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

const op = (ratio: number, level: number, angle: number, wave = 0, phase = 0): Operator => ({ ratio, level, angle, wave, phase });

const PRESETS: Record<string, Patch> = {
  Cascade: { base: 0.46, algorithm: 0, feedback: 0.8, operators: [op(1, 1, 0), op(3, 3.4, 88), op(7, 2.7, 37, 2), op(13, 2.1, 142)] },
  Alloy: { base: 0.82, algorithm: 2, feedback: 2.6, operators: [op(1.25, 1, 12), op(2.75, 4.2, 92), op(5.5, 3.6, 148, 4), op(11.25, 2.8, 48, 1)] },
  Lattice: { base: 0.19, algorithm: 5, feedback: 1.2, operators: [op(3, 1, 0), op(5, 0.9, 58), op(9, 0.85, 119), op(15.5, 5.2, 91, 3)] },
  Split: { base: 1.16, algorithm: 3, feedback: 3.4, operators: [op(0.5, 1, 22, 0), op(4.75, 4.5, 112, 1), op(1.5, 0.9, 158, 4), op(9.25, 3.8, 68, 6)] },
};

function baseToSlider(base: number) {
  return Math.log(base / MIN_BASE) / Math.log(MAX_BASE / MIN_BASE) * 100;
}

function sliderToBase(position: number) {
  return MIN_BASE * Math.pow(MAX_BASE / MIN_BASE, position / 100);
}

function coordinatesFor(size: number) {
  const cached = coordinateCache.get(size);
  if (cached) return cached;
  const coordinates = Float64Array.from({ length: size }, (_, position) => (position / size - 0.5) * TAU);
  coordinateCache.set(size, coordinates);
  return coordinates;
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

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  const [patch, setPatch] = useState(() => clonePatch(PRESETS.Cascade));
  const [playing, setPlaying] = useState(false);
  const [motionPhase, setMotionPhase] = useState(0);
  const [previewShare, setPreviewShare] = useState(56);
  const [resolution, setResolution] = useState(DEFAULT_RESOLUTION);
  const [interacting, setInteracting] = useState(false);
  const renderSize = interacting ? Math.min(INTERACTIVE_RESOLUTION, resolution) : resolution;

  const draw = useCallback((size = renderSize) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    const image = context.createImageData(size, size);
    const coordinates = coordinatesFor(size);
    const algorithm = ALGORITHMS[patch.algorithm];
    const carrierLevel = algorithm.carriers.reduce((sum, index) => sum + patch.operators[index].level, 0) || 1;
    const operatorState = patch.operators.map((operator) => {
      const angle = operator.angle * Math.PI / 180;
      return { ...operator, cos: Math.cos(angle), sin: Math.sin(angle), phaseOffset: operator.phase * Math.PI / 180 };
    });

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = coordinates[px];
        const y = coordinates[py];
        const values = [0, 0, 0, 0];

        for (let index = 3; index >= 0; index--) {
          const operator = operatorState[index];
          const spatialPhase = patch.base * operator.ratio * (x * operator.cos + y * operator.sin);
          const basePhase = spatialPhase + operator.phaseOffset + motionPhase * operator.ratio;
          const modulation = algorithm.inputs[index].reduce((sum, source) => sum + values[source], 0);

          if (index === 3 && patch.feedback > 0) {
            let feedbackValue = 0;
            for (let pass = 0; pass < 4; pass++) feedbackValue = wave(basePhase + feedbackValue * patch.feedback, operator.wave) * operator.level;
            values[index] = feedbackValue;
          } else {
            values[index] = wave(basePhase + modulation, operator.wave) * operator.level;
          }
        }

        const signal = algorithm.carriers.reduce((sum, index) => sum + values[index], 0) / carrierLevel;
        const band = Math.max(0, Math.min(COLORS.length - 1, Math.floor(((signal + 1) / 2) * COLORS.length)));
        const color = COLOR_VALUES[band];
        const offset = (py * size + px) * 4;
        image.data[offset] = (color >> 16) & 255;
        image.data[offset + 1] = (color >> 8) & 255;
        image.data[offset + 2] = color & 255;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }, [patch, motionPhase, renderSize]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => draw());
    return () => cancelAnimationFrame(frame);
  }, [draw]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      if (time - last > 65) { setMotionPhase((phase) => phase + 0.035); last = time; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => {
    const finishInteraction = () => setInteracting(false);
    window.addEventListener("pointerup", finishInteraction);
    window.addEventListener("pointercancel", finishInteraction);
    return () => {
      window.removeEventListener("pointerup", finishInteraction);
      window.removeEventListener("pointercancel", finishInteraction);
    };
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
    const algorithm = algorithmChoices[Math.floor(Math.random() * algorithmChoices.length)];
    const directionRoot = Math.random() * 180;
    setPatch({
      base: MIN_BASE * Math.pow(MAX_BASE / MIN_BASE, Math.random()),
      algorithm,
      feedback: Math.random() * 4.5,
      operators: Array.from({ length: 4 }, (_, index) => op(
        ratios[Math.floor(Math.random() * ratios.length)],
        ALGORITHMS[algorithm].carriers.includes(index) ? 0.75 + Math.random() * 0.65 : 1.5 + Math.random() * 4.5,
        Math.floor((directionRoot + index * (38 + Math.random() * 18) + (Math.random() - 0.5) * 16) % 180),
        Math.floor(Math.random() * WAVE_NAMES.length),
        Math.floor(Math.random() * 360),
      )),
    });
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

  return (
    <main>
      <header><div className="brand"><span /> PHASEFIELD / 4OP</div><p>Four-operator spatial FM synthesizer</p></header>
      <section ref={workspaceRef} className="workspace" style={{ "--preview-share": `${previewShare}%` } as CSSProperties}>
        <div className="visual-panel">
          <div className="visual-head"><span>ALGORITHM {patch.algorithm + 1} · {ALGORITHMS[patch.algorithm].diagram} · {interacting ? `PREVIEW ${renderSize}² → ${resolution}²` : `${resolution}²`}</span><span className={playing ? "live active" : "live"}>{playing ? "RUNNING" : "STILL"}</span></div>
          <div className="canvas-wrap"><canvas ref={canvasRef} aria-label="Four-operator FM pixel texture" /></div>
          <p className="explanation">Each operator runs across a spatial direction. Arrows route one operator&apos;s output into another operator&apos;s phase—the same role they play in an FM voice.</p>
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
          <div className="presets">{Object.entries(PRESETS).map(([name, preset]) => <button key={name} onClick={() => setPatch(clonePatch(preset))}>{name}</button>)}</div>
          <section className="global-controls">
            <label><span>Base frequency</span><output>{patch.base.toFixed(3)}</output><input type="range" min="0" max="100" step="0.25" value={baseToSlider(patch.base)} onChange={(event) => setPatch((current) => ({ ...current, base: sliderToBase(Number(event.target.value)) }))} /></label>
            <label><span>OP4 feedback</span><output>{patch.feedback.toFixed(2)}</output><input type="range" min="0" max="6" step="0.1" value={patch.feedback} onChange={(event) => setPatch((current) => ({ ...current, feedback: Number(event.target.value) }))} /></label>
            <label className="resolution-control"><span>Resolution</span><select value={resolution} onChange={(event) => setResolution(Number(event.target.value))}>{RESOLUTIONS.map((size) => <option key={size} value={size}>{size} × {size}</option>)}</select></label>
          </section>
          <div className="algorithm-grid" aria-label="FM routing algorithm">
            {ALGORITHMS.map((algorithm, index) => <button key={algorithm.diagram} className={patch.algorithm === index ? "selected" : ""} onClick={() => setPatch((current) => ({ ...current, algorithm: index }))}><b>{index + 1}</b><span>{algorithm.diagram}</span></button>)}
          </div>
          <div className="operators">
            {patch.operators.map((operator, index) => (
              <details key={index} open={index === 0}>
                <summary><b>OP{index + 1}</b><span>{ALGORITHMS[patch.algorithm].carriers.includes(index) ? "CARRIER" : "MODULATOR"}</span><em>{operator.ratio.toFixed(2)}×</em></summary>
                <div className="operator-body">
                  <label><span>Ratio</span><output>{operator.ratio.toFixed(2)}</output><input type="range" min="0.25" max="16" step="0.25" value={operator.ratio} onChange={(event) => updateOperator(index, "ratio", Number(event.target.value))} /></label>
                  <label><span>Level</span><output>{operator.level.toFixed(1)}</output><input type="range" min="0" max="8" step="0.1" value={operator.level} onChange={(event) => updateOperator(index, "level", Number(event.target.value))} /></label>
                  <label><span>Direction</span><output>{operator.angle.toFixed(0)}°</output><input type="range" min="0" max="180" step="1" value={operator.angle} onChange={(event) => updateOperator(index, "angle", Number(event.target.value))} /></label>
                  <label><span>Phase</span><output>{operator.phase.toFixed(0)}°</output><input type="range" min="0" max="360" step="1" value={operator.phase} onChange={(event) => updateOperator(index, "phase", Number(event.target.value))} /></label>
                  <fieldset className="wave-picker">
                    <legend>Waveform · exact function</legend>
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
      <footer><span>4 operators · 8 algorithms · 10 waveforms</span><span>No noise · no spatial warp · phase modulation only</span></footer>
    </main>
  );
}
