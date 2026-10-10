import { clamp, finite, lerp } from './math.js';

function pointFromMapped(mapped, event) {
  const value = mapped && typeof mapped === 'object' && !Array.isArray(mapped) ? mapped : {};
  const x = finite(value.x, NaN);
  const y = finite(value.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const pointerType = String(value.pointerType || event.pointerType || 'mouse');
  const pressureSource = value.pressure !== undefined ? value.pressure : event.pressure;
  return {
    x,
    y,
    pressure: clamp(finite(pressureSource, pointerType === 'mouse' ? 0.5 : 0), 0, 1),
    tiltX: clamp(finite(value.tiltX !== undefined ? value.tiltX : event.tiltX, 0), -90, 90),
    tiltY: clamp(finite(value.tiltY !== undefined ? value.tiltY : event.tiltY, 0), -90, 90),
    time: finite(value.time !== undefined ? value.time : event.timeStamp, 0),
    pointerType,
    twist: ((finite(value.twist !== undefined ? value.twist : event.twist, 0) % 360) + 360) % 360,
    tangentialPressure: clamp(
      finite(value.tangentialPressure !== undefined ? value.tangentialPressure : event.tangentialPressure, 0),
      -1,
      1
    ),
    altitudeAngle: finite(value.altitudeAngle !== undefined ? value.altitudeAngle : event.altitudeAngle, Math.PI / 2),
    azimuthAngle: finite(value.azimuthAngle !== undefined ? value.azimuthAngle : event.azimuthAngle, 0)
  };
}

function getCoalescedSamples(event, mapPoint) {
  if (!event) {
    return [];
  }
  const mapper = typeof mapPoint === 'function' ? mapPoint : (source) => ({ x: source.clientX, y: source.clientY });
  let events = [event];
  if (typeof event.getCoalescedEvents === 'function') {
    try {
      const coalesced = event.getCoalescedEvents();
      if (Array.isArray(coalesced) && coalesced.length) {
        events = coalesced;
      }
    } catch {
      events = [event];
    }
  }
  const samples = [];
  for (let index = 0; index < events.length; index += 1) {
    const source = events[index];
    const mapped = mapper(source, index, event);
    const sample = pointFromMapped(mapped, source);
    if (sample) {
      samples.push(sample);
    }
  }
  return samples;
}

function stabilizeSample(session, sample, amount) {
  if (!sample || !Number.isFinite(Number(sample.x)) || !Number.isFinite(Number(sample.y))) {
    return null;
  }
  const result = {
    ...sample,
    x: Number(sample.x),
    y: Number(sample.y),
    pressure: clamp(finite(sample.pressure, 0.5), 0, 1),
    tiltX: clamp(finite(sample.tiltX, 0), -90, 90),
    tiltY: clamp(finite(sample.tiltY, 0), -90, 90),
    time: finite(sample.time, 0),
    pointerType: String(sample.pointerType || 'mouse')
  };
  if (!session || typeof session !== 'object') {
    return result;
  }

  const strength = clamp(finite(amount, 0), 0, 1);
  let state = session.__whiteboardBrushStabilizer;
  if (!state) {
    state = {
      rawX: result.x,
      rawY: result.y,
      x: result.x,
      y: result.y,
      pressure: result.pressure,
      tiltX: result.tiltX,
      tiltY: result.tiltY,
      time: result.time
    };
    session.__whiteboardBrushStabilizer = state;
    return result;
  }

  const dt = clamp(result.time - state.time || 8, 1, 32);
  const rawSpeed = Math.hypot(result.x - state.rawX, result.y - state.rawY) / dt;
  const positionTau = strength < 0.001 ? 0 : (3 + 78 * strength * strength) / (1 + rawSpeed * 0.55);
  const pressureTau = strength < 0.001 ? 0 : 4 + 34 * strength * strength;
  const tiltTau = strength < 0.001 ? 0 : 5 + 42 * strength * strength;
  const positionAlpha = positionTau ? 1 - Math.exp(-dt / positionTau) : 1;
  const pressureAlpha = pressureTau ? 1 - Math.exp(-dt / pressureTau) : 1;
  const tiltAlpha = tiltTau ? 1 - Math.exp(-dt / tiltTau) : 1;

  state.x = lerp(state.x, result.x, positionAlpha);
  state.y = lerp(state.y, result.y, positionAlpha);
  state.pressure = lerp(state.pressure, result.pressure, pressureAlpha);
  state.tiltX = lerp(state.tiltX, result.tiltX, tiltAlpha);
  state.tiltY = lerp(state.tiltY, result.tiltY, tiltAlpha);
  state.rawX = result.x;
  state.rawY = result.y;
  state.time = result.time;

  return {
    ...result,
    x: state.x,
    y: state.y,
    pressure: state.pressure,
    tiltX: state.tiltX,
    tiltY: state.tiltY
  };
}

export { getCoalescedSamples, pointFromMapped, stabilizeSample };
