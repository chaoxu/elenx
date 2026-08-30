const root = document.documentElement;
const themeToggle = document.getElementById("theme-toggle");

function setTheme(theme) {
  const dark = theme === "dark";
  root.dataset.theme = dark ? "dark" : "light";
  themeToggle.setAttribute("aria-pressed", String(dark));
  themeToggle.textContent = dark ? "Light mode" : "Dark mode";
}

let savedTheme = null;
try {
  savedTheme = window.localStorage.getItem("elenx-v17-theme");
} catch {
  savedTheme = null;
}
const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
  ? "dark"
  : "light";
setTheme(savedTheme ?? preferredTheme);

themeToggle.addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  setTheme(next);
  try {
    window.localStorage.setItem("elenx-v17-theme", next);
  } catch {
    // Theme selection still works for the current page when storage is blocked.
  }
});

const flowTitle = document.getElementById("flow-detail-title");
const flowCopy = document.getElementById("flow-detail-copy");
const flowResult = document.getElementById("flow-detail-result");
const flowEdges = [...document.querySelectorAll(".flow-edge")];

function selectFlowEdge(edge) {
  for (const candidate of flowEdges) {
    const selected = candidate === edge;
    candidate.classList.toggle("is-active", selected);
    candidate.setAttribute("aria-pressed", String(selected));
  }
  flowTitle.textContent = edge.dataset.title;
  flowCopy.textContent = edge.dataset.copy;
  flowResult.textContent = edge.dataset.result;
}

for (const edge of flowEdges) {
  edge.addEventListener("click", () => selectFlowEdge(edge));
  edge.addEventListener("focus", () => selectFlowEdge(edge));
  edge.addEventListener("mouseenter", () => selectFlowEdge(edge));
}

const eventNumber = document.getElementById("event-number");
const eventTitle = document.getElementById("event-title");
const eventCopy = document.getElementById("event-copy");
const eventState = document.getElementById("event-state");
const eventSteps = [...document.querySelectorAll(".event-step")];

function selectEvent(step) {
  for (const candidate of eventSteps) {
    const selected = candidate === step;
    candidate.classList.toggle("is-active", selected);
    candidate.setAttribute("aria-pressed", String(selected));
  }
  eventNumber.textContent = step.dataset.event;
  eventTitle.textContent = step.dataset.title;
  eventCopy.textContent = step.dataset.copy;
  eventState.textContent = step.dataset.state;
}

for (const step of eventSteps) {
  step.addEventListener("click", () => selectEvent(step));
  step.addEventListener("focus", () => selectEvent(step));
  step.addEventListener("mouseenter", () => selectEvent(step));
}

const proofDetail = document.getElementById("proof-detail");
for (const note of document.querySelectorAll(".proof-node")) {
  const showNote = () => {
    const title = document.createElement("strong");
    title.textContent = note.dataset.title;
    const copy = document.createElement("span");
    copy.textContent = note.dataset.copy;
    proofDetail.replaceChildren(title, document.createElement("br"), copy);
  };
  note.addEventListener("click", showNote);
  note.addEventListener("focus", showNote);
}
