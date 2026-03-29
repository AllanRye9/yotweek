/**
 * Sound notification utilities using the Web Audio API.
 * All functions are no-ops when audio is unavailable (e.g. browser policy, SSR).
 */

/** Play a single sine tone through a fresh AudioContext. */
function playTone(ctx, freq, startAt, duration, volume = 0.25) {
  const osc  = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, startAt)
  gain.gain.setValueAtTime(volume, startAt)
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration)
  osc.start(startAt)
  osc.stop(startAt + duration)
}

function makeCtx() {
  // eslint-disable-next-line no-undef
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  const ctx = new Ctor()
  // Some browsers start suspended; resume on user-gesture context
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** Two ascending beeps — played when a download starts. */
export function playStartSound() {
  try {
    const ctx = makeCtx()
    if (!ctx) return
    const t = ctx.currentTime
    playTone(ctx, 440, t,        0.12)
    playTone(ctx, 660, t + 0.14, 0.12)
    setTimeout(() => ctx.close().catch(() => {}), 600)
  } catch (_) {}
}

/** Three ascending chime notes — played when a download completes. */
export function playCompleteSound() {
  try {
    const ctx = makeCtx()
    if (!ctx) return
    const t = ctx.currentTime
    playTone(ctx, 523, t,        0.15)
    playTone(ctx, 659, t + 0.17, 0.15)
    playTone(ctx, 784, t + 0.34, 0.25, 0.3)
    setTimeout(() => ctx.close().catch(() => {}), 1000)
  } catch (_) {}
}

/** Two descending beeps — played when a download fails. */
export function playErrorSound() {
  try {
    const ctx = makeCtx()
    if (!ctx) return
    const t = ctx.currentTime
    playTone(ctx, 400, t,        0.18, 0.22)
    playTone(ctx, 280, t + 0.20, 0.22, 0.22)
    setTimeout(() => ctx.close().catch(() => {}), 700)
  } catch (_) {}
}

/** Urgent rising pulse — played when a driver nearby alert arrives. */
export function playDriverAlertSound() {
  try {
    const ctx = makeCtx()
    if (!ctx) return
    const t = ctx.currentTime
    playTone(ctx, 600, t,        0.10, 0.30)
    playTone(ctx, 800, t + 0.12, 0.10, 0.30)
    playTone(ctx, 600, t + 0.28, 0.10, 0.30)
    playTone(ctx, 800, t + 0.40, 0.12, 0.32)
    setTimeout(() => ctx.close().catch(() => {}), 900)
  } catch (_) {}
}

/** Positive two-note chime — played when a ride is marked as taken. */
export function playRideTakenSound() {
  try {
    const ctx = makeCtx()
    if (!ctx) return
    const t = ctx.currentTime
    playTone(ctx, 523, t,        0.14)
    playTone(ctx, 784, t + 0.16, 0.20, 0.28)
    setTimeout(() => ctx.close().catch(() => {}), 800)
  } catch (_) {}
}

/** Short cheerful ding — played when a new ride is posted. */
export function playNewRideSound() {
  try {
    const ctx = makeCtx()
    if (!ctx) return
    const t = ctx.currentTime
    playTone(ctx, 660, t,        0.10, 0.20)
    playTone(ctx, 880, t + 0.12, 0.10, 0.20)
    setTimeout(() => ctx.close().catch(() => {}), 600)
  } catch (_) {}
}

/** Gentle three-note ascending chime — played when a new message or notification arrives. */
export function playMessageChime() {
  try {
    const ctx = makeCtx()
    if (!ctx) return
    const t = ctx.currentTime
    playTone(ctx, 523, t,        0.12, 0.18)
    playTone(ctx, 659, t + 0.14, 0.12, 0.18)
    playTone(ctx, 784, t + 0.28, 0.14, 0.22)
    setTimeout(() => ctx.close().catch(() => {}), 900)
  } catch (_) {}
}
