export async function saveBeforeNavigation(isComposing: () => boolean, save: () => Promise<void>, navigate: () => void): Promise<void> {
  const deadline = Date.now() + 30_000
  while (isComposing()) {
    if (Date.now() >= deadline)
      throw new Error('composition_active')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await save()
  if (isComposing())
    throw new Error('composition_active')
  navigate()
}
