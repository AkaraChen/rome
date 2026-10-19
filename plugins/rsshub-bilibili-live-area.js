// Ported from RSSHub lib/routes/bilibili/live-area.ts (AGPL-3.0).
// 哔哩哔哩直播分区 — /bilibili/live/area/:areaID/:order
//
// Two live API calls: one names the area (the list is a tree of parent areas),
// one lists the rooms in it. Neither needs a login.
//
// The room list carries no start time, so the entry id is the room plus its
// current title — a room that changes either is a new entry, which is the same
// rule the RSSHub route documents.

export const meta = {
  id: 'rome.rsshub-bilibili-live-area',
  name: '哔哩哔哩 · 直播分区',
  version: '1.0.0',
  apiVersion: '1',
  view: 'socialMedia',
  description: '哔哩哔哩直播指定分区的人气或最新开播直播间',
  icon: 'https://www.bilibili.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'areaID',
        type: 'text',
        label: '分区 ID',
        help: '分区编号，可通过直播分区列表接口查询，例如 207',
        placeholder: '207',
        default: '',
      },
      {
        key: 'order',
        type: 'select',
        label: '排序',
        help: 'live_time 为最新开播，online 为人气',
        default: 'online',
        options: [
          { value: 'live_time', label: '最新开播' },
          { value: 'online', label: '人气' },
        ],
      },
    ],
  },
}

const API = 'https://api.live.bilibili.com/room/v1'

const ORDERS = {
  live_time: '最新开播',
  online: '人气直播',
}

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

function cover(value) {
  if (!value) return undefined
  return value.startsWith('http') ? value : `https:${value}`
}

export async function fetch(ctx) {
  const areaID = String(ctx.params.areaID || '').trim()
  const order = ORDERS[ctx.params.order] ? ctx.params.order : 'online'

  if (!/^\d+$/.test(areaID)) {
    throw new Error('请填写直播分区 ID（例如 207）')
  }

  const nameResponse = await ctx.fetch(`${API}/Area/getList`, {
    headers: { referer: 'https://link.bilibili.com/p/center/index' },
  })

  if (!nameResponse.ok) {
    throw new Error(`Bilibili 返回 ${nameResponse.status}（直播分区列表）`)
  }

  const areas = (await nameResponse.json()).data

  if (!Array.isArray(areas)) {
    throw new Error('Bilibili 没有返回直播分区列表，接口可能已经变了')
  }

  let parentTitle = ''
  let areaTitle = ''

  for (const parent of areas) {
    for (const area of parent.list || []) {
      if (String(area.id) === areaID) {
        parentTitle = parent.name
        areaTitle = area.name
      }
    }
  }

  if (!areaTitle) {
    throw new Error(`找不到直播分区 ${areaID}，分区可能已经下线`)
  }

  const url = new URL(`${API}/area/getRoomList`)
  url.searchParams.set('area_id', areaID)
  url.searchParams.set('sort_type', order)
  url.searchParams.set('page_size', '30')
  url.searchParams.set('page_no', '1')

  const response = await ctx.fetch(url, { headers: { referer: 'https://live.bilibili.com/p/eden/area-tags' } })

  if (!response.ok) {
    throw new Error(`Bilibili 返回 ${response.status}（分区 ${areaID}）`)
  }

  const rooms = (await response.json()).data

  if (!Array.isArray(rooms)) {
    throw new Error('Bilibili 没有返回直播间列表，接口可能已经变了')
  }

  const entries = rooms.map((room) => {
    const entry = {
      id: `bilibili-live:${room.roomid}:${room.title}`,
      title: `${room.uname} ${room.title}`,
      url: `https://live.bilibili.com/${room.roomid}`,
      author: room.uname,
      summary: [room.area_name, room.online ? `人气 ${room.online}` : undefined].filter(Boolean).join(' · ') || undefined,
    }

    const image = cover(room.system_cover || room.user_cover || room.cover)
    if (image) entry.image = image

    return entry
  })

  ctx.log.info(`bilibili-live: ${entries.length} 个直播间（${parentTitle}·${areaTitle}，${ORDERS[order]}）`)

  return { entries }
}
