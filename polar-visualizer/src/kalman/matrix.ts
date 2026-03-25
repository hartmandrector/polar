/**
 * matrix.ts — Lightweight dense matrix operations for Kalman filtering.
 * Ported from /mnt/c/dev/kalman/src/matrix.ts with minor cleanup.
 * All matrices are number[][] (row-major).
 */

export function createIdentityMatrix(size: number): number[][] {
  const m: number[][] = []
  for (let i = 0; i < size; i++) {
    m[i] = new Array(size).fill(0)
    m[i][i] = 1
  }
  return m
}

export function createZeroMatrix(rows: number, cols: number): number[][] {
  const m: number[][] = []
  for (let i = 0; i < rows; i++) {
    m[i] = new Array(cols).fill(0)
  }
  return m
}

export function matrixMultiply(A: number[][], B: number[][]): number[][] {
  const rows = A.length
  const cols = B[0].length
  const common = B.length
  const R = createZeroMatrix(rows, cols)
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      for (let k = 0; k < common; k++)
        R[i][j] += A[i][k] * B[k][j]
  return R
}

export function matrixVectorMultiply(A: number[][], v: number[]): number[] {
  const rows = A.length
  const cols = A[0].length
  const r = new Array(rows).fill(0)
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      r[i] += A[i][j] * v[j]
  return r
}

export function matrixAdd(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((val, j) => val + B[i][j]))
}

export function matrixSubtract(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((val, j) => val - B[i][j]))
}

export function transpose(A: number[][]): number[][] {
  const rows = A.length
  const cols = A[0].length
  const T = createZeroMatrix(cols, rows)
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      T[j][i] = A[i][j]
  return T
}

export function matrixInverse(A: number[][]): number[][] {
  const n = A.length
  // Augmented matrix [A | I]
  const aug: number[][] = A.map((row, i) => {
    const r = [...row]
    for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0)
    return r
  })

  for (let col = 0; col < n; col++) {
    // Partial pivot
    let maxRow = col
    let maxVal = Math.abs(aug[col][col])
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(aug[row][col])
      if (v > maxVal) { maxVal = v; maxRow = row }
    }
    if (maxRow !== col) {
      const tmp = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = tmp
    }

    const pivot = aug[col][col]
    if (Math.abs(pivot) < 1e-12) {
      // Singular — return identity as fallback (same behavior as original)
      return createIdentityMatrix(n)
    }

    // Scale pivot row
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot

    // Eliminate column
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = aug[row][col]
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j]
    }
  }

  // Extract inverse
  return aug.map(row => row.slice(n))
}

/** Scale every element of matrix by scalar */
export function matrixScale(A: number[][], s: number): number[][] {
  return A.map(row => row.map(val => val * s))
}
