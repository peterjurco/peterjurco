import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteOrphanedImages } from '../src/lib/media/cleanup'
import { deleteObject } from '../src/lib/media/r2'

vi.mock('../src/lib/media/r2', () => ({
  deleteObject: vi.fn().mockResolvedValue(undefined),
}))

const ENV = {}

afterEach(() => {
  vi.mocked(deleteObject).mockReset().mockResolvedValue(undefined)
})

describe('deleteOrphanedImages', () => {
  it('deletes every key in the array', async () => {
    await deleteOrphanedImages(ENV, ['a', 'b', 'c'])
    expect(deleteObject).toHaveBeenCalledTimes(3)
    expect(deleteObject).toHaveBeenCalledWith(ENV, 'a')
    expect(deleteObject).toHaveBeenCalledWith(ENV, 'b')
    expect(deleteObject).toHaveBeenCalledWith(ENV, 'c')
  })

  it('does nothing for an empty array — the single-key callers pass key ? [key] : []', async () => {
    await deleteOrphanedImages(ENV, [])
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('never throws when a delete fails — logs and continues with the rest', async () => {
    vi.mocked(deleteObject)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('R2 unreachable'))
      .mockResolvedValueOnce(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      deleteOrphanedImages(ENV, ['a', 'b', 'c']),
    ).resolves.toBeUndefined()
    expect(deleteObject).toHaveBeenCalledTimes(3)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to delete orphaned R2 object b'),
      expect.any(Error),
    )

    consoleError.mockRestore()
  })
})
