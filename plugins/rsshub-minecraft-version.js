// Ported from RSSHub lib/routes/minecraft/version.ts (AGPL-3.0).
// Minecraft Java 版更新 — the official version manifest, one JSON request.
// The manifest is newest-first and carries every version ever published; the
// feed keeps the most recent 100 rather than the whole history.

export const meta = {
  id: 'rome.rsshub-minecraft-version',
  name: 'Minecraft · Java Game Update',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Minecraft Java 版正式版、快照与旧版本的更新记录',
  icon: 'https://www.minecraft.net/favicon.ico',
  params: {
    fields: [
      {
        key: 'versionType',
        type: 'select',
        label: '版本类型',
        help: '选择要订阅的版本类型，默认为全部',
        default: 'all',
        options: [
          { value: 'all', label: '全部' },
          { value: 'release', label: '正式版' },
          { value: 'snapshot', label: '快照' },
          { value: 'old_alpha', label: 'Alpha 及更早的版本' },
          { value: 'old_beta', label: 'Beta 版' },
        ],
      },
      {
        key: 'linkType',
        type: 'select',
        label: '链接指向',
        help: '条目的链接指向哪里，默认为 minecraft.net',
        default: 'official',
        options: [
          { value: 'official', label: 'minecraft.net' },
          { value: 'enwiki', label: '英文 Minecraft Wiki 版本页' },
          { value: 'zhwiki', label: '中文 Minecraft Wiki 版本页' },
        ],
      },
    ],
  },
}

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const LIMIT = 100

const TYPE_NAMES = {
  release: '正式版',
  snapshot: '快照',
  old_alpha: 'Alpha 及更早的版本',
  old_beta: 'Beta 版',
}

// The wiki pages are not titled by the raw version id, so each type gets the
// prefix the wiki actually uses.
function enwiki(item) {
  let id = item.id

  if (item.type === 'old_beta' && id.startsWith('b')) id = `Beta ${id.slice(1)}`
  if (item.type === 'old_alpha') {
    if (id.startsWith('a')) id = `Alpha ${id.slice(1)}`
    else if (id.startsWith('c')) id = `Classic ${id.slice(1)}`
    else if (id.startsWith('inf-')) id = 'Infdev'
    else if (id.startsWith('rd-')) id = `pre-Classic ${id}`
  }

  return `https://minecraft.wiki/w/${encodeURIComponent(id).replace(/%20/g, '_')}`
}

function zhwiki(item) {
  let id = item.id

  if (item.type === 'release') id = `Java版${id}`
  if (item.type === 'old_beta' && id.startsWith('b')) id = `Java版Beta ${id.slice(1)}`
  if (item.type === 'old_alpha') {
    if (id.startsWith('a')) id = `Java版Alpha ${id.slice(1)}`
    else if (id.startsWith('c')) id = `Java版Classic ${id.slice(1)}`
    else if (id.startsWith('inf-')) id = 'Java版Infdev'
    else if (id.startsWith('rd-')) id = `Java版pre-Classic ${id}`
  }

  return `https://zh.minecraft.wiki/w/${encodeURIComponent(id).replace(/%20/g, '_')}`
}

const LINKERS = {
  official: () => 'https://www.minecraft.net',
  enwiki,
  zhwiki,
}

export async function fetch(ctx) {
  const versionType = String(ctx.params.versionType ?? '').trim() || 'all'
  const linkType = String(ctx.params.linkType ?? '').trim() || 'official'

  if (versionType !== 'all' && !Object.prototype.hasOwnProperty.call(TYPE_NAMES, versionType)) {
    throw new Error(`不支持的版本类型 ${versionType}：可选值为 all、release、snapshot、old_alpha、old_beta`)
  }

  const linker = LINKERS[linkType] || LINKERS.official

  ctx.log.debug(`minecraft-version: GET ${MANIFEST}`)

  const response = await ctx.fetch(MANIFEST, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Minecraft 版本清单返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const versions = Array.isArray(body?.versions) ? body.versions : []

  if (versions.length === 0) {
    throw new Error('Minecraft 版本清单没有返回版本，接口可能已经变了')
  }

  const selected = (versionType === 'all' ? versions : versions.filter((item) => item.type === versionType)).slice(0, LIMIT)

  const entries = selected.map((item) => {
    const name = TYPE_NAMES[item.type] || ''
    const entry = {
      id: `minecraft:version:${item.type}:${item.id}`,
      title: `${item.id} ${name}更新`,
      url: linker(item),
      summary: `${item.id} ${name}更新`,
    }

    const publishedAt = Math.floor(Date.parse(item.releaseTime) / 1000)
    if (Number.isFinite(publishedAt)) entry.publishedAt = publishedAt

    return entry
  })

  if (entries.length === 0) {
    throw new Error(`Minecraft 版本清单里没有 ${versionType} 类型的版本`)
  }

  ctx.log.info(`minecraft-version: ${versionType} ${entries.length} 个版本`)

  return { entries, icon: 'https://www.minecraft.net/favicon.ico' }
}
