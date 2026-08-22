export const PRESET_SCHEMA_VERSION = 2;

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finiteNumber(value, fallback, minimum, maximum) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function integer(value, fallback, minimum, maximum) {
  return Math.round(finiteNumber(value, fallback, minimum, maximum));
}

function boolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function hasFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    || typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}

export function migrateSavedPreset(value, options) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = objectOrEmpty(value);
  if (!source.patch || typeof source.patch !== "object" || Array.isArray(source.patch)) return null;

  const sourcePatch = objectOrEmpty(source.patch);
  const defaults = options.defaultPatch;
  const sourceOperators = Array.isArray(sourcePatch.operators) ? sourcePatch.operators : [];
  const operators = defaults.operators.map((defaultOperator, index) => {
    const sourceOperator = objectOrEmpty(sourceOperators[index]);
    const legacyTurns = hasFiniteNumber(sourceOperator.turns) ? sourceOperator.turns : sourceOperator.twist;
    return {
      ratio: finiteNumber(sourceOperator.ratio, defaultOperator.ratio, 0.25, 16),
      level: finiteNumber(sourceOperator.level, defaultOperator.level, 0, 8),
      angle: finiteNumber(sourceOperator.angle, defaultOperator.angle, 0, 180),
      wave: integer(sourceOperator.wave, defaultOperator.wave, 0, options.waveCount - 1),
      phase: finiteNumber(sourceOperator.phase, defaultOperator.phase, 0, 360),
      space: integer(sourceOperator.space, defaultOperator.space, 0, options.spatialModeCount - 1),
      radialBias: finiteNumber(sourceOperator.radialBias, defaultOperator.radialBias, -1, 1),
      orientation: finiteNumber(sourceOperator.orientation, defaultOperator.orientation, 0, 360),
      turns: integer(legacyTurns, defaultOperator.turns, -12, 12),
    };
  });

  const suppliedName = typeof source.name === "string" ? source.name.trim() : "";
  return {
    version: PRESET_SCHEMA_VERSION,
    name: suppliedName || "Recovered preset",
    patch: {
      base: finiteNumber(sourcePatch.base, defaults.base, options.minimumBase, options.maximumBase),
      algorithm: integer(sourcePatch.algorithm, defaults.algorithm, 0, options.algorithmCount - 1),
      feedback: finiteNumber(sourcePatch.feedback, defaults.feedback, 0, 6),
      animationSpeed: finiteNumber(sourcePatch.animationSpeed, defaults.animationSpeed, options.minimumAnimationSpeed, options.maximumAnimationSpeed),
      palette: integer(sourcePatch.palette, defaults.palette, 0, options.paletteCount - 1),
      trueValues: boolean(sourcePatch.trueValues, defaults.trueValues),
      operators,
    },
  };
}
