/**
 * Shared Vec3 helpers and DCM transforms.
 *
 * Extracted from deploy-wingsuit.ts for reuse across:
 *   bridle-sim.ts, deploy-wingsuit.ts, deploy-canopy.ts
 *
 * All vectors are NED inertial unless noted otherwise.
 */

import type { Vec3 } from './deploy-types.ts'

// ─── Vec3 Arithmetic ─────────────────────────────────────────────────────────

export function v3zero(): Vec3 { return { x: 0, y: 0, z: 0 } }

export function v3add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function v3sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function v3scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s }
}

export function v3dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function v3len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

export function v3dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// ─── DCM Transforms (3-2-1 Euler: ψ → θ → φ) ───────────────────────────────

/** Body-to-inertial DCM application */
export function bodyToInertial(v: Vec3, phi: number, theta: number, psi: number): Vec3 {
  const cp = Math.cos(phi),   sp = Math.sin(phi)
  const ct = Math.cos(theta), st = Math.sin(theta)
  const cy = Math.cos(psi),   sy = Math.sin(psi)
  return {
    x: (ct*cy)*v.x + (sp*st*cy - cp*sy)*v.y + (cp*st*cy + sp*sy)*v.z,
    y: (ct*sy)*v.x + (sp*st*sy + cp*cy)*v.y + (cp*st*sy - sp*cy)*v.z,
    z: (-st)*v.x   + (sp*ct)*v.y             + (cp*ct)*v.z,
  }
}

/** Inertial-to-body DCM application (transpose of bodyToInertial) */
export function inertialToBody(v: Vec3, phi: number, theta: number, psi: number): Vec3 {
  const cp = Math.cos(phi),   sp = Math.sin(phi)
  const ct = Math.cos(theta), st = Math.sin(theta)
  const cy = Math.cos(psi),   sy = Math.sin(psi)
  return {
    x: (ct*cy)*v.x           + (ct*sy)*v.y           + (-st)*v.z,
    y: (sp*st*cy - cp*sy)*v.x + (sp*st*sy + cp*cy)*v.y + (sp*ct)*v.z,
    z: (cp*st*cy + sp*sy)*v.x + (cp*st*sy - sp*cy)*v.y + (cp*ct)*v.z,
  }
}
