import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveGpsEngine } from '../geo/adaptive-gps.js';
import { resolveMotionHeading } from '../geo/motion-heading.js';
import { findRadarReferences, selectRadarDisplay } from '../ui/radar-summary.js';

test('GPS parado por três minutos conserva referência sem inventar direção e expira se as leituras cessam', () => {
  const engine = new AdaptiveGpsEngine();
  const radar = { id: 'near', lat: -23.549, lng: -46.63, active: true, limit: 50 };
  let previous = null, position;
  for (let elapsed = 0; elapsed <= 180000; elapsed += 6000) {
    const now = 1000000 + elapsed;
    const fix = engine.processRawFix({ latitude: -23.55, longitude: -46.63,
      accuracy: 6, speed: 0, heading: null }, now);
    assert.equal(fix.accepted, true);
    position = { ...fix, ...resolveMotionHeading(fix, previous) };
    assert.equal(position.heading, null);
    const display = selectRadarDisplay({ tracking: true, position, now: now + 5999,
      references: findRadarReferences(position, [radar]) });
    assert.equal(display.mode, 'reference');
    assert.equal(display.radar.limit, 50);
    assert.equal(display.radar.alertEligible, false);
    assert.ok(display.radar.distance > 110 && display.radar.distance < 112);
    previous = position;
  }
  assert.equal(engine.currentMode, 'STOPPED');
  const references = findRadarReferences(position, [radar]);
  assert.equal(selectRadarDisplay({ tracking: true, position, references,
    now: position.timestamp + 90001 }).mode, 'stale');
  const resumed = engine.processRawFix({ latitude: position.lat, longitude: position.lng,
    accuracy: 6, speed: 0, heading: null }, position.timestamp + 96000);
  assert.equal(resumed.accepted, true);
  assert.equal(selectRadarDisplay({ tracking: true, position: resumed, references,
    now: resumed.timestamp }).mode, 'reference');
});
