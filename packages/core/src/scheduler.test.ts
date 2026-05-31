import { describe, expect, test } from 'bun:test'
import { createScheduler, Scheduler } from './scheduler.js'

describe('Scheduler.resolveGroup', () => {
  test('returns default when no rules match', () => {
    const s = new Scheduler({ default: 4 })
    expect(s.resolveGroup({ label: 'anything' }, null)).toBe('default')
  })

  test('matches exact label', () => {
    const s = new Scheduler({ rules: [{ group: 'g', label: 'planner' }] })
    expect(s.resolveGroup({ label: 'planner' }, null)).toBe('g')
    expect(s.resolveGroup({ label: 'other' }, null)).toBe('default')
  })

  test('matches labelPrefix', () => {
    const s = new Scheduler({ rules: [{ group: 'heavy', labelPrefix: 'heavy:' }] })
    expect(s.resolveGroup({ label: 'heavy:case-1' }, null)).toBe('heavy')
    expect(s.resolveGroup({ label: 'light' }, null)).toBe('default')
  })

  test('matches phase, falling back to currentPhase', () => {
    const s = new Scheduler({ rules: [{ group: 'r', phase: 'review' }] })
    expect(s.resolveGroup({ phase: 'review' }, null)).toBe('r')
    expect(s.resolveGroup({}, 'review')).toBe('r')
    expect(s.resolveGroup({}, 'plan')).toBe('default')
  })

  test('matches agentType and model', () => {
    const s = new Scheduler({
      rules: [
        { group: 'jt', agentType: 'judge' },
        { group: 'mt', model: 'opus' },
      ],
    })
    expect(s.resolveGroup({ agentType: 'judge' }, null)).toBe('jt')
    expect(s.resolveGroup({ model: 'opus' }, null)).toBe('mt')
  })

  test('first matching rule wins', () => {
    const s = new Scheduler({
      rules: [
        { group: 'first', labelPrefix: 'x:' },
        { group: 'second', labelPrefix: 'x:' },
      ],
    })
    expect(s.resolveGroup({ label: 'x:1' }, null)).toBe('first')
  })

  test('createScheduler is equivalent to new Scheduler', () => {
    const s = createScheduler({ rules: [{ group: 'g', label: 'a' }] })
    expect(s.resolveGroup({ label: 'a' }, null)).toBe('g')
  })
})

describe('Scheduler.acquire (gate)', () => {
  test('serializes a group limited to 1', async () => {
    const s = new Scheduler({ groups: { solo: 1 } })
    let active = 0
    let maxActive = 0
    const work = async () => {
      const release = await s.acquire('solo')
      active++
      maxActive = Math.max(maxActive, active)
      await tick()
      active--
      release()
    }
    await Promise.all([work(), work(), work(), work()])
    expect(maxActive).toBe(1)
  })

  test('allows up to the group limit concurrently', async () => {
    const s = new Scheduler({ groups: { pair: 2 } })
    let active = 0
    let maxActive = 0
    const work = async () => {
      const release = await s.acquire('pair')
      active++
      maxActive = Math.max(maxActive, active)
      await tick()
      active--
      release()
    }
    await Promise.all([work(), work(), work(), work()])
    expect(maxActive).toBe(2)
  })

  test('unconfigured group uses unbounded default', async () => {
    const s = new Scheduler()
    let active = 0
    let maxActive = 0
    const work = async () => {
      const release = await s.acquire('default')
      active++
      maxActive = Math.max(maxActive, active)
      await tick()
      active--
      release()
    }
    await Promise.all(Array.from({ length: 5 }, work))
    expect(maxActive).toBe(5)
  })

  test('release is idempotent and frees exactly one waiter', async () => {
    const s = new Scheduler({ groups: { solo: 1 } })
    const r1 = await s.acquire('solo')
    let secondAcquired = false
    const p = s.acquire('solo').then((r) => {
      secondAcquired = true
      return r
    })
    await tick()
    expect(secondAcquired).toBe(false) // blocked behind r1
    r1()
    r1() // idempotent — must not over-release
    const r2 = await p
    expect(secondAcquired).toBe(true)
    r2()
  })

  test('rejects an invalid (non-positive) group limit', () => {
    const s = new Scheduler({ groups: { bad: 0 } })
    expect(s.acquire('bad')).rejects.toThrow(/positive integer/)
  })
})

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1))
}
