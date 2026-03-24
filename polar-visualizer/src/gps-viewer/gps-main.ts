/**
 * GPS Flight Viewer — Main Entry Point
 *
 * Drag-and-drop a FlySight TRACK.CSV → pipeline → charts + replay.
 */

import { processGPSFile, type PipelineResult } from '../gps/gps-pipeline'
import { buildSystemPolarTable } from './gps-polar-table'
import { GPSCharts } from './gps-charts'
import { GPSReplay } from './gps-replay'

// ─── DOM Elements ───────────────────────────────────────────────────────────

const dropZone = document.getElementById('drop-zone')!
const fileInput = document.getElementById('file-input') as HTMLInputElement
const viewerLayout = document.getElementById('viewer-layout')!
const flightInfo = document.getElementById('flight-info')!
const btnPlay = document.getElementById('btn-play')!
const scrubber = document.getElementById('scrubber') as HTMLInputElement
const timeDisplay = document.getElementById('time-display')!
const speedSelect = document.getElementById('speed-select') as HTMLSelectElement
const btnLoadNew = document.getElementById('btn-load-new')!

// ─── State ──────────────────────────────────────────────────────────────────

let charts: GPSCharts | null = null
let replay: GPSReplay | null = null
let result: PipelineResult | null = null

// ─── Drop Zone ──────────────────────────────────────────────────────────────

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  dropZone.classList.add('drag-over')
})

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over')
})

dropZone.addEventListener('drop', (e) => {
  e.preventDefault()
  dropZone.classList.remove('drag-over')
  const file = e.dataTransfer?.files[0]
  if (file) loadFile(file)
})

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) loadFile(file)
})

dropZone.addEventListener('click', () => {
  fileInput.click()
})

btnLoadNew.addEventListener('click', () => {
  viewerLayout.classList.add('hidden')
  dropZone.classList.remove('hidden')
  if (replay) replay.stop()
})

// ─── File Loading ───────────────────────────────────────────────────────────

async function loadFile(file: File) {
  flightInfo.textContent = `Loading ${file.name}...`
  dropZone.classList.add('hidden')
  viewerLayout.classList.remove('hidden')

  const text = await file.text()

  // Build polar table for AOA matching (a5segments model)
  const polarTable = buildSystemPolarTable()

  // Run pipeline
  const t0 = performance.now()
  result = processGPSFile(text, {
    polarTable,
    pilotMass: 77.5,
    sRef: 2.0,
  })
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2)

  const dur = result.duration
  const minutes = Math.floor(dur / 60)
  const seconds = (dur % 60).toFixed(1)

  flightInfo.innerHTML = [
    `<strong>${file.name}</strong>`,
    `Format: ${result.format}`,
    `Points: ${result.pointCount}`,
    `Duration: ${minutes}:${seconds.padStart(4, '0')}`,
    `Processed in ${elapsed}s`,
  ].join(' &nbsp;│&nbsp; ')

  // Initialize charts
  if (!charts) {
    charts = new GPSCharts()
  }
  charts.setData(result.points)

  // Initialize replay
  if (!replay) {
    replay = new GPSReplay(result.points, (index, t) => {
      charts?.setCursor(index)
      updateReadout(index)
      updateTransport(t, dur)
    })
  } else {
    replay.setData(result.points)
  }

  // Scrubber
  scrubber.max = String(result.points.length - 1)
  scrubber.value = '0'

  // Go to first frame
  charts.setCursor(0)
  updateReadout(0)
  updateTransport(0, dur)
}

// ─── Transport Controls ─────────────────────────────────────────────────────

btnPlay.addEventListener('click', () => {
  if (!replay) return
  if (replay.playing) {
    replay.pause()
    btnPlay.textContent = '▶'
  } else {
    replay.play()
    btnPlay.textContent = '⏸'
  }
})

scrubber.addEventListener('input', () => {
  if (!replay || !result) return
  const idx = parseInt(scrubber.value)
  replay.seekIndex(idx)
  charts?.setCursor(idx)
  updateReadout(idx)
  const t = result.points[idx]?.processed.t ?? 0
  updateTransport(t, result.duration)
})

speedSelect.addEventListener('change', () => {
  if (replay) replay.speed = parseFloat(speedSelect.value)
})

function updateTransport(t: number, duration: number) {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = (s % 60).toFixed(1)
    return `${m}:${sec.padStart(4, '0')}`
  }
  timeDisplay.textContent = `${fmt(t)} / ${fmt(duration)}`
  if (result) {
    // Update scrubber position without triggering input event
    const idx = findTimeIndex(t)
    scrubber.value = String(idx)
  }
}

function findTimeIndex(t: number): number {
  if (!result) return 0
  const pts = result.points
  // Binary search for nearest time
  let lo = 0, hi = pts.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid].processed.t < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

// ─── Readout ────────────────────────────────────────────────────────────────

const readoutEl = document.getElementById('readout')!

function updateReadout(index: number) {
  if (!result || index >= result.points.length) return
  const p = result.points[index]
  const g = p.processed
  const a = p.aero

  const ms2mph = 2.237
  const ms2kmh = 3.6
  const r2d = 180 / Math.PI

  const gammaD = Math.atan2(g.velD, Math.sqrt(g.velN ** 2 + g.velE ** 2)) * r2d
  const headingD = Math.atan2(g.velE, g.velN) * r2d
  const ld = a.cd > 0.001 ? a.cl / a.cd : 0

  readoutEl.innerHTML = `
    <div class="section">Position</div>
    <div class="row"><span class="label">Altitude</span><span class="value">${g.hMSL.toFixed(0)} m (${(g.hMSL * 3.281).toFixed(0)} ft)</span></div>
    <div class="row"><span class="label">N / E</span><span class="value">${g.posN.toFixed(0)} / ${g.posE.toFixed(0)} m</span></div>
    <div class="section">Velocity</div>
    <div class="row"><span class="label">Airspeed</span><span class="value">${g.airspeed.toFixed(1)} m/s (${(g.airspeed * ms2mph).toFixed(0)} mph)</span></div>
    <div class="row"><span class="label">Ground</span><span class="value">${g.groundSpeed.toFixed(1)} m/s (${(g.groundSpeed * ms2mph).toFixed(0)} mph)</span></div>
    <div class="row"><span class="label">Vert</span><span class="value">${(-g.velD).toFixed(1)} m/s (${(-g.velD * ms2mph).toFixed(0)} mph)</span></div>
    <div class="section">Orientation</div>
    <div class="row"><span class="label">γ (FPA)</span><span class="value">${gammaD.toFixed(1)}°</span></div>
    <div class="row"><span class="label">Heading</span><span class="value">${((headingD + 360) % 360).toFixed(1)}°</span></div>
    <div class="row"><span class="label">Bank (φ)</span><span class="value">${(a.roll * r2d).toFixed(1)}°</span></div>
    <div class="section">Aerodynamics</div>
    <div class="row"><span class="label">α (AOA)</span><span class="value">${(a.aoa * r2d).toFixed(1)}°</span></div>
    <div class="row"><span class="label">CL</span><span class="value">${a.cl.toFixed(3)}</span></div>
    <div class="row"><span class="label">CD</span><span class="value">${a.cd.toFixed(3)}</span></div>
    <div class="row"><span class="label">L/D</span><span class="value">${ld.toFixed(2)}</span></div>
    <div class="row"><span class="label">kL / kD</span><span class="value">${a.kl.toFixed(3)} / ${a.kd.toFixed(3)}</span></div>
    <div class="row"><span class="label">q̄</span><span class="value">${g.qbar.toFixed(0)} Pa</span></div>
    <div class="row"><span class="label">ρ</span><span class="value">${g.rho.toFixed(4)} kg/m³</span></div>
    <div class="row"><span class="label">AOA residual</span><span class="value">${a.aoaResidual.toFixed(4)}</span></div>
  `
}
