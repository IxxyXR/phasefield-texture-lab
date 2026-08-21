"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Operator = { ratio: number; level: number; angle: number; wave: number; phase: number };
type Patch = { base: number; algorithm: number; feedback: number; operators: Operator[] };
type Algorithm = { diagram: string; inputs: number[][]; carriers: number[] };

const SIZE = 1024;
const TAU = Math.PI * 2;
const MIN_BASE = 0.03;
const MAX_BASE = 2;
const COLORS = ["#15121a", "#7d2449", "#ef4b23", "#f2b84b", "#eee9df"];
const COLOR_VALUES = COLORS.map((hex) => Number.parseInt(hex.slice(1), 16));
const COORDINATES = Float64Array.from({ length: SIZE }, (_, position) => (position / SIZE - 0.5) * TAU);
const WAVE_NAMES = ["Sine", "Half +", "Absolute", "Fold", "Odd pair", "Double", "Square", "Soft clip"];

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

function wave(phase: number, shape: number) {
  const s = Math.sin(phase);
  switch (shape) {
    case 1: return Math.max(0, s) * 2 - 0.5;
    case 2: return Math.abs(s) * 2 - 1;
    case 3: return s * Math.abs(s);
    case 4: return (s + 0.5 * Math.sin(2 * phase)) / 1.5;
    case 5: return Math.sin(2 * phase);
    case 6: return s >= 0 ? 0.85 : -0.85;
    case 7: return Math.tanh(2.4 * s);
    default: return s;
  }
}

function clonePatch(patch: Patch): Patch {
  return { ...patch, operators: patch.operators.map((operator) => ({ ...operator })) };
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [patch, setPatch] = useState(() => clonePatch(PRESETS.Cascade));
  const [playing, setPlaying] = useState(false);
  const [motionPhase, setMotionPhase] = useState(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    const image = context.createImageData(SIZE, SIZE);
    const algorithm = ALGORITHMS[patch.algorithm];
    const carrierLevel = algorithm.carriers.reduce((sum, index) => sum + patch.operators[index].level, 0) || 1;
    const operatorState = patch.operators.map((operator) => {
      const angle = operator.angle * Math.PI / 180;
      return { ...operator, cos: Math.cos(angle), sin: Math.sin(angle), phaseOffset: operator.phase * Math.PI / 180 };
    });

    for (let py = 0; py < SIZE; py++) {
      for (let px = 0; px < SIZE; px++) {
        const x = COORDINATES[px];
        const y = COORDINATES[py];
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
        const offset = (py * SIZE + px) * 4;
        image.data[offset] = (color >> 16) & 255;
        image.data[offset + 1] = (color >> 8) & 255;
        image.data[offset + 2] = color & 255;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }, [patch, motionPhase]);

  useEffect(() => {
    const frame = requestAnimationFrame(draw);
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

  const updateOperator = (index: number, key: keyof Operator, value: number) => {
    setPatch((current) => ({ ...current, operators: current.operators.map((operator, position) => position === index ? { ...operator, [key]: value } : operator) }));
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
    const link = document.createElement("a");
    link.download = `phasefield-algorithm-${patch.algorithm + 1}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <main>
      <header><div className="brand"><span /> PHASEFIELD / 4OP</div><p>Four-operator spatial FM synthesizer</p></header>
      <section className="workspace">
        <div className="visual-panel">
          <div className="visual-head"><span>ALGORITHM {patch.algorithm + 1} · {ALGORITHMS[patch.algorithm].diagram} · {SIZE}²</span><span className={playing ? "live active" : "live"}>{playing ? "RUNNING" : "STILL"}</span></div>
          <div className="canvas-wrap"><canvas ref={canvasRef} aria-label="Four-operator FM pixel texture" /></div>
          <p className="explanation">Each operator runs across a spatial direction. Arrows route one operator&apos;s output into another operator&apos;s phase—the same role they play in an FM voice.</p>
        </div>

        <aside className="controls">
          <div className="presets">{Object.entries(PRESETS).map(([name, preset]) => <button key={name} onClick={() => setPatch(clonePatch(preset))}>{name}</button>)}</div>
          <section className="global-controls">
            <label><span>Base frequency</span><output>{patch.base.toFixed(3)}</output><input type="range" min="0" max="100" step="0.25" value={baseToSlider(patch.base)} onChange={(event) => setPatch((current) => ({ ...current, base: sliderToBase(Number(event.target.value)) }))} /></label>
            <label><span>OP4 feedback</span><output>{patch.feedback.toFixed(2)}</output><input type="range" min="0" max="6" step="0.1" value={patch.feedback} onChange={(event) => setPatch((current) => ({ ...current, feedback: Number(event.target.value) }))} /></label>
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
                  <label className="wave-select"><span>Waveform</span><select value={operator.wave} onChange={(event) => updateOperator(index, "wave", Number(event.target.value))}>{WAVE_NAMES.map((name, waveIndex) => <option key={name} value={waveIndex}>{waveIndex + 1} · {name}</option>)}</select></label>
                </div>
              </details>
            ))}
          </div>
          <div className="actions"><button className="primary" onClick={randomize}>Random patch</button><button onClick={() => setPlaying((value) => !value)}>{playing ? "Freeze" : "Animate"}</button><button onClick={download}>Save PNG</button></div>
        </aside>
      </section>
      <footer><span>4 operators · 8 algorithms · 8 waveforms</span><span>No noise · no spatial warp · phase modulation only</span></footer>
    </main>
  );
}
