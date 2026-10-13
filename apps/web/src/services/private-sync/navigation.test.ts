import { afterEach, expect, it, vi } from 'vitest'
import { saveBeforeNavigation } from './navigation'

afterEach(() => vi.useRealTimers())
it('doesNotNavigateAfterSaveFailure', async () => {
  const navigate = vi.fn()
  await expect(saveBeforeNavigation(() => false, async () => { throw new Error('quota') }, navigate)).rejects.toThrow('quota')
  expect(navigate).not.toHaveBeenCalled()
})
it('waitsForCompositionBeforeSavingAndNavigating', async () => {
  vi.useFakeTimers()
  let composing = true
  const save = vi.fn(async () => {})
  const navigate = vi.fn()
  const pending = saveBeforeNavigation(() => composing, save, navigate)
  await vi.advanceTimersByTimeAsync(100)
  expect(save).not.toHaveBeenCalled()
  composing = false
  await vi.advanceTimersByTimeAsync(50)
  await pending
  expect(navigate).toHaveBeenCalledTimes(1)
})
