// Ported from RSSHub lib/routes/leetcode/dailyquestion-en.ts (AGPL-3.0).
/**
 * LeetCode -- Daily Question (English).
 *
 * The GraphQL endpoint is public and needs no cookie. Two queries are needed:
 * one for today's slug, one for the question body.
 */

export const meta = {
  id: 'rome.rsshub-leetcode-dailyquestion-en',
  name: 'LeetCode · Daily Question',
  version: '1.0.0',
  apiVersion: '1',
  view: 'articles',
  description: '读取 LeetCode 国际站每日一题',
  icon: 'https://leetcode.com/favicon.ico'
};

const HOST = 'https://leetcode.com'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const DIFFICULTY = { Easy: 'Easy', Medium: 'Medium', Hard: 'Hard' }

const DAILY_QUERY = `query questionOfToday {
  activeDailyCodingChallengeQuestion {
    date
    link
    question {
      frontendQuestionId: questionFrontendId
      titleSlug
    }
  }
}`

const DETAIL_QUERY = `query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    titleSlug
    content
    difficulty
    topicTags {
      name
    }
  }
}`

async function graphql(ctx, payload) {
  const response = await ctx.fetch(`${HOST}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      referer: `${HOST}/`,
      'user-agent': USER_AGENT
    },
    body: payload
  })

  if (!response.ok) {
    throw new Error(`leetcode: graphql returned ${response.status} ${response.statusText}`)
  }

  let data

  try {
    data = await response.json()
  } catch (error) {
    throw new Error(`leetcode: graphql did not return JSON: ${error.message}`)
  }

  if (data?.errors) {
    throw new Error(`leetcode: graphql error: ${data.errors[0]?.message || 'unknown'}`)
  }

  return data?.data
}

export async function fetch(ctx) {
  const daily = await graphql(ctx, { query: DAILY_QUERY, variables: {} })
  const today = daily?.activeDailyCodingChallengeQuestion

  if (!today?.question?.titleSlug) {
    throw new Error('leetcode: the daily question query returned no question; the response shape changed')
  }

  const details = (await graphql(ctx, { query: DETAIL_QUERY, variables: { titleSlug: today.question.titleSlug } }))?.question

  if (!details) {
    throw new Error(`leetcode: question ${today.question.titleSlug} returned no details`)
  }

  const tags = (details.topicTags || []).map((tag) => tag.name)
  const difficulty = DIFFICULTY[details.difficulty] || details.difficulty || ''
  const entry = {
    id: `leetcode:${details.titleSlug}`,
    title: `${details.questionFrontendId}. ${details.title || details.titleSlug}`,
    url: today.link ? `${HOST}${today.link}` : `${HOST}/problems/${details.titleSlug}/`,
    content: details.content || ''
  }

  if (difficulty) {
    entry.summary = tags.length > 0 ? `${difficulty} · ${tags.join('、')}` : difficulty
  }

  if (today.date) {
    const timestamp = Date.parse(`${today.date}T00:00:00Z`)

    if (!Number.isNaN(timestamp)) {
      entry.publishedAt = Math.floor(timestamp / 1000)
    }
  }

  return { entries: [entry], icon: 'https://leetcode.com/favicon.ico' }
}
