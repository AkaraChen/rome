// Ported from RSSHub lib/routes/minecraft/blockedservers.ts (AGPL-3.0).
// Minecraft Java 版被阻止的服务器域名散列 — Mojang publishes a plain-text
// list, one SHA-1 hash per line. There is no page behind an entry, so it
// carries no url.

export const meta = {
  id: 'rome.rsshub-minecraft-blockedservers',
  name: 'Minecraft · Java Blocked Servers',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Minecraft Java 版中被 Mojang 阻止的服务器域名散列',
  icon: 'https://www.minecraft.net/favicon.ico',
}

const LIST = 'https://sessionserver.mojang.com/blockedservers'

export async function fetch(ctx) {
  ctx.log.debug(`minecraft-blockedservers: GET ${LIST}`)

  const response = await ctx.fetch(LIST, { headers: { accept: 'text/plain' } })

  if (!response.ok) {
    throw new Error(`Mojang 会话服务器返回 ${response.status} ${response.statusText}`)
  }

  const hashes = (await response.text())
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (hashes.length === 0) {
    throw new Error('Mojang 没有返回被阻止的服务器散列，接口可能已经变了')
  }

  const entries = hashes.map((hash) => ({
    // The hash is the whole identity; the list has no other key.
    id: `minecraft:blocked:${hash}`,
    title: hash,
    summary: `域名散列 ${hash} 被阻止`,
  }))

  ctx.log.info(`minecraft-blockedservers: ${entries.length} 条`)

  return { entries, icon: 'https://www.minecraft.net/favicon.ico' }
}
