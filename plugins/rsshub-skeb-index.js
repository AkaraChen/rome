// Ported from RSSHub lib/routes/skeb/index.ts (AGPL-3.0).
/**
 * Skeb -- Works and Creators.
 *
 * skeb.jp/api is the payload the homepage itself renders from: one array per
 * section, with no key and no login. Works carry no publication date, so the
 * reader orders them by when it first saw each one.
 */

export const meta = {
  id: 'rome.rsshub-skeb-index',
  name: 'Skeb · 作品与画师',
  version: '1.0.0',
  apiVersion: '1',
  view: 'pictures',
  description: '读取 Skeb 首页的新作与热门画师列表',
  icon: 'https://skeb.jp/favicon.ico',
  params: {
    fields: [
      {
        key: 'category',
        type: 'select',
        label: '分类',
        help: '选择首页要读取的板块',
        default: 'new_art_works',
        options: [
          { value: 'new_art_works', label: '新着作品 (Illust)' },
          { value: 'new_voice_works', label: '新着作品 (Voice)' },
          { value: 'new_novel_works', label: '新着作品 (Novel)' },
          { value: 'new_video_works', label: '新着作品 (Video)' },
          { value: 'new_music_works', label: '新着作品 (Music)' },
          { value: 'new_correction_works', label: '新着作品 (Advice)' },
          { value: 'new_comic_works', label: '新着作品 (Comic)' },
          { value: 'popular_works', label: '人気の作品 (Popular)' },
          { value: 'popular_creators', label: '人気クリエイター' },
          { value: 'new_creators', label: '新着クリエイター' }
        ]
      }
    ]
  }
};

const BASE = 'https://skeb.jp'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const WORK_CATEGORIES = new Set(['new_art_works', 'new_voice_works', 'new_novel_works', 'new_video_works', 'new_music_works', 'new_correction_works', 'new_comic_works', 'popular_works'])
const GENRES = { art: 'Illust', voice: 'Voice', novel: 'Novel', video: 'Video', music: 'Music', correction: 'Advice', comic: 'Comic' }

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// Skeb serves each image at several widths; the widest is the last srcset entry.
function largestImage(image) {
  let url = image?.src || ''
  let width = 0

  for (const candidate of String(image?.srcset || '').split(',')) {
    const [candidateUrl, descriptor] = candidate.trim().split(/\s+/, 2)
    const size = descriptor ? Number(descriptor.replace(/[wx]$/, '')) : 1

    if (candidateUrl && Number.isFinite(size) && size > width) {
      url = candidateUrl
      width = size
    }
  }

  return url
}

function toWork(work) {
  if (!work || !work.path || work.private) {
    return null
  }

  const image = largestImage(work.thumbnail_image_urls)
  const body = String(work.body || '')
  const parts = []

  if (image) {
    parts.push(`<p><img src="${escapeHtml(image)}"></p>`)
  }

  if ((work.genre === 'music' || work.genre === 'voice') && work.preview_url) {
    parts.push(`<audio controls src="${escapeHtml(work.preview_url)}"></audio>`)
  }

  if (body) {
    parts.push(`<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>`)
  }

  const entry = {
    id: `skeb:${work.path}`,
    title: work.path,
    url: `${BASE}${work.path}`,
    content: parts.join('')
  }

  if (image) {
    entry.image = image
  }

  if (body) {
    entry.summary = body.slice(0, 300)
  }

  return entry
}

function toCreator(creator) {
  if (!creator || !creator.screen_name) {
    return null
  }

  const skills = Array.isArray(creator.skills) ? creator.skills.map((skill) => GENRES[skill.genre] || skill.genre).join('、') : ''
  const lines = [`接受委托：${creator.acceptable ? '是' : '否'}`, `NSFW：${creator.nsfw_acceptable ? '是' : '否'}`]

  if (skills) {
    lines.push(`类型：${skills}`)
  }

  const entry = {
    id: `skeb:@${creator.screen_name}`,
    title: creator.name || `@${creator.screen_name}`,
    url: `${BASE}/@${creator.screen_name}`,
    summary: lines.join(' · ')
  }

  if (creator.avatar_url) {
    entry.image = creator.avatar_url
    entry.content = `<p><img src="${escapeHtml(creator.avatar_url)}"></p><p>${escapeHtml(lines.join(' / '))}</p>`
  }

  return entry
}

export async function fetch(ctx) {
  const category = String(ctx.params.category || 'new_art_works')

  const response = await ctx.fetch(`${BASE}/api`, { headers: { accept: 'application/json', 'user-agent': USER_AGENT } })

  if (!response.ok) {
    throw new Error(`skeb: api returned ${response.status} ${response.statusText}`)
  }

  let data

  try {
    data = await response.json()
  } catch (error) {
    throw new Error(`skeb: api did not return JSON: ${error.message}`)
  }

  const list = data?.[category]

  if (!Array.isArray(list)) {
    throw new Error(`skeb: category ${category} is not in the api payload; the response shape changed`)
  }

  const mapper = WORK_CATEGORIES.has(category) ? toWork : toCreator
  const entries = list.map(mapper).filter(Boolean)

  if (entries.length === 0) {
    throw new Error(`skeb: category ${category} returned no entries`)
  }

  return { entries, icon: 'https://skeb.jp/favicon.ico' }
}
