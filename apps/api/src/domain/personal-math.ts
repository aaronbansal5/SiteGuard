// Small, dependency-free statistics used by the worker-only personal insights.
// See docs/RECOVERY_MODEL.md. Every function is pure and deterministic.
import { median } from "./analytics.js";

export { median };

/** Median absolute deviation from the median (unscaled). */
export function mad(values: number[]): number | null {
  const m = median(values);
  if (m === null) return null;
  return median(values.map((v) => Math.abs(v - m)));
}

/**
 * Robust z-score of `x` against `history`:
 * (x - median) / max(consistency * MAD, minScale).
 * `minScale` keeps near-identical histories from turning tiny differences
 * into large scores; it must be positive.
 */
export function robustZ(
  x: number,
  history: number[],
  minScale: number,
  consistency = 1.4826,
): { median: number; mad: number; scale: number; z: number } | null {
  if (!(minScale > 0)) throw new RangeError("minScale must be positive");
  const m = median(history),
    d = mad(history);
  if (m === null || d === null) return null;
  const scale = Math.max(consistency * d, minScale);
  return { median: m, mad: d, scale, z: (x - m) / scale };
}

/**
 * Theil–Sen slope: the median of pairwise slopes (y_j - y_i) / (x_j - x_i)
 * over all pairs with distinct x. Robust to up to ~29% outlying points.
 */
export function theilSen(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length) throw new RangeError("Length mismatch");
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++)
      if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  return median(slopes);
}

/** Solves A x = b by Gaussian elimination with partial pivoting. */
export function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => {
    if (row.length !== n) throw new RangeError("Matrix must be square");
    return [...row, b[i]];
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) throw new RangeError("Singular");
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

export interface RidgeModel {
  means: number[];
  scales: number[];
  intercept: number;
  coefficients: number[];
}

/**
 * Closed-form ridge regression on standardized features with an unpenalized
 * intercept: beta = (Z'Z + lambda I)^-1 Z'(y - mean(y)), intercept = mean(y).
 * Features with zero spread are left at scale 1 (they then centre to zero and
 * receive a zero coefficient).
 */
export function ridgeFit(X: number[][], y: number[], lambda: number) {
  if (!X.length || X.length !== y.length)
    throw new RangeError("Need matching, non-empty X and y");
  if (!(lambda > 0)) throw new RangeError("lambda must be positive");
  const n = X.length,
    p = X[0].length;
  const means = Array.from(
    { length: p },
    (_, j) => X.reduce((s, r) => s + r[j], 0) / n,
  );
  const scales = means.map((mu, j) => {
    const sd = Math.sqrt(X.reduce((s, r) => s + (r[j] - mu) ** 2, 0) / n);
    return sd > 1e-12 ? sd : 1;
  });
  const Z = X.map((r) => r.map((v, j) => (v - means[j]) / scales[j]));
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  const yc = y.map((v) => v - ybar);
  const A = Array.from({ length: p }, (_, i) =>
    Array.from(
      { length: p },
      (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? lambda : 0),
    ),
  );
  const b = Array.from({ length: p }, (_, i) =>
    Z.reduce((s, r, k) => s + r[i] * yc[k], 0),
  );
  return {
    means,
    scales,
    intercept: ybar,
    coefficients: solve(A, b),
  } satisfies RidgeModel;
}

export function ridgePredict(model: RidgeModel, x: number[]) {
  return x.reduce(
    (s, v, j) =>
      s + model.coefficients[j] * ((v - model.means[j]) / model.scales[j]),
    model.intercept,
  );
}

/**
 * Leave-one-out mean absolute error. `fitPredict(trainIdx, testIdx)` returns
 * the prediction for `testIdx` from a model fitted without it.
 */
export function looMae(
  n: number,
  fitPredict: (train: number[], test: number) => number,
  actual: (i: number) => number,
) {
  if (n < 2) throw new RangeError("LOO needs at least two observations");
  let total = 0;
  for (let i = 0; i < n; i++) {
    const train = Array.from({ length: n }, (_, k) => k).filter((k) => k !== i);
    total += Math.abs(fitPredict(train, i) - actual(i));
  }
  return total / n;
}

export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
