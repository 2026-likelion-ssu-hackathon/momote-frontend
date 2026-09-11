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
      // momote.myProfile goes with momote.userId, not on its own — a leftover nickname/photo from
      // whoever this device used to be would otherwise hang around and get sent back to
      // claimParticipant as if it were the *new* pick's profile. Deliberately leaves
      // momote.chatRoomId alone: ?reset is for rehearsing which side of an already-fixed room this
      // device is, not for leaving the room (see needsRoomChoice/RoomEntryScreen for that).
      for (const key of ['momote.userId', 'momote.myProfile']) {
        for (const store of ['sessionStorage', 'localStorage']) {
          try {
            window[store].removeItem(key)
          } catch {
            // Storage unavailable; there was nothing remembered to forget either.
          }
        }
      }
    }
  } catch {
    // No parsable location — nothing to reset.
  }
}

let CHAT_ROOM_ID = resolveId('roomId', 'momote.chatRoomId', import.meta.env.VITE_CHAT_ROOM_ID)

// Deliberately no env fallback: an unchosen user is the signal that this device should be asked who
// it is (see ParticipantPicker in App.jsx). Falling back to the build value would silently make
// everyone who opens the bare link the same participant, which is the thing the picker exists to
// avoid — two people opening one submitted URL have to end up on opposite sides of the chat.
let USER_ID = resolveId('userId', 'momote.userId', null)

// The picker still needs *some* valid id to ask the server who the room's two participants are, and
// this is the only one available before anybody has chosen. It authenticates that lookup and
// nothing else.
const BOOTSTRAP_USER_ID = import.meta.env.VITE_USER_ID

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

// Without a room, a user, and a completed profile there is nothing to call, and every request would
// 404 or show a nickname-less stranger. App.jsx checks this and keeps running its local demo
// behaviour instead of showing a broken screen, so the build stays presentable until all three are
// in place. The profile check matters because the two-step flow (RoomEntryScreen, then
// ParticipantPicker) can leave USER_ID set — createRoom/joinRoom assign it immediately, before the
// nickname/photo step runs — without a nickname having been chosen yet; see needsParticipantChoice.
export function isBackendConfigured() {
  return Boolean(CHAT_ROOM_ID && USER_ID && myProfile().nickname)
}

export function currentUserId() {
  return Number(USER_ID)
}

// Whether a room is known but nobody on this device has finished setting up a profile in it. Two
// paths land here:
//   - the legacy single-room dev config (CHAT_ROOM_ID from .env.local): USER_ID isn't set at all
//     yet, exactly like before this file supported multiple rooms.
//   - a room just created or joined via RoomEntryScreen: USER_ID is already set (createRoom/joinRoom
//     assign this device's slot immediately, since the backend has to hand out an id to authenticate
//     the *next* request with), but no nickname/photo has been submitted for it yet.
// Both should show ParticipantPicker, so this checks profile completion rather than just USER_ID.
export function needsParticipantChoice() {
  if (!CHAT_ROOM_ID) return false
  if (!USER_ID) return true
  return !myProfile().nickname
}

// Whether no room has been resolved on this device at all yet — the state RoomEntryScreen exists
// for. False whenever CHAT_ROOM_ID came from .env.local (the legacy single fixed-room dev config),
// so that path skips straight to needsParticipantChoice exactly as it always has.
export function needsRoomChoice() {
  return !CHAT_ROOM_ID
}

// Records which room this device belongs to, the same way chooseUserId records which participant —
// set once, by RoomEntryScreen, and persisted so a reload doesn't ask again.
export function chooseRoomId(roomId) {
  CHAT_ROOM_ID = String(roomId)
  for (const store of ['sessionStorage', 'localStorage']) {
    try {
      window[store].setItem('momote.chatRoomId', CHAT_ROOM_ID)
    } catch {
      // Storage unavailable — the choice still holds for this page load.
    }
  }
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

// This device's own nickname/photo, as returned by claimParticipant. fetchChatRoom's room endpoint
// only ever names the *partner* relative to whoever asks (see pullRoom in App.jsx), so there is no
// way to read "my own" profile back from the server — it has to be remembered locally from the
// moment this device claimed it. Same storage pair as chooseUserId, for the same reason
// (sessionStorage wins across tabs on one browser; localStorage survives a reload of just this tab).
export function rememberMyProfile({ nickname, profileImageUrl }) {
  const value = JSON.stringify({ nickname: nickname ?? null, profileImageUrl: profileImageUrl ?? null })
  for (const store of ['sessionStorage', 'localStorage']) {
    try {
      window[store].setItem('momote.myProfile', value)
    } catch {
      // Storage unavailable — the profile still holds for this page load via the module-level cache.
    }
  }
  myProfileCache = JSON.parse(value)
}

let myProfileCache = null

export function myProfile() {
  if (myProfileCache) return myProfileCache
  for (const store of ['sessionStorage', 'localStorage']) {
    try {
      const raw = window[store]?.getItem('momote.myProfile')
      if (raw) return (myProfileCache = JSON.parse(raw))
    } catch {
      // Storage unavailable — fall through to the next store, or the no-profile-yet default below.
    }
  }
  return { nickname: null, profileImageUrl: null }
}

// POST /api/chat-rooms — NOT YET IMPLEMENTED ON THE BACKEND. Requested contract:
//
//   Request:  POST /api/chat-rooms   (no body — nobody has an identity yet, that's the point of it)
//   Response: { "roomId": 42, "userId": 1, "inviteCode": "7F3K9X" }
//
// Creates a brand-new, empty room and immediately assigns this device the first of its two
// participant slots — before any nickname is set. It has to work this way (rather than leaving
// USER_ID unresolved until claimParticipant, the way the legacy fixed-room flow does) because a
// fresh room has no pre-seeded participants for claimParticipant's "find the still-default slot"
// trick to find — someone has to be told an id to authenticate as *before* they can name themselves.
// chooseRoomId/chooseUserId are called on success so the very next request (claimParticipant,
// filling in the name/photo) already authenticates correctly.
export async function createRoom() {
  const response = await fetch(`${API_BASE_URL}/api/chat-rooms`, { method: 'POST' })
  if (!response.ok) {
    throw new Error(`POST /api/chat-rooms responded ${response.status}`)
  }
  const result = await response.json()
  chooseRoomId(result.roomId)
  chooseUserId(result.userId)
  return result
}

// POST /api/chat-rooms/join-requests — NOT YET IMPLEMENTED ON THE BACKEND. Requested contract:
//
//   Request:  POST /api/chat-rooms/join-requests
//             Content-Type: multipart/form-data
//             fields: inviteCode (text, required), nickname (text, required),
//                     profileImage (file, optional — same rules as claimParticipant's)
//   Response: { "requestId": 55, "roomId": 42, "status": "PENDING" }
//   Error:    404 if the code doesn't match any room, 409 if that room already has two participants
//
// Replaces the old joinRoom, which assigned a participant slot the instant the code was entered.
// Entering a code now creates a PENDING request instead — the room's creator has to review the
// name/photo and accept it (see acceptJoinRequest) before this device becomes a real participant.
// No auth header: this device isn't a participant of anything yet, which is the whole point.
export async function requestToJoin(inviteCode, { nickname, imageFile } = {}) {
  const form = new FormData()
  form.append('inviteCode', inviteCode)
  form.append('nickname', nickname)
  if (imageFile) form.append('profileImage', imageFile)
  const response = await fetch(`${API_BASE_URL}/api/chat-rooms/join-requests`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) {
    throw new Error(`POST /api/chat-rooms/join-requests responded ${response.status}`)
  }
  return response.json()
}

// GET /api/chat-rooms/join-requests/{requestId} — NOT YET IMPLEMENTED ON THE BACKEND. Polled by the
// requesting device while it waits on the room creator's decision — see RoomEntryScreen's
// 'awaiting-approval' mode. No auth: requestId itself is the only thing that has to be known to
// check on it, the same way a request only this device has ever seen is normally enough.
//
//   Response: { "requestId": 55, "status": "PENDING" | "ACCEPTED" | "REJECTED", "roomId": 42,
//               "userId": 2, "nickname": "지민", "profileImageUrl": "https://.../abc.jpg" }
//             roomId/userId/nickname/profileImageUrl are present only once status is ACCEPTED —
//             that's this device's real, now-registered identity, echoing back exactly what
//             requestToJoin submitted (mirroring what claimParticipant's response does for the
//             legacy/creator paths). chooseRoomId/chooseUserId are called here, once accepted, for
//             the same reason they're called inside createRoom; the caller still has to call
//             rememberMyProfile itself with nickname/profileImageUrl, the same as every other path.
export async function fetchJoinRequestStatus(requestId) {
  const response = await fetch(`${API_BASE_URL}/api/chat-rooms/join-requests/${requestId}`)
  if (!response.ok) {
    throw new Error(`GET /api/chat-rooms/join-requests/${requestId} responded ${response.status}`)
  }
  const result = await response.json()
  if (result.status === 'ACCEPTED') {
    chooseRoomId(result.roomId)
    chooseUserId(result.userId)
  }
  return result
}

// GET /api/chat-rooms/{id}/join-requests?status=PENDING — NOT YET IMPLEMENTED ON THE BACKEND.
// Polled by the room creator while the invite-code screen is up, to notice someone wanting in — see
// RoomEntryScreen's polling effect in the 'created' mode. Uses the shared `request` helper, so it
// authenticates as this device's own USER_ID (set by createRoom) the same way every other in-room
// call does — no separate id needed since by the time this runs, CHAT_ROOM_ID/USER_ID are already
// this device's own.
//
//   Response: [{ "requestId": 55, "nickname": "지민", "profileImageUrl": "...", "requestedAt": "..." }]
//             empty array when nobody's asked yet.
export function fetchPendingJoinRequests() {
  return request('/join-requests', { query: { status: 'PENDING' } })
}

// POST /api/chat-rooms/{id}/join-requests/{requestId}/accept — NOT YET IMPLEMENTED ON THE BACKEND.
// This is the moment the requester actually becomes a real participant — assigned the room's other
// userId slot, with the nickname/photo they submitted in requestToJoin registered directly (no
// separate claimParticipant call on their end; they never had a slot to claim into before now).
//
//   Response: { "requestId": 55, "userId": 2, "status": "ACCEPTED" }
export function acceptJoinRequest(requestId) {
  return request(`/join-requests/${requestId}/accept`, { method: 'POST' })
}

// POST /api/chat-rooms/{id}/join-requests/{requestId}/reject — NOT YET IMPLEMENTED ON THE BACKEND.
export function rejectJoinRequest(requestId) {
  return request(`/join-requests/${requestId}/reject`, { method: 'POST' })
}

// POST /api/chat-rooms/{id}/participants/claim — NOT YET IMPLEMENTED ON THE BACKEND. Requested
// contract, for whoever picks this up on the backend team:
//
//   Request:  POST /api/chat-rooms/{roomId}/participants/claim
//             Content-Type: multipart/form-data
//             X-User-Id: <this device's own id — see below for where that comes from>
//             fields: nickname (text, required)
//                     profileImage (file, optional — image/*, suggest capping ~5MB; the client only
//                       sends this when the person uploaded a real photo instead of keeping the
//                       default silhouette, so it's fine for the server to skip storage work when
//                       the part is absent)
//   Response: { "userId": 2, "nickname": "지민", "profileImageUrl": "https://.../abc.jpg" }
//             profileImageUrl is null/omitted when no photo was uploaded.
//   Error:    409 if both of the room's participant slots already have a customised nickname
//
// Also needs GET /api/chat-rooms/{id} to grow the same field on `partner` (profileImageUrl,
// alongside the nickname it already returns) — that's the only way this device finds out the other
// person's photo, the same way it already finds their nickname (see fetchChatRoom and pullRoom in
// App.jsx).
//
// Fills in the name/photo for whichever slot this device already holds. "Already holds" has two
// different sources depending on how this device got here:
//   - created or joined a room via RoomEntryScreen just now (see createRoom/joinRoom): USER_ID is
//     already set, from that response — this request just authenticates as USER_ID like any other.
//   - the legacy single fixed-room dev config: nobody has picked a slot yet, so this request has to
//     authenticate as *some* known-valid id (BOOTSTRAP_USER_ID, from env) to ask the server "which of
//     the room's two pre-seeded slots is still untouched — make that one me." That decision has to be
//     server-side and atomic: if the client instead read "which slot looks unclaimed" and then wrote
//     to it, two people submitting within the same moment could both read "both slots free" and race
//     onto the same id.
export async function claimParticipant(nickname, { imageFile } = {}) {
  const authId = USER_ID ?? BOOTSTRAP_USER_ID
  if (!CHAT_ROOM_ID || !authId) {
    throw new Error('No chat room configured — cannot claim a participant slot.')
  }
  const form = new FormData()
  form.append('nickname', nickname)
  if (imageFile) form.append('profileImage', imageFile)
  return request('/participants/claim', {
    method: 'POST',
    formData: form,
    asUserId: Number(authId),
  })
}

async function request(path, { method = 'GET', body, formData, query, asUserId } = {}) {
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
      // formData (claimParticipant's optional photo) must NOT get an explicit Content-Type — fetch
      // sets its own multipart boundary from the FormData object, and overriding it here would drop
      // that boundary and leave the server unable to parse the parts.
      ...(body && !formData ? { 'Content-Type': 'application/json' } : {}),
    },
    body: formData ?? (body ? JSON.stringify(body) : undefined),
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
