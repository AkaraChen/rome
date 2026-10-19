// Ported from OpenCLI clis/pypi/downloads.js (Apache-2.0).
// PyPI 下载统计 — OpenCLI's `pypi downloads` command.
//
// pypistats.org serves the download numbers as public JSON. `recent` returns
// three aggregate totals; `overall` returns one row per day. No key, no
// cookies, no browser.
//
// Ported from clis/pypi/downloads.js and utils.js.

export const meta = {
  id: 'rome.opencli-pypi-downloads',
  name: 'PyPI · 下载统计',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '查询 PyPI 包的近期或逐日下载量',
  icon: 'https://pypi.org/favicon.ico',
  params: {
    fields: [
      {
        key: 'name',
        type: 'text',
        label: '包名',
        help: 'PyPI 包名，例如 requests、pandas',
        default: '',
      },
      {
        key: 'period',
        type: 'select',
        label: '范围',
        help: 'recent 返回最近一天、一周、一月；overall 返回逐日历史',
        default: 'recent',
        options: [
          { value: 'recent', label: '近期汇总' },
          { value: 'overall', label: '逐日历史' },
        ],
      },
    ],
  },
}

const API = 'https://pypistats.org/api/packages'

// PyPI distribution names: ASCII letters / digits / "._-", with no leading or
// trailing separator.
const PACKAGE = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/

const RECENT = [
  { key: 'last_day', label: '最近 1 天' },
  { key: 'last_week', label: '最近 7 天' },
  { key: 'last_month', label: '最近 30 天' },
]

function count(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''
}

function page(name) {
  return `https://pypistats.org/packages/${encodeURIComponent(name)}`
}

function summary(value) {
  return value === null ? '暂无数据' : `${count(value)} 次下载`
}

export async function fetch(ctx) {
  const name = String(ctx.params?.name ?? '').trim()

  if (!name) {
    throw new Error('请填写 PyPI 包名，例如 requests')
  }

  if (!PACKAGE.test(name)) {
    throw new Error(`PyPI 包名 "${name}" 无效`)
  }

  const period = ctx.params?.period === 'overall' ? 'overall' : 'recent'
  const path = period === 'overall'
    ? `${API}/${encodeURIComponent(name)}/overall?mirrors=false`
    : `${API}/${encodeURIComponent(name)}/recent`

  ctx.log.debug(`opencli-pypi-downloads: GET ${path}`)

  const response = await ctx.fetch(path, {
    headers: {
      accept: 'application/json',
      'user-agent': 'rome-opencli-pypi (Rome reader plugin)',
    },
  })

  if (!response.ok) {
    throw new Error(`pypistats 返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const packageName = String(body?.package ?? name).trim()

  if (period === 'recent') {
    const data = body?.data

    if (!data || typeof data !== 'object') {
      throw new Error(`pypistats 没有返回 "${name}" 的近期下载数据`)
    }

    if (data.last_day == null && data.last_week == null && data.last_month == null) {
      throw new Error(`pypistats 没有 "${name}" 的近期下载数据`)
    }

    const entries = RECENT.map(({ key, label }) => ({
      // The metric name is pypistats' own key, so the id is stable as long as
      // the package and the requested window are.
      id: `pypi-downloads:${name}:${key}`,
      title: `${packageName} · ${label}`,
      url: page(name),
      summary: summary(data[key] != null ? Number(data[key]) : null),
      params: { name, metric: key },
    }))

    ctx.log.info(`opencli-pypi-downloads: ${entries.length} 条近期数据（${name}）`)

    return { entries }
  }

  const days = Array.isArray(body?.data) ? body.data : []

  if (days.length === 0) {
    throw new Error(`pypistats 没有 "${name}" 的逐日下载历史`)
  }

  const entries = days.map((row) => {
    const date = String(row?.date ?? '').trim()

    // The date is the row's own key; without it the entry has no stable id.
    if (!date) {
      throw new Error(`pypistats 返回了一条没有日期的记录（${name}）`)
    }

    const downloads = row.downloads != null ? Number(row.downloads) : null
    const entry = {
      id: `pypi-downloads:${name}:${date}`,
      title: `${packageName} · ${date}`,
      url: page(name),
      summary: summary(downloads),
      params: { name, date },
    }

    const publishedAt = Date.parse(`${date}T00:00:00Z`)
    if (Number.isFinite(publishedAt)) {
      entry.publishedAt = Math.floor(publishedAt / 1000)
    }

    return entry
  })

  ctx.log.info(`opencli-pypi-downloads: ${entries.length} 天（${name}）`)

  return { entries }
}
