import assert from "node:assert/strict";
import test from "node:test";
import { migrateSavedPreset, PRESET_SCHEMA_VERSION } from "../app/preset-migration.mjs";

const defaultOperator = {
  ratio: 1,
  level: 1,
  angle: 0,
  wave: 0,
  phase: 0,
  space: 0,
  radialBias: 0,
  orientation: 0,
  turns: 2,
};

const options = {
  defaultPatch: {
    base: 0.46,
    algorithm: 0,
    feedback: 0.8,
    animationSpeed: 1,
    palette: 0,
    trueValues: false,
    operators: Array.from({ length: 4 }, () => ({ ...defaultOperator })),
  },
  minimumBase: 0.03,
  maximumBase: 2,
  minimumAnimationSpeed: 0.01,
  maximumAnimationSpeed: 2,
  algorithmCount: 8,
  paletteCount: 8,
  waveCount: 10,
  spatialModeCount: 4,
};

test("migrates a legacy twist preset and supplies newer defaults", () => {
  const legacy = {
    name: "Old spiral",
    patch: {
      base: 0.2,
      algorithm: 3,
      feedback: 1.4,
      palette: 5,
      operators: [
        { ratio: 3, level: 2, angle: 45, wave: 8, phase: 90, space: 3, twist: 2.6 },
        { ratio: 2, level: 1 },
      ],
      obsoleteSetting: "ignored",
    },
  };

  const migrated = migrateSavedPreset(legacy, options);
  assert.equal(migrated.version, PRESET_SCHEMA_VERSION);
  assert.equal(migrated.name, "Old spiral");
  assert.equal(migrated.patch.animationSpeed, 1);
  assert.equal(migrated.patch.trueValues, false);
  assert.equal(migrated.patch.operators[0].turns, 3);
  assert.equal(migrated.patch.operators[0].space, 3);
  assert.equal(migrated.patch.operators.length, 4);
  assert.deepEqual(migrated.patch.operators[2], defaultOperator);
  assert.equal("obsoleteSetting" in migrated.patch, false);
});

test("repairs individual malformed fields instead of discarding the preset", () => {
  const migrated = migrateSavedPreset({
    name: "  Partial  ",
    patch: {
      base: "0.5",
      algorithm: 99,
      feedback: "broken",
      animationSpeed: 0,
      palette: -4,
      trueValues: "true",
      operators: [{ ratio: "4", wave: 99, turns: -99 }],
    },
  }, options);

  assert.equal(migrated.name, "Partial");
  assert.equal(migrated.patch.base, 0.5);
  assert.equal(migrated.patch.algorithm, 7);
  assert.equal(migrated.patch.feedback, 0.8);
  assert.equal(migrated.patch.animationSpeed, 0.01);
  assert.equal(migrated.patch.palette, 0);
  assert.equal(migrated.patch.trueValues, true);
  assert.equal(migrated.patch.operators[0].ratio, 4);
  assert.equal(migrated.patch.operators[0].wave, 9);
  assert.equal(migrated.patch.operators[0].turns, -12);
});

test("rejects only records without a usable patch object", () => {
  assert.equal(migrateSavedPreset(null, options), null);
  assert.equal(migrateSavedPreset({ name: "No patch" }, options), null);
  assert.equal(migrateSavedPreset({ name: "Bad patch", patch: [] }, options), null);
});
