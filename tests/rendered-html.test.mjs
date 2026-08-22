import assert from "node:assert/strict";
import test from "node:test";

test("renders the public four-operator FM interface", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(new Request("http://localhost/"), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Phasefield 4OP/);
  assert.match(html, /four-operator FM/i);
  assert.match(html, /Linear/);
  assert.match(html, /Radial/);
  assert.match(html, /Angular/);
  assert.match(html, /Spiral/);
  assert.match(html, /Lock base frequency during randomize/);
  assert.match(html, /Lock OP1 waveform during randomize/);
  assert.match(html, /Save preset/);
  assert.match(html, /Load preset/);
  assert.equal((html.match(/<details open=""/g) ?? []).length, 4);
  assert.doesNotMatch(html, /Cascade|Alloy|Lattice|Split/);
  assert.doesNotMatch(html, /sign.?in|database|authentication/i);
});
