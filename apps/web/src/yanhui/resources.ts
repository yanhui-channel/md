import avatar from './avatar.png?inline'
import publicSample from './sample.public.md?raw'

// Local samples are optional and gitignored; clean checkouts use public examples.
const localAssets = import.meta.glob<{ avatar: string, images: Record<string, string> }>('./assets.json', { eager: true, import: 'default' })
const localSamples = import.meta.glob<string>('./sample.md', { eager: true, query: '?raw', import: 'default' })

export const assets = localAssets['./assets.json'] ?? { avatar, images: {} as Record<string, string> }
export const sample = localSamples['./sample.md'] ?? publicSample
export const sampleTitle = localSamples['./sample.md'] ? 'Jev 接入实践（排版试用副本）' : '衍辉 channel 排版示例'
