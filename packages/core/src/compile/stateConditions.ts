import type { StateDecl } from '../document/index.ts'
import type { HtmlNode } from './html.ts'

// A condition is a reference into a reduced, ordered multi-valued decision
// diagram. Negating a reference complements it; a non-NO condition has a witness.
export const YES = 1,
  NO = -YES
export class StateAnalysisLimit extends Error {}
const MAX_WORK = 32_768

export class StateConditions {
  private variables = new Map<HtmlNode, Map<string, number>>()
  private nextVariable = 0
  private decisions: { variable: number; edges: number[] }[] = []
  private unique = new Map<string, number>()
  private pairs = new Map<string, number>()
  private work = 0

  // Bound both allocation and previously unseen intersections. Each decision
  // branches only on one relevant holder's declared values (at most 16).
  private spend() {
    if (++this.work > MAX_WORK) throw new StateAnalysisLimit()
  }

  private decision(variable: number, edges: number[]): number {
    if (edges.every(e => e === edges[0])) return edges[0]
    const sign = Math.sign(edges[0])
    const normalized = sign === 1 ? edges : edges.map(e => -e)
    const key = `${variable}:${normalized.join(',')}`
    let ref = this.unique.get(key)
    if (ref === undefined) {
      this.spend()
      ref = this.decisions.push({ variable, edges: normalized }) + 1
      this.unique.set(key, ref)
    }
    return sign * ref
  }

  equals(holder: HtmlNode, decl: StateDecl, value: string): number {
    const values = decl.values === 'on-off' ? ['on', 'off'] : decl.values
    if (!values.includes(value)) return NO
    let names = this.variables.get(holder)
    if (!names) {
      names = new Map()
      this.variables.set(holder, names)
    }
    let variable = names.get(decl.name)
    if (variable === undefined) {
      variable = this.nextVariable++
      names.set(decl.name, variable)
    }
    return this.decision(
      variable,
      values.map(v => (v === value ? YES : NO)),
    )
  }

  and(a: number, b: number): number {
    if (a === NO || b === NO || a === -b) return NO
    if (a === YES || a === b) return b
    if (b === YES) return a
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    const known = this.pairs.get(key)
    if (known !== undefined) return known
    this.spend()
    const x = this.decisions[Math.abs(a) - 2],
      y = this.decisions[Math.abs(b) - 2]
    const first = x.variable <= y.variable ? x : y
    const edges = first.edges.map((_, i) =>
      this.and(
        x.variable === first.variable ? Math.sign(a) * x.edges[i] : a,
        y.variable === first.variable ? Math.sign(b) * y.edges[i] : b,
      ),
    )
    const result = this.decision(first.variable, edges)
    this.pairs.set(key, result)
    return result
  }

  or(a: number, b: number) {
    return -this.and(-a, -b)
  }

  /** A CSS declaration wins over its predecessor wherever its selector matches. */
  override(previous: number, guard: number, value: boolean) {
    return value ? this.or(previous, guard) : this.and(previous, -guard)
  }
}
