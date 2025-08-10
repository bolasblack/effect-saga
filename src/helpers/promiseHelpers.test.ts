import { describe, expect, it } from 'vitest'
import { sleep } from './promiseHelpers'

describe('promiseHelpers', () => {
  describe('sleep', () => {
    it('should resolve after specified milliseconds', async () => {
      const start = Date.now()
      await sleep(50)
      const elapsed = Date.now() - start

      // Allow some tolerance for timing
      expect(elapsed).toBeGreaterThanOrEqual(45)
      expect(elapsed).toBeLessThan(100)
    })

    it('should resolve with undefined', async () => {
      const result = await sleep(10)
      expect(result).toBeUndefined()
    })

    it('should work with 0 milliseconds', async () => {
      const start = Date.now()
      await sleep(0)
      const elapsed = Date.now() - start

      // Should resolve almost immediately
      expect(elapsed).toBeLessThan(10)
    })
  })
})
