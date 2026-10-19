// Ported from RSSHub lib/routes/smzdm/ranking.ts (AGPL-3.0).
// SMZDM — the shopping leaderboards.
//
// Three path segments, all of them options rather than free text. The API
// answers with a list of rows, each row holding a left and a right entry, so
// the rows are flattened before the entries are built.
//
// Special case: when the requested span is three hours, the site serves some
// rank ids only over two or four hours, and answers an empty list otherwise.

export const meta = {
  id: 'rome.rsshub-smzdm-ranking',
  name: '什么值得买 · 排行榜',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '什么值得买好价、海淘、好文与好物排行榜',
  icon: 'https://www.smzdm.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'rank_type',
        type: 'select',
        label: '榜单类型',
        help: '榜单所属的大类',
        default: '',
        options: [
          { value: 'pinlei', label: '好价品类榜' },
          { value: 'dianshang', label: '好价电商榜' },
          { value: 'haitao', label: '海淘 TOP 榜' },
          { value: 'haowen', label: '好文排行榜' },
          { value: 'haowu', label: '好物排行榜' },
        ],
      },
      {
        key: 'rank_id',
        type: 'select',
        label: '榜单 ID',
        help: '要订阅的具体榜单',
        default: '',
        options: [
          { value: '11', label: '好价品类榜-全部' },
          { value: '12', label: '好价品类榜-食品生鲜' },
          { value: '13', label: '好价品类榜-电脑数码' },
          { value: '14', label: '好价品类榜-运动户外' },
          { value: '15', label: '好价品类榜-家用电器' },
          { value: '17', label: '好价品类榜-白菜' },
          { value: '74', label: '好价品类榜-服饰鞋包' },
          { value: '75', label: '好价品类榜-日用百货' },
          { value: '24', label: '好价电商榜-券活动' },
          { value: '23', label: '好价电商榜-京东' },
          { value: '25', label: '好价电商榜-天猫' },
          { value: '26', label: '好价电商榜-亚马逊中国' },
          { value: '27', label: '好价电商榜-国美在线' },
          { value: '28', label: '好价电商榜-苏宁易购' },
          { value: '29', label: '好价电商榜-网易' },
          { value: '30', label: '好价电商榜-西集网' },
          { value: '31', label: '好价电商榜-美国亚马逊' },
          { value: '32', label: '好价电商榜-日本亚马逊' },
          { value: '33', label: '好价电商榜-ebay' },
          { value: '39', label: '海淘 TOP 榜-全部' },
          { value: '34', label: '海淘 TOP 榜-海外直邮' },
          { value: '35', label: '海淘 TOP 榜-美国榜' },
          { value: '36', label: '海淘 TOP 榜-欧洲榜' },
          { value: '37', label: '海淘 TOP 榜-澳新榜' },
          { value: '38', label: '海淘 TOP 榜-亚洲榜' },
          { value: 'hsw', label: '海淘 TOP 榜-晒物榜' },
          { value: 'yc', label: '好文排行榜-原创' },
          { value: 'zx', label: '好文排行榜-资讯' },
          { value: 'hwall', label: '好物排行榜-新晋榜' },
          { value: 'zc', label: '好物排行榜-消费众测' },
          { value: 'nb', label: '好物排行榜-新锐品牌' },
          { value: 'hw', label: '好物排行榜-好物榜单' },
        ],
      },
      {
        key: 'hour',
        type: 'select',
        label: '时间跨度',
        help: '榜单统计的时间范围',
        default: '',
        options: [
          { value: '3', label: '3 小时' },
          { value: '12', label: '12 小时' },
          { value: '24', label: '24 小时' },
        ],
      },
    ],
  },
}

const API = 'https://www.smzdm.com/top/json_more'
const TWO_HOUR = ['11', '17', '28', '29']
const FOUR_HOUR = ['12', '13', '14', '15', '17', '74', '75', '71', '25']

// A three-hour request for some rank ids is answered only over two or four
// hours; asking for three returns an empty list.
function trueHour(rankType, rankId, hour) {
  const applies = (rankType === 'pinlei' || rankType === 'dianshang') &&
    (TWO_HOUR.includes(rankId) || FOUR_HOUR.includes(rankId)) &&
    hour === '3'
  if (!applies) return hour
  return TWO_HOUR.includes(rankId) ? '2' : '4'
}

function strip(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function fetch(ctx) {
  const rankType = String(ctx.params.rank_type || '').trim()
  const rankId = String(ctx.params.rank_id || '').trim()
  const hour = String(ctx.params.hour || '').trim()

  if (!rankType || !rankId || !hour) {
    throw new Error('请选择榜单类型、榜单 ID 和时间跨度')
  }

  const query = new URLSearchParams({
    rank_type: rankType,
    rank_id: rankId,
    hour: trueHour(rankType, rankId, hour),
  })

  const response = await ctx.fetch(`${API}?${query}`, {
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      referer: 'https://www.smzdm.com/top',
    },
  })

  if (!response.ok) {
    throw new Error(`什么值得买返回 ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  const rows = payload?.data?.list

  if (!Array.isArray(rows)) {
    throw new Error('什么值得买排行榜接口结构已变化')
  }

  // Each row holds two products; a row may leave one of them empty.
  const items = []
  for (const row of rows.slice(0, 6)) {
    if (!Array.isArray(row)) continue
    for (const item of row.slice(0, 2)) {
      if (item && item.article_title) items.push(item)
    }
  }

  if (items.length === 0) {
    throw new Error('什么值得买排行榜没有返回条目')
  }

  const entries = items.map((item) => ({
    id: `smzdm:ranking:${item.article_id || item.article_url}`,
    title: `${strip(item.article_title)} - ${strip(item.article_price || '')}`.trim(),
    url: item.article_url,
    summary: strip(item.article_price || ''),
    image: item.article_pic,
  }))

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null
  const content = await ctx.article(url)
  return content === null ? null : { content }
}
