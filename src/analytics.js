// Per-device analytics, stored in this browser's localStorage (no database).

const KEY = "tictac-analytics";

export async function appendAnalytic(entry) {
  try {
    const list = await loadAnalytics();
    list.push(entry);
    localStorage.setItem(KEY, JSON.stringify(list.slice(-500)));
  } catch (e) {
    console.error("Analytics error:", e);
  }
}

export async function loadAnalytics() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
