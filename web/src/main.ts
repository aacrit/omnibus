// Telemetry here is aggregate counts only: no anonymous id, no localStorage,
// no cookies, nothing that could identify a visitor. `/e` accepts exactly
// `{ "name": "<allowed event>" }` and bumps a same-day, same-name counter.
// Because it collects and stores nothing personal, no consent banner is
// needed (see web/privacy.html). Every POST is same-origin JSON: the Worker
// refuses anything else (worker/src/guard.ts), so never use sendBeacon,
// which sends text/plain.
function sendEvent(name: string): void {
  fetch("/e", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
    keepalive: true,
  }).catch(() => {
    // Best-effort telemetry: a failed send is not the user's problem.
  });
}

/**
 * Call this exactly where the product's core action completes: a viewer
 * reaches the final 30 seconds of an episode. Its event is contract.yaml's
 * success_event, the one count the kill criteria in CHARTER.md are written
 * against. Never call it for page views, week pages or feedback.
 */
export function reportCoreSuccess(): void {
  sendEvent("episode_completed");
}

/** Seconds before an episode's end at which it counts as completed (the brief). */
export const COMPLETION_WINDOW_S = 30;

/**
 * Watches one episode player and reports its completion once, when playback
 * first reaches the final COMPLETION_WINDOW_S seconds. Spark serves no
 * episode, so no page has a <video data-episode> yet and episode_completed
 * stays at zero until the first one airs (docs/DECISIONS.md, 2026-11-11).
 */
export function watchEpisode(video: HTMLVideoElement): void {
  let done = false;
  video.addEventListener("timeupdate", () => {
    if (done || !Number.isFinite(video.duration) || video.duration <= 0) return;
    if (video.currentTime >= video.duration - COMPLETION_WINDOW_S) {
      done = true;
      reportCoreSuccess();
    }
  });
}

/**
 * The Spark unit: a week page read to its end. week_opened fires once, when
 * the source ledger's last line (#ledger-end) comes into view: the reader
 * has passed the seven days, the weight, the echo and the margins. Never on
 * page load. Counted beside, never instead of, episode_completed.
 */
function watchWeekRead(): void {
  const end = document.getElementById("ledger-end");
  if (!end || typeof IntersectionObserver === "undefined") return;
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      observer.disconnect();
      sendEvent("week_opened");
    }
  });
  observer.observe(end);
}

function setupFeedback(): void {
  const form = document.getElementById("feedback-form");
  const status = document.getElementById("feedback-status");
  if (!(form instanceof HTMLFormElement) || !status) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const textarea = form.elements.namedItem("text");
    const text = textarea instanceof HTMLTextAreaElement ? textarea.value.trim() : "";
    if (!text) return;

    status.textContent = "Sending.";
    status.removeAttribute("data-state");

    fetch("/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, page: location.pathname }),
    })
      .then((response) => {
        if (response.status === 429) throw new Error("ceiling");
        if (!response.ok) throw new Error(`status ${response.status}`);
        status.textContent = "Thank you, that was sent.";
        form.reset();
      })
      .catch((err: unknown) => {
        status.textContent =
          err instanceof Error && err.message === "ceiling"
            ? "We have had a lot of feedback today. Please try again tomorrow."
            : "Could not send that. Please try again.";
        status.dataset.state = "error";
      });
  });
}

sendEvent("page_view");
setupFeedback();
watchWeekRead();
document.querySelectorAll<HTMLVideoElement>("video[data-episode]").forEach(watchEpisode);
