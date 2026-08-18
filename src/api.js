// Client for the 3 AI suggestion endpoints that live in the team's separate backend repo (not
// this one) — this file only knows how to call them, not how they're implemented. Point
// VITE_API_BASE_URL at wherever that backend is running (see .env.example); everything here fails
// soft (throws, caught by the caller in App.jsx) so a missing/unreachable backend degrades to the
// suggestion cards' own hardcoded example content instead of breaking the UI.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

// Shared request body for all 3 endpoints: the recent conversation, oldest-first, trimmed by the
// caller (see MOOD_HISTORY_SIZE in App.jsx) to just enough turns for the model to reason about
// tone/context without shipping the whole history on every keystroke-triggered message.
function toConversationPayload(messages) {
  return {
    messages: messages.map((message) => ({
      text: message.text,
      mine: message.mine,
      time: message.time.toISOString(),
    })),
  }
}

async function postSuggestion(path, messages) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toConversationPayload(messages)),
  })
  if (!response.ok) throw new Error(`${path} responded ${response.status}`)
  return response.json()
}

// AI 대화 분석/말투 교정. Expected response shape:
//   { isRelevant: boolean, statusLabel: string, suggestion: string, reason: string }
// `isRelevant` is reserved for later — the trigger for which suggestion type is showing still
// comes from the client-side keyword classifier in App.jsx, not from this response, so a
// mismatched isRelevant doesn't currently change anything on its own.
export function fetchToneCorrection(messages) {
  return postSuggestion('/api/tone-correction', messages)
}

// 데이트 코스 추천. Expected response shape:
//   { isRelevant: boolean, statusLabel: string, places: [{ name: string, description: string }], note: string }
export function fetchDateCourseRecommendation(messages) {
  return postSuggestion('/api/date-course', messages)
}

// 유튜브 영상 추천. Expected response shape:
//   { isRelevant: boolean, statusLabel: string, videoId: string, title: string, channel: string, note: string }
export function fetchVideoRecommendation(messages) {
  return postSuggestion('/api/video-recommendation', messages)
}
