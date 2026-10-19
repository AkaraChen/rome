// Ported from RSSHub lib/routes/minecraft/java-runtime.ts (AGPL-3.0).
// Minecraft Java 运行时 — the launcher's runtime manifest, one JSON request.
// The manifest is arch -> runtime type -> list of builds; the route flattens
// it into one entry per build.

export const meta = {
  id: 'rome.rsshub-minecraft-java-runtime',
  name: 'Minecraft · Java Runtimes',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Minecraft 启动器内置 Java 运行时的更新记录',
  icon: 'https://www.minecraft.net/favicon.ico',
  params: {
    fields: [
      {
        key: 'arch',
        type: 'select',
        label: '架构',
        help: '选择要订阅的运行架构，默认为全部',
        default: 'all',
        options: [
          { value: 'all', label: '全部' },
          { value: 'gamecore', label: 'gamecore（Mojang 当前未使用）' },
          { value: 'linux', label: 'linux' },
          { value: 'linux-i386', label: 'linux-i386' },
          { value: 'mac-os', label: 'mac-os' },
          { value: 'mac-os-arm64', label: 'mac-os-arm64' },
          { value: 'windows-arm64', label: 'windows-arm64' },
          { value: 'windows-x64', label: 'windows-x64' },
          { value: 'windows-x86', label: 'windows-x86' },
        ],
      },
      {
        key: 'javaType',
        type: 'select',
        label: '运行时类型',
        help: '选择要订阅的 Java 运行时类型，默认为全部',
        default: 'all',
        options: [
          { value: 'all', label: '全部' },
          { value: 'java-runtime-alpha', label: 'java-runtime-alpha' },
          { value: 'java-runtime-beta', label: 'java-runtime-beta' },
          { value: 'java-runtime-delta', label: 'java-runtime-delta' },
          { value: 'java-runtime-gamma', label: 'java-runtime-gamma' },
          { value: 'java-runtime-gamma-snapshot', label: 'java-runtime-gamma-snapshot' },
          { value: 'jre-legacy', label: 'jre-legacy' },
          { value: 'minecraft-java-exe', label: 'minecraft-java-exe（仅 Windows）' },
        ],
      },
    ],
  },
}

const MANIFEST = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

export async function fetch(ctx) {
  const arch = String(ctx.params.arch ?? '').trim() || 'all'
  const javaType = String(ctx.params.javaType ?? '').trim() || 'all'

  ctx.log.debug(`minecraft-java-runtime: GET ${MANIFEST}`)

  const response = await ctx.fetch(MANIFEST, { headers: { accept: 'application/json' } })

  if (!response.ok) {
    throw new Error(`Minecraft 运行时清单返回 ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    throw new Error('Minecraft 运行时清单没有返回数据，接口可能已经变了')
  }

  if (arch !== 'all' && !Object.prototype.hasOwnProperty.call(data, arch)) {
    throw new Error(`不支持的架构 ${arch}：可选值为 ${Object.keys(data).join('、')}`)
  }

  const allTypes = new Set()
  for (const runtimes of Object.values(data)) {
    for (const type of Object.keys(runtimes)) allTypes.add(type)
  }

  if (javaType !== 'all' && !allTypes.has(javaType)) {
    throw new Error(`不支持的运行时类型 ${javaType}：可选值为 ${[...allTypes].join('、')}`)
  }

  const arches = arch === 'all' ? Object.keys(data) : [arch]
  const entries = []

  for (const name of arches) {
    const runtimes = data[name]
    const types = javaType === 'all' ? Object.keys(runtimes) : [javaType]

    for (const type of types) {
      const builds = Array.isArray(runtimes[type]) ? runtimes[type] : []

      for (const build of builds) {
        const version = build?.version?.name
        if (!version) continue

        const entry = {
          id: `minecraft:runtime:${name}:${type}:${version}`,
          title: `${name} ${type} 更新了 ${version}`,
          url: build.manifest?.url,
          summary: `${name} ${type} 更新了 ${version}`,
        }

        const publishedAt = Math.floor(Date.parse(build.version.released) / 1000)
        if (Number.isFinite(publishedAt)) entry.publishedAt = publishedAt

        entries.push(entry)
      }
    }
  }

  if (entries.length === 0) {
    throw new Error(`Minecraft 运行时清单里没有 ${arch} / ${javaType} 的构建`)
  }

  ctx.log.info(`minecraft-java-runtime: ${entries.length} 个运行时构建`)

  return { entries, icon: 'https://www.minecraft.net/favicon.ico' }
}
