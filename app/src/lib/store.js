const KEY = "improve-trainer.sessions.v1";

export function loadSessions() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; }
  catch { return []; }
}

export function saveSession(s) {
  const all = loadSessions();
  all.unshift(s);
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 200)));
  return all;
}

export function clearSessions() {
  localStorage.removeItem(KEY);
}
