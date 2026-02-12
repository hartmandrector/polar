/**
 * UI controls — reads slider/dropdown values and provides a typed state object.
 */

export interface FlightState {
  alpha_deg: number
  beta_deg: number
  delta: number
  dirty: number     // 0–1: dirty flying (wingsuit efficiency loss)
  airspeed: number   // m/s
  rho: number        // kg/m³
  polarKey: string   // 'aurafive' | 'ibexul' | 'slicksin'
  modelType: 'wingsuit' | 'canopy' | 'skydiver' | 'airplane'
  frameMode: 'body' | 'inertial'
  showLegacy: boolean
  // 3-2-1 Euler attitude angles (deg)
  roll_deg: number   // φ  — bank angle
  pitch_deg: number  // θ  — body pitch (distinct from α)
  yaw_deg: number    // ψ  — heading
  attitudeMode: 'body' | 'wind'
  showMassOverlay: boolean
  showAccelArcs: boolean
  canopyPilotType: 'wingsuit' | 'slick'
}

export type StateChangeCallback = (state: FlightState) => void

const POLAR_TO_MODEL: Record<string, 'wingsuit' | 'canopy' | 'skydiver' | 'airplane'> = {
  aurafive: 'wingsuit',
  ibexul: 'canopy',
  slicksin: 'skydiver',
  caravan: 'airplane'
}

export function setupControls(onChange: StateChangeCallback): FlightState {
  const alphaSlider = document.getElementById('alpha-slider') as HTMLInputElement
  const betaSlider = document.getElementById('beta-slider') as HTMLInputElement
  const deltaSlider = document.getElementById('delta-slider') as HTMLInputElement
  const dirtySlider = document.getElementById('dirty-slider') as HTMLInputElement
  const airspeedSlider = document.getElementById('airspeed-slider') as HTMLInputElement
  const rhoSlider = document.getElementById('rho-slider') as HTMLInputElement
  const polarSelect = document.getElementById('polar-select') as HTMLSelectElement
  const frameSelect = document.getElementById('frame-select') as HTMLSelectElement
  const showLegacy = document.getElementById('show-legacy') as HTMLInputElement
  const canopyPilotSelect = document.getElementById('canopy-pilot-select') as HTMLSelectElement

  const rollSlider = document.getElementById('roll-slider') as HTMLInputElement
  const pitchSlider = document.getElementById('pitch-slider') as HTMLInputElement
  const yawSlider = document.getElementById('yaw-slider') as HTMLInputElement
  const attitudeModeCheck = document.getElementById('attitude-mode') as HTMLInputElement
  const showMassOverlayCheck = document.getElementById('show-mass-overlay') as HTMLInputElement
  const showAccelArcsCheck = document.getElementById('show-accel-arcs') as HTMLInputElement

  const alphaLabel = document.getElementById('alpha-value')!
  const betaLabel = document.getElementById('beta-value')!
  const deltaLabel = document.getElementById('delta-value')!
  const dirtyLabel = document.getElementById('dirty-value')!
  const airspeedLabel = document.getElementById('airspeed-value')!
  const rhoLabel = document.getElementById('rho-value')!
  const rollLabel = document.getElementById('roll-value')!
  const pitchLabel = document.getElementById('pitch-value')!
  const yawLabel = document.getElementById('yaw-value')!

  function readState(): FlightState {
    const alpha = parseFloat(alphaSlider.value)
    const beta = parseFloat(betaSlider.value)
    const delta = parseFloat(deltaSlider.value) / 100
    const dirty = parseFloat(dirtySlider.value) / 100
    const airspeed = parseFloat(airspeedSlider.value)
    const rho = parseFloat(rhoSlider.value) / 1000
    const polarKey = polarSelect.value
    const modelType = POLAR_TO_MODEL[polarKey] || 'wingsuit'
    const frameMode = frameSelect.value as 'body' | 'inertial'
    const canopyPilotType = (canopyPilotSelect?.value || 'wingsuit') as 'wingsuit' | 'slick'
    const roll = parseFloat(rollSlider.value)
    const pitch = parseFloat(pitchSlider.value)
    const yaw = parseFloat(yawSlider.value)
    const attitudeMode = attitudeModeCheck.checked ? 'wind' as const : 'body' as const

    alphaLabel.textContent = `${alpha.toFixed(1)}°`
    betaLabel.textContent = `${beta.toFixed(1)}°`
    deltaLabel.textContent = delta.toFixed(2)
    dirtyLabel.textContent = dirty.toFixed(2)
    airspeedLabel.textContent = `${airspeed.toFixed(1)} m/s`
    rhoLabel.textContent = `${rho.toFixed(3)} kg/m³`
    rollLabel.textContent = `${roll.toFixed(1)}°`
    pitchLabel.textContent = `${pitch.toFixed(1)}°`
    yawLabel.textContent = `${yaw.toFixed(1)}°`

    // Show/hide attitude sliders based on frame mode
    const attitudeGroup = document.getElementById('attitude-group')
    if (attitudeGroup) {
      attitudeGroup.style.display = frameMode === 'inertial' ? '' : 'none'
    }

    // Show/hide canopy pilot dropdown based on polar
    const canopyPilotGroup = document.getElementById('canopy-pilot-group')
    if (canopyPilotGroup) {
      canopyPilotGroup.style.display = modelType === 'canopy' ? '' : 'none'
    }

    // Update slider labels based on attitude mode
    const rollLabelEl = document.getElementById('roll-label')
    const pitchLabelEl = document.getElementById('pitch-label')
    const yawLabelEl = document.getElementById('yaw-label')
    const attHeader = document.getElementById('attitude-header')
    if (attitudeMode === 'wind') {
      if (rollLabelEl) rollLabelEl.textContent = 'φ_w (Wind Roll): '
      if (pitchLabelEl) pitchLabelEl.textContent = 'θ_w (Wind Pitch): '
      if (yawLabelEl) yawLabelEl.textContent = 'ψ_w (Wind Yaw): '
      if (attHeader) attHeader.textContent = 'Wind Direction (Euler 3-2-1)'
    } else {
      if (rollLabelEl) rollLabelEl.textContent = 'φ (Roll): '
      if (pitchLabelEl) pitchLabelEl.textContent = 'θ (Pitch): '
      if (yawLabelEl) yawLabelEl.textContent = 'ψ (Yaw): '
      if (attHeader) attHeader.textContent = 'Attitude (Euler 3-2-1)'
    }

    return {
      alpha_deg: alpha,
      beta_deg: beta,
      delta,
      dirty,
      airspeed,
      rho,
      polarKey,
      modelType,
      frameMode,
      showLegacy: showLegacy.checked,
      roll_deg: roll,
      pitch_deg: pitch,
      yaw_deg: yaw,
      attitudeMode,
      showMassOverlay: showMassOverlayCheck.checked,
      showAccelArcs: showAccelArcsCheck.checked,
      canopyPilotType,
    }
  }

  function onInput() {
    onChange(readState())
  }

  // When polar changes, reset delta/dirty
  polarSelect.addEventListener('change', () => {
    deltaSlider.value = '0'
    dirtySlider.value = '0'
    onInput()
  })

  // All continuous controls
  for (const el of [alphaSlider, betaSlider, deltaSlider, dirtySlider, airspeedSlider, rhoSlider, rollSlider, pitchSlider, yawSlider]) {
    el.addEventListener('input', onInput)
  }

  // Discrete selects
  for (const el of [frameSelect]) {
    el.addEventListener('change', onInput)
  }

  canopyPilotSelect.addEventListener('change', onInput)

  showLegacy.addEventListener('change', onInput)
  attitudeModeCheck.addEventListener('change', onInput)
  showMassOverlayCheck.addEventListener('change', onInput)
  showAccelArcsCheck.addEventListener('change', onInput)

  // Return initial state
  return readState()
}
