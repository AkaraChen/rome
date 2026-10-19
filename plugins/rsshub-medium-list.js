// Ported from RSSHub lib/routes/medium/list.ts (AGPL-3.0).
// Medium List — the public catalog GraphQL query.
//
// A list is a catalog, and Medium's lite client reads it with one GraphQL
// request. No cookie is sent; public lists answer without one. The upstream
// route asks only for `mediumUrl` and then fetches every article page, which is
// both slow and the reason its previews are sometimes blocked. This port asks
// the same query for title, author and publication time as well, so the
// listing is complete and preview only runs when a reader opens a post.
//
// The operation name and client headers are part of Medium's contract; the
// server uses them to pick the schema and the response shape.

export const meta = {
  id: 'rome.rsshub-medium-list',
  name: 'Medium · List',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: 'Medium 某个公开 List 中的文章',
  icon: 'https://medium.com/favicon.ico',
  params: {
    fields: [
      {
        key: 'user',
        type: 'text',
        label: '用户名',
        help: 'List 所属用户的 Medium 用户名，例如 imsingee',
        default: '',
      },
      {
        key: 'catalogId',
        type: 'text',
        label: 'List ID',
        help: 'List 地址最后一段，例如 collection-7e67004f23f9 中的 7e67004f23f9',
        default: '',
      },
    ],
  },
}

const QUERY = `query UserCatalogMainContentQuery($catalogId: ID!, $pagingOptions: CatalogPagingOptionsInput!) {
  catalogById(catalogId: $catalogId) {
    __typename
    ... on Catalog {
      name
      itemsConnection(pagingOptions: $pagingOptions) {
        items {
          entity {
            ... on Post {
              mediumUrl
              title
              firstPublishedAt
              creator { name }
            }
          }
          __typename
        }
        __typename
      }
    }
  }
}`

function seconds(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return Math.floor(number > 1e12 ? number / 1000 : number)
}

export async function fetch(ctx) {
  const user = String(ctx.params.user ?? '').trim().replace(/^@/, '')
  const catalogId = String(ctx.params.catalogId ?? '').trim()

  if (!user) {
    throw new Error('缺少用户名：请填写 List 所属用户的 Medium 用户名')
  }

  if (!catalogId) {
    throw new Error('缺少 List ID：请填写 List 地址最后一段，例如 7e67004f23f9')
  }

  ctx.log.debug(`medium-list: POST https://medium.com/_/graphql (${catalogId})`)

  const response = await ctx.fetch('https://medium.com/_/graphql', {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      'apollographql-client-name': 'lite',
      'apollographql-client-version': 'main-20240329-011934-2370d8b72b',
      'medium-frontend-app': 'lite/main-20240329-011934-2370d8b72b',
      'medium-frontend-path': '/',
      'medium-frontend-route': 'homepage',
    },
    body: JSON.stringify([{
      operationName: 'UserCatalogMainContentQuery',
      variables: {
        catalogId,
        pagingOptions: { limit: 20 },
      },
      query: QUERY,
    }]),
  })

  if (!response.ok) {
    throw new Error(`Medium GraphQL 返回 ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  const catalog = body?.[0]?.data?.catalogById

  if (catalog?.__typename === 'Forbidden') {
    throw new Error(`无权访问 List ${catalogId}，它可能不是公开的`)
  }

  if (!catalog || !Array.isArray(catalog.itemsConnection?.items)) {
    throw new Error(`Medium 没有返回 List ${catalogId} 的内容，List 可能不存在或接口已经变了`)
  }

  const entries = []

  for (const item of catalog.itemsConnection.items) {
    const entity = item?.entity
    const mediumUrl = entity?.mediumUrl
    if (!mediumUrl) continue

    // Strip Medium's tracking query; the path is the permanent address.
    const url = String(mediumUrl).split('?')[0]

    const entry = {
      id: `medium:${url}`,
      title: entity.title ? String(entity.title).trim() : 'Untitled',
      url,
    }

    if (entity.creator?.name) entry.author = entity.creator.name

    const publishedAt = seconds(entity.firstPublishedAt)
    if (publishedAt !== undefined) entry.publishedAt = publishedAt

    entries.push(entry)
  }

  if (entries.length === 0 && catalog.itemsConnection.items.length > 0) {
    throw new Error('Medium List 返回了内容，但没有任何一条带 mediumUrl，结构可能已经变了')
  }

  ctx.log.info(`medium-list: ${catalog.name ?? catalogId} ${entries.length} 条`)

  return { entries }
}

export async function preview(ctx) {
  const url = ctx.item?.url
  if (!url) return null

  const content = await ctx.article(url)

  return content === null ? null : { content }
}
