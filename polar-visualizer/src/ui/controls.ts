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
  // ── Euler rates (deg/s) ──
  phiDot_degps: number    // φ̇ — roll Euler rate
  thetaDot_degps: number  // θ̇ — pitch Euler rate
  psiDot_degps: number    // ψ̇ — yaw Euler rate
  // ── Canopy asymmetric controls ──
  canopyControlMode: 'brakes' | 'fronts' | 'rears'
  canopyLeftHand: number    // 0–1
  canopyRightHand: number   // 0–1
  canopyWeightShift: number // -1 to +1
  pilotPitch: number        // pilot body pitch relative to canopy [deg]
  deploy: number            // canopy deployment fraction: 0 = line stretch, 1 = fully deployed
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

  // Euler rate sliders
  const phiDotSlider = document.getElementById('phi-dot-slider') as HTMLInputElement
  const thetaDotSlider = document.getElementById('theta-dot-slider') as HTMLInputElement
  const psiDotSlider = document.getElementById('psi-dot-slider') as HTMLInputElement
  const phiDotLabel = document.getElementById('phi-dot-value')!
  const thetaDotLabel = document.getElementById('theta-dot-value')!
  const psiDotLabel = document.getElementById('psi-dot-value')!

  // Canopy asymmetric controls
  const leftHandSlider = document.getElementById('left-hand-slider') as HTMLInputElement
  const rightHandSlider = document.getElementById('right-hand-slider') as HTMLInputElement
  const weightShiftSlider = document.getElementById('weight-shift-slider') as HTMLInputElement
  const pilotPitchSlider = document.getElementById('pilot-pitch-slider') as HTMLInputElement
  const deploySlider = document.getElementById('deploy-slider') as HTMLInputElement
  const canopyModeRadios = document.querySelectorAll<HTMLInputElement>('input[name="canopy-mode"]')

  const leftHandLabel = document.getElementById('left-hand-value')!
  const rightHandLabel = document.getElementById('right-hand-value')!
  const leftHandNameLabel = document.getElementById('left-hand-label')!
  const rightHandNameLabel = document.getElementById('right-hand-label')!
  const weightShiftLabel = document.getElementById('weight-shift-value')!
  const pilotPitchLabel = document.getElementById('pilot-pitch-value')!
  const deployLabel = document.getElementById('deploy-value')!

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

    // Canopy asymmetric controls
    const canopyControlMode = (document.querySelector<HTMLInputElement>('input[name="canopy-mode"]:checked')?.value || 'brakes') as 'brakes' | 'fronts' | 'rears'
    const canopyLeftHand = parseFloat(leftHandSlider.value) / 100
    const canopyRightHand = parseFloat(rightHandSlider.value) / 100
    const canopyWeightShift = parseFloat(weightShiftSlider.value) / 100
    const pilotPitch = parseFloat(pilotPitchSlider.value)
    const deploy = parseFloat(deploySlider.value) / 100

    const roll = parseFloat(rollSlider.value)
    const pitch = parseFloat(pitchSlider.value)
    const yaw = parseFloat(yawSlider.value)
    const attitudeMode = attitudeModeCheck.checked ? 'wind' as const : 'body' as const

    // Euler rates (deg/s)
    const phiDot = parseFloat(phiDotSlider.value)
    const thetaDot = parseFloat(thetaDotSlider.value)
    const psiDot = parseFloat(psiDotSlider.value)

    alphaLabel.textContent = `${alpha.toFixed(1)}°`
    betaLabel.textContent = `${beta.toFixed(1)}°`
    deltaLabel.textContent = delta.toFixed(2)
    dirtyLabel.textContent = dirty.toFixed(2)
    airspeedLabel.textContent = `${airspeed.toFixed(1)} m/s`
    rhoLabel.textContent = `${rho.toFixed(3)} kg/m³`
    rollLabel.textContent = `${roll.toFixed(1)}°`
    pitchLabel.textContent = `${pitch.toFixed(1)}°`
    yawLabel.textContent = `${yaw.toFixed(1)}°`

    // Euler rate labels
    phiDotLabel.textContent = `${phiDot}°/s`
    thetaDotLabel.textContent = `${thetaDot}°/s`
    psiDotLabel.textContent = `${psiDot}°/s`

    // Canopy control labels — update based on mode
    leftHandLabel.textContent = `${(canopyLeftHand * 100).toFixed(0)}%`
    rightHandLabel.textContent = `${(canopyRightHand * 100).toFixed(0)}%`
    weightShiftLabel.textContent = `${(canopyWeightShift * 100).toFixed(0)}`
    pilotPitchLabel.textContent = `${pilotPitch.toFixed(0)}°`
    deployLabel.textContent = `${(deploy * 100).toFixed(0)}%`
    const modeNames = { brakes: 'Brake', fronts: 'Front Riser', rears: 'Rear Riser' }
    leftHandNameLabel.textContent = `Left ${modeNames[canopyControlMode]}: `
    rightHandNameLabel.textContent = `Right ${modeNames[canopyControlMode]}: `

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

    // Show/hide canopy controls group based on polar
    const canopyControlsGroup = document.getElementById('canopy-controls-group')
    if (canopyControlsGroup) {
      canopyControlsGroup.style.display = modelType === 'canopy' ? '' : 'none'
    }

    // ── Delta slider: relabel as "Unzip" in canopy+wingsuit mode ──
    const deltaLabelEl = document.getElementById('delta-label')
    const deltaGroup = document.getElementById('delta-group')
    const isCanopyWingsuit = modelType === 'canopy' && canopyPilotType === 'wingsuit'
    if (deltaLabelEl) {
      deltaLabelEl.textContent = isCanopyWingsuit ? 'Unzip' : 'δ (Control)'
    }
    if (isCanopyWingsuit) {
      // Unzip: 0–100 (0 = zipped, 100 = unzipped)
      deltaSlider.min = '0'
      deltaSlider.max = '100'
    } else {
      deltaSlider.min = '-100'
      deltaSlider.max = '100'
    }
    // Hide delta slider entirely for canopy+slick (no unzip, no δ use)
    if (deltaGroup) {
      deltaGroup.style.display = (modelType === 'canopy' && canopyPilotType === 'slick') ? 'none' : ''
    }

    // ── Hide dirty slider in canopy mode (segments handle everything) ──
    const dirtyGroup = document.getElementById('dirty-group')
    if (dirtyGroup) {
      dirtyGroup.style.display = modelType === 'canopy' ? 'none' : ''
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
      phiDot_degps: phiDot,
      thetaDot_degps: thetaDot,
      psiDot_degps: psiDot,
      canopyControlMode,
      canopyLeftHand,
      canopyRightHand,
      canopyWeightShift,
      pilotPitch,
      deploy,
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
  for (const el of [alphaSlider, betaSlider, deltaSlider, dirtySlider, airspeedSlider, rhoSlider, rollSlider, pitchSlider, yawSlider, leftHandSlider, rightHandSlider, weightShiftSlider, pilotPitchSlider, deploySlider, phiDotSlider, thetaDotSlider, psiDotSlider]) {
    el.addEventListener('input', onInput)
  }

  // Canopy mode radio buttons
  for (const radio of canopyModeRadios) {
    radio.addEventListener('change', onInput)
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
