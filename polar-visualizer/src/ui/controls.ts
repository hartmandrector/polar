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
  const modelSelect = document.getElementById('model-select') as HTMLSelectElement
  const frameSelect = document.getElementById('frame-select') as HTMLSelectElement
  const showLegacy = document.getElementById('show-legacy') as HTMLInputElement

  const alphaLabel = document.getElementById('alpha-value')!
  const betaLabel = document.getElementById('beta-value')!
  const deltaLabel = document.getElementById('delta-value')!
  const dirtyLabel = document.getElementById('dirty-value')!
  const airspeedLabel = document.getElementById('airspeed-value')!
  const rhoLabel = document.getElementById('rho-value')!

  function readState(): FlightState {
    const alpha = parseFloat(alphaSlider.value)
    const beta = parseFloat(betaSlider.value)
    const delta = parseFloat(deltaSlider.value) / 100
    const dirty = parseFloat(dirtySlider.value) / 100
    const airspeed = parseFloat(airspeedSlider.value)
    const rho = parseFloat(rhoSlider.value) / 1000
    const polarKey = polarSelect.value
    const modelType = modelSelect.value as 'wingsuit' | 'canopy' | 'skydiver'
    const frameMode = frameSelect.value as 'body' | 'inertial'

    alphaLabel.textContent = `${alpha.toFixed(1)}°`
    betaLabel.textContent = `${beta.toFixed(1)}°`
    deltaLabel.textContent = delta.toFixed(2)
    dirtyLabel.textContent = dirty.toFixed(2)
    airspeedLabel.textContent = `${airspeed.toFixed(1)} m/s`
    rhoLabel.textContent = `${rho.toFixed(3)} kg/m³`

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
      showLegacy: showLegacy.checked
    }
  }

  function onInput() {
    onChange(readState())
  }

  // When polar changes, auto-select the matching model and reset delta
  polarSelect.addEventListener('change', () => {
    const key = polarSelect.value
    if (POLAR_TO_MODEL[key]) {
      modelSelect.value = POLAR_TO_MODEL[key]
    }
    deltaSlider.value = '0'
    dirtySlider.value = '0'
    onInput()
  })

  // All continuous controls
  for (const el of [alphaSlider, betaSlider, deltaSlider, dirtySlider, airspeedSlider, rhoSlider]) {
    el.addEventListener('input', onInput)
  }

  // Discrete selects
  for (const el of [modelSelect, frameSelect]) {
    el.addEventListener('change', onInput)
  }

  showLegacy.addEventListener('change', onInput)

  // Return initial state
  return readState()
}
