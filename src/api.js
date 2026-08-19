// Client for the team's Wellness Mate backend (separate repo, deployed on Railway). Everything here
// matches the OpenAPI spec at <base>/v3/api-docs; see .env.example for configuration.
//
// The backend is chat-room shaped, not request/response shaped: messages are persisted server-side,
// and the AI work happens asynchronously *after* a message lands. So the client sends a message and
// then polls two read endpoints for whatever the AI produced from it — emotion state for the thread,
// and result cards for the suggestion sheet. There is no push channel in the spec.
//
// Auth is a plain `X-User-Id` header — no token, no login endpoint. Which user and which room are
// therefore configuration, not something this app can discover or sign into.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://wellness-mate-backend-production.up.railway.app'

// There is no signup or login, so identity is configuration. A single build-time value isn't enough
// for a couple chat though: demoing it needs two devices acting as the two different participants,
// and one env var would make both of them the same person — every message would render as "mine" on
// both phones. So `?userId=` (and `?roomId=`) on the URL override the build, and stick in
// localStorage so a reload or a shared link keeps whoever that device is signed in as.
// Resolution order: query string, then this tab's own memory, then the browser's, then the build.
//
// sessionStorage sits above localStorage because localStorage is shared by every tab on the origin
// — opening the second participant in a second tab would otherwise reassign the first one the next
// time it reloaded, which is exactly the situation testing the couple chat puts you in. Writing to
// both means a tab keeps its own identity for as long as it lives, while a phone that was opened
// with a link once still comes back as the same person after the tab is closed and reopened.
function resolveId(queryKey, storageKey, envValue) {
  const read = (store) => {
    try {
      return window[store].getItem(storageKey)
    } catch {
      return null // private mode, or storage disabled
    }
  }

  let fromQuery = null
  try {
    fromQuery = new URLSearchParams(window.location.search).get(queryKey)
  } catch {
    // No window (SSR/tests) — fall through to the build-time value.
  }

  if (fromQuery) {
    for (const store of ['sessionStorage', 'localStorage']) {
      try {
        window[store].setItem(storageKey, fromQuery)
      } catch {
        // The query param still applies for this page load even if nothing can be stored.
      }
    }
    return fromQuery
  }

  return read('sessionStorage') ?? read('localStorage') ?? envValue
}

// `?reset` forgets which participant this device is, sending it back to the picker. It exists for
// rehearsal: switching one phone between the two sides otherwise means a private window or a
// developer console, and a phone has no console. Runs before anything reads storage.
if (typeof window !== 'undefined') {
  try {
    if (new URLSearchParams(window.location.search).has('reset')) {
      for (const store of ['sessionStorage', 'localStorage']) {
        try {
          window[store].removeItem('momote.userId')
        } catch {
          // Storage unavailable; there was nothing remembered to forget either.
        }
      }
    }
  } catch {
    // No parsable location — nothing to reset.
  }
}

const CHAT_ROOM_ID = resolveId('roomId', 'momote.chatRoomId', import.meta.env.VITE_CHAT_ROOM_ID)

// Deliberately no env fallback: an unchosen user is the signal that this device should be asked who
// it is (see ParticipantPicker in App.jsx). Falling back to the build value would silently make
// everyone who opens the bare link the same participant, which is the thing the picker exists to
// avoid — two people opening one submitted URL have to end up on opposite sides of the chat.
let USER_ID = resolveId('userId', 'momote.userId', null)

// The picker still needs *some* valid id to ask the server who the room's two participants are, and
// this is the only one available before anybody has chosen. It authenticates that lookup and
// nothing else.
const BOOTSTRAP_USER_ID = import.meta.env.VITE_USER_ID

// Who the room's two participants are, for when the nickname lookup can't run — an unreachable
// backend must not leave the picker with two dead buttons and no way into the app. Names are the
// only thing lost; the ids are what actually decide identity.
const FALLBACK_PARTICIPANT_IDS = (import.meta.env.VITE_PARTICIPANT_IDS ?? '1,2')
  .split(',')
  .map((id) => Number(id.trim()))
  .filter(Number.isFinite)

// Both ids have been read and remembered by this point, so take them back out of the address bar.
// The link only has to be opened once per device — after that the identity comes from storage —
// and what people see on screen during a demo should just be the site, not its wiring.
// replaceState rather than pushState so the query doesn't come back on a Back press.
if (typeof window !== 'undefined' && window.history?.replaceState) {
  try {
    const url = new URL(window.location.href)
    if (['roomId', 'userId', 'reset'].some((key) => url.searchParams.has(key))) {
      url.searchParams.delete('roomId')
      url.searchParams.delete('userId')
      url.searchParams.delete('reset')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
  } catch {
    // Nothing to recover from — the ids are already resolved, the query is just still visible.
  }
}

// Without a room and a user there is nothing to call, and every request would 404. App.jsx checks
// this and keeps running its local demo behaviour instead of showing a broken screen, so the build
// stays presentable until the team provisions real IDs.
export function isBackendConfigured() {
  return Boolean(CHAT_ROOM_ID && USER_ID)
}

export function currentUserId() {
  return Number(USER_ID)
}

// Whether the room is known but nobody on this device has said which participant they are.
export function needsParticipantChoice() {
  return Boolean(CHAT_ROOM_ID) && !USER_ID
}

// Records the choice for this tab and this browser, so the picker is a once-per-device question.
export function chooseUserId(userId) {
  USER_ID = String(userId)
  for (const store of ['sessionStorage', 'localStorage']) {
    try {
      window[store].setItem('momote.userId', USER_ID)
    } catch {
      // Storage unavailable — the choice still holds for this page load.
    }
  }
}

// Both participants, for the picker to offer. The room endpoint only ever names the *other* person
// relative to whoever asks, so asking as each side in turn is what produces both names: the seed
// call reveals the partner's id and nickname, and calling back as that partner names the seed.
export async function fetchParticipants() {
  const fallback = FALLBACK_PARTICIPANT_IDS.map((userId) => ({ userId, nickname: `사용자 ${userId}` }))
  if (!CHAT_ROOM_ID || !BOOTSTRAP_USER_ID) return fallback.length ? fallback : null

  try {
    const seedId = Number(BOOTSTRAP_USER_ID)
    const seen = await request('', { asUserId: seedId })
    const partnerId = seen?.partner?.userId
    if (!partnerId) return fallback
    const mirrored = await request('', { asUserId: partnerId })
    return [
      { userId: seedId, nickname: mirrored?.partner?.nickname ?? `사용자 ${seedId}` },
      { userId: partnerId, nickname: seen?.partner?.nickname ?? `사용자 ${partnerId}` },
    ]
  } catch (error) {
    console.warn('Falling back to configured participant ids — could not read their names.', error)
    return fallback.length ? fallback : null
  }
}

async function request(path, { method = 'GET', body, query, asUserId } = {}) {
  const url = new URL(`${API_BASE_URL}/api/chat-rooms/${CHAT_ROOM_ID}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
  }

  const response = await fetch(url, {
    method,
    headers: {
      // asUserId is only for the pre-choice participant lookup; everything else speaks as whoever
      // this device has been established to be.
      'X-User-Id': String(asUserId ?? USER_ID),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!response.ok) {
    throw new Error(`${method} ${url.pathname} responded ${response.status}`)
  }
  return response.json()
}

// GET /api/chat-rooms/{id} — room status and the partner's nickname/profile image.
export function fetchChatRoom() {
  return request('')
}

// GET /api/chat-rooms/{id}/messages — oldest-first, cursor-paginated by message id. Passing
// `afterMessageId` is how the poll asks for "anything since the last one I have" rather than
// refetching the whole conversation every few seconds.
export function fetchMessages({ afterMessageId, beforeMessageId, size } = {}) {
  return request('/messages', { query: { afterMessageId, beforeMessageId, size } })
}

// POST /api/chat-rooms/{id}/messages — the server dedupes on clientMessageId, so a retry after a
// dropped response can't post the same message twice.
export function sendMessage({ content, clientMessageId, sentAt }) {
  return request('/messages', {
    method: 'POST',
    body: { content, clientMessageId, sentAt: sentAt.toISOString() },
  })
}

// GET /api/chat-rooms/{id}/emotion-analyses — the latest unexpired state per subject user. The
// spec notes analyses with shouldShow=false never reach this endpoint, so anything returned here is
// meant to be displayed as-is.
export function fetchEmotionAnalyses() {
  return request('/emotion-analyses')
}

// GET /api/chat-rooms/{id}/ai-results — stored AI results in ascending id order.
export function fetchAiResults({ afterResultId, triggerMessageId } = {}) {
  return request('/ai-results', { query: { afterResultId, triggerMessageId } })
}

// The backend's five emotionType values line up one-to-one with the five thread animations, so the
// thread can render the server's judgement directly instead of the local keyword heuristic.
// ASSUMPTION: this pairing is inferred from the enum names, not documented — worth confirming with
// the backend team, since a wrong pairing shows a plausible-looking but incorrect mood.
const EMOTION_TO_THREAD_STATE = {
  STABLE: 'neutral',
  RESOLVED: 'love',
  ACCUMULATED: 'tangled',
  ENGAGED: 'happy',
  ESCALATED: 'tense',
}

export function threadStateFromEmotion(emotionType) {
  return EMOTION_TO_THREAD_STATE[emotionType] ?? null
}

// Which suggestion card each AI result type feeds.
const RESULT_TYPE_TO_SUGGESTION = {
  TONE_CORRECTION: 'toneCorrection',
  DATE_RECOMMENDATION: 'dateCourse',
  YOUTUBE_RECOMMENDATION: 'video',
}

export function suggestionTypeFromResultType(resultType) {
  return RESULT_TYPE_TO_SUGGESTION[resultType] ?? null
}

function firstOf(source, ...keys) {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

// The eight place categories the backend can send, confirmed by the backend team. Only used when a
// place has no `summary` of its own; an unknown value falls through to the raw string rather than
// being dropped, so a new category added server-side degrades to English rather than to nothing.
const PLACE_CATEGORY_LABELS = {
  RESTAURANT: '음식점',
  CAFE: '카페',
  CULTURE: '문화',
  ATTRACTION: '관광지·명소',
  LODGING: '숙박',
  SHOP: '쇼핑',
  ACTIVITY: '체험·활동',
  ETC: '기타',
}

// `resultData` is typed as a bare `object` in the schema section, but the spec's response *example*
// documents the DATE_RECOMMENDATION case — so that one is read directly. The other two types have
// no example anywhere, so their fields are still pulled by trying the names the backend most likely
// used, with anything missing left `undefined` so the card falls back to its own default prop
// rather than rendering blank. `console.debug` in App.jsx prints the first real payload received,
// which is how the remaining two get pinned down.
export function suggestionPropsFromResult(result) {
  const data = result?.resultData ?? {}
  const suggestionType = suggestionTypeFromResultType(result?.resultType)

  if (suggestionType === 'toneCorrection') {
    // Observed shape:
    //   { alternativeSentence, correctionReason, situationDiagnosis, guideMessage }
    // guideMessage ("대신 이렇게 상대방에게 말해보세요.") says the same thing as the card's own
    // printed heading, so it is deliberately not used — the card asks the question, the payload
    // supplies the answer. situationDiagnosis is the line the sheet shows in bold above the card,
    // and it reads as a direct replacement for the hardcoded TONE_CORRECTION_STATUS.
    return {
      suggestion: firstOf(data, 'alternativeSentence', 'suggestion', 'suggestedText', 'correctedText'),
      reason: firstOf(data, 'correctionReason', 'reason', 'explanation'),
      statusLabel: firstOf(data, 'situationDiagnosis', 'statusLabel', 'title', 'headline'),
    }
  }

  if (suggestionType === 'dateCourse') {
    // Confirmed shape:
    //   { guideMessage, courseName, courseSummary, recommendationReason,
    //     mainPlace: { name, category, summary, externalUrl },
    //     coursePlaces: [{ order, name, category, summary, externalUrl }] }
    // coursePlaces is the up-to-three-stop course the card is designed around; mainPlace is its
    // headline stop and also appears inside the array, so it is only used as a fallback for a
    // result that somehow arrives without the course.
    const course = Array.isArray(data.coursePlaces) && data.coursePlaces.length ? data.coursePlaces : null
    const places = course
      ? [...course].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      : data.mainPlace
        ? [data.mainPlace]
        : null
    return {
      places: places?.map((place) => ({
        name: place?.name ?? '',
        // The place's own one-liner reads far better than a bare category, so the category label is
        // only the fallback for a place that arrives without one.
        description:
          firstOf(place, 'summary', 'description') ??
          (place?.category ? PLACE_CATEGORY_LABELS[place.category] ?? place.category : ''),
      })),
      note: firstOf(data, 'recommendationReason', 'courseSummary', 'guideMessage'),
      statusLabel: firstOf(data, 'courseName', 'guideMessage', 'statusLabel'),
    }
  }

  if (suggestionType === 'video') {
    // Confirmed shape:
    //   { guideMessage, videoId, title, videoUrl, thumbnailUrl, channelName,
    //     recommendationReason, videoSummary? }
    // The card derives both the thumbnail and the watch link from the bare id, which the backend
    // confirmed is the intended key; videoUrl is only read to recover an id if one ever arrives
    // without the plain field.
    const rawId = firstOf(data, 'videoId', 'videoUrl', 'url')
    return {
      videoId: typeof rawId === 'string' ? extractYoutubeId(rawId) : undefined,
      title: firstOf(data, 'title', 'videoTitle'),
      channel: firstOf(data, 'channelName', 'channel', 'channelTitle'),
      note: firstOf(data, 'recommendationReason', 'videoSummary', 'guideMessage'),
      statusLabel: firstOf(data, 'guideMessage', 'statusLabel'),
    }
  }

  return {}
}

// crypto.randomUUID only exists in a secure context, which the phone-testing setup is not — the dev
// server is reached over plain http on the LAN, so it would be undefined exactly where messages get
// tested by hand. The fallback only has to be unique enough to dedupe one client's own sends.
export function newClientMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function extractYoutubeId(value) {
  const match = value.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)
  if (match) return match[1]
  return /^[\w-]{11}$/.test(value) ? value : undefined
}
