"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Params = { carrier: number; modulator: number; index: number; warp: number; angle: number; contrast: number; pixels: number; palette: number; seed: number };

const palettes = [
  ["#120f18", "#ff4f19", "#ffc857", "#f5efe2"],
  ["#081c15", "#1b4332", "#74c69d", "#d8f3dc"],
  ["#13111c", "#3a0ca3", "#f72585", "#4cc9f0"],
  ["#101010", "#e8e8e8", "#777777", "#ffffff"],
  ["#0b132b", "#1c2541", "#5bc0be", "#f4d35e"],
];

const presets: Record<string, Partial<Params>> = {
  Ripple: { carrier: 6, modulator: 3, index: 7.2, warp: 1.2, angle: 18, contrast: 1.45, palette: 0 },
  Weave: { carrier: 12, modulator: 8, index: 4.8, warp: 2.8, angle: 45, contrast: 1.8, palette: 1 },
  Cells: { carrier: 4, modulator: 11, index: 9.4, warp: 4.2, angle: 72, contrast: 2.2, palette: 2 },
  Signal: { carrier: 17, modulator: 5, index: 2.7, warp: 0.8, angle: 4, contrast: 2.6, palette: 3 },
};

const initial: Params = { carrier: 8, modulator: 5, index: 6.4, warp: 2.1, angle: 28, contrast: 1.65, pixels: 176, palette: 0, seed: 38 };

function noise(x: number, y: number, seed: number) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [params, setParams] = useState(initial);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = params.pixels;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const image = ctx.createImageData(size, size);
    const colors = palettes[params.palette].map((hex) => {
      const value = Number.parseInt(hex.slice(1), 16);
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    });
    const a = (params.angle * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = (px / size - 0.5) * Math.PI * 2;
        const y = (py / size - 0.5) * Math.PI * 2;
        const u = x * ca - y * sa;
        const v = x * sa + y * ca;
        const radial = Math.hypot(x, y);
        const mod = Math.sin(params.modulator * v + Math.cos(params.warp * u - phase) * 2.2);
        const cross = Math.cos(params.modulator * u - Math.sin(params.warp * v + phase) * 1.7);
        const grain = noise(Math.floor(px / 2), Math.floor(py / 2), params.seed) * 0.12;
        const signal = Math.sin(params.carrier * (u + Math.sin(radial * params.warp) * 0.08) + params.index * mod + cross + phase);
        const shaped = Math.tanh((signal + grain) * params.contrast);
        const band = Math.max(0, Math.min(3, Math.floor(((shaped + 1) / 2) * 4)));
        const color = colors[band];
        const i = (py * size + px) * 4;
        image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2]; image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [params, phase]);

  useEffect(() => draw(), [draw]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      if (time - last > 70) { setPhase((value) => value + 0.055); last = time; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const setValue = (key: keyof Params, value: number) => setParams((current) => ({ ...current, [key]: value }));
  const randomize = () => setParams((current) => ({
    ...current,
    carrier: Math.floor(2 + Math.random() * 18), modulator: Math.floor(2 + Math.random() * 14),
    index: Number((1 + Math.random() * 10).toFixed(1)), warp: Number((0.3 + Math.random() * 5).toFixed(1)),
    angle: Math.floor(Math.random() * 90), contrast: Number((1 + Math.random() * 2).toFixed(2)),
    palette: Math.floor(Math.random() * palettes.length), seed: Math.random() * 1000,
  }));
  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `phasefield-${params.seed.toFixed(0)}.png`; link.href = canvas.toDataURL("image/png"); link.click();
  };
  const controls: Array<[keyof Params, string, number, number, number]> = [
    ["carrier", "Carrier", 1, 24, 1], ["modulator", "Modulator", 1, 18, 1], ["index", "FM index", 0, 12, 0.1],
    ["warp", "Field warp", 0, 6, 0.1], ["angle", "Direction", 0, 90, 1], ["contrast", "Threshold", 0.5, 3.5, 0.05],
  ];

  return (
    <main>
      <header><div className="brand"><span className="brand-dot" /> PHASEFIELD</div><p>2D frequency modulation laboratory</p></header>
      <section className="workspace">
        <div className="visual-panel">
          <div className="visual-head"><span>OUTPUT / {params.pixels}²</span><span className={playing ? "live active" : "live"}>{playing ? "MOTION ON" : "STILL"}</span></div>
          <div className="canvas-wrap"><canvas ref={canvasRef} aria-label="Generated pixel pattern" /><span className="corner c1" /><span className="corner c2" /><span className="corner c3" /><span className="corner c4" /></div>
          <div className="formula">sin(c·u + i·sin(m·v + warp(u)))</div>
        </div>
        <aside className="controls">
          <div className="preset-row">{Object.entries(presets).map(([name, values]) => <button key={name} onClick={() => setParams((p) => ({ ...p, ...values }))}>{name}</button>)}</div>
          <div className="knobs">
            {controls.map(([key, label, min, max, step]) => (
              <label key={key}><span>{label}</span><output>{Number(params[key]).toFixed(step < 1 ? 1 : 0)}</output>
                <input type="range" min={min} max={max} step={step} value={params[key]} onChange={(event) => setValue(key, Number(event.target.value))} />
              </label>
            ))}
          </div>
          <div className="palette-control"><span>Palette</span><div className="palettes">
            {palettes.map((palette, index) => <button key={palette.join("")} aria-label={`Select palette ${index + 1}`} aria-pressed={params.palette === index} className={params.palette === index ? "selected" : ""} onClick={() => setValue("palette", index)}>{palette.map((color) => <i key={color} style={{ background: color }} />)}</button>)}
          </div></div>
          <div className="actions"><button className="primary" onClick={randomize}>New field</button><button onClick={() => setPlaying((value) => !value)}>{playing ? "Freeze" : "Animate"}</button><button onClick={download}>Save PNG</button></div>
        </aside>
      </section>
      <footer><p>Not a waveform. A frequency relationship mapped across a plane.</p><span>SEED {params.seed.toFixed(0).padStart(3, "0")}</span></footer>
    </main>
  );
}
