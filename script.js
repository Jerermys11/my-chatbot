/* =====================================================================
   script.js - the "engine" of the chatbot.
   You should not need to edit this file. Change config.js instead.
   ===================================================================== */

// ---------- Grab the page elements we need ----------
const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const composerEl = document.getElementById("composer");
const newChatBtn = document.getElementById("newChatBtn");
const keyBtn = document.getElementById("keyBtn");
const keyModal = document.getElementById("keyModal");
const keyInput = document.getElementById("keyInput");
const rememberBox = document.getElementById("rememberBox");
const keyMessage = document.getElementById("keyMessage");
const keySave = document.getElementById("keySave");
const keyCancel = document.getElementById("keyCancel");
const keyRemove = document.getElementById("keyRemove");

const KEY_NAME = "gemini_api_key";

let history = [];   // the conversation so far, in the format Gemini expects
let busy = false;   // true while we wait for a reply

// ---------- Apply the settings from config.js ----------
document.title = BOT_CONFIG.name + " " + BOT_CONFIG.emoji;
document.getElementById("botName").textContent = BOT_CONFIG.name;
document.getElementById("botEmoji").textContent = BOT_CONFIG.emoji;
document.getElementById("botTagline").textContent = BOT_CONFIG.tagline;
document.documentElement.style.setProperty("--theme", BOT_CONFIG.themeColor);
document.documentElement.style.setProperty("--accent", BOT_CONFIG.accentColor);
document.querySelector('meta[name="theme-color"]').setAttribute("content", BOT_CONFIG.themeColor);

// ---------- API key storage (wrapped in try/catch in case the browser blocks it) ----------
function getKey() {
  try {
    const session = sessionStorage.getItem(KEY_NAME);
    if (session) return session;
  } catch (e) { /* storage blocked: ignore */ }
  try {
    const saved = localStorage.getItem(KEY_NAME);
    if (saved) return saved;
  } catch (e) { /* storage blocked: ignore */ }
  return "";
}

function hasRememberedKey() {
  try { return !!localStorage.getItem(KEY_NAME); } catch (e) { return false; }
}

function saveKey(key, remember) {
  try { sessionStorage.setItem(KEY_NAME, key); } catch (e) { /* ignore */ }
  try {
    if (remember) localStorage.setItem(KEY_NAME, key);
    else localStorage.removeItem(KEY_NAME);
  } catch (e) { /* ignore */ }
}

function removeKey() {
  try { sessionStorage.removeItem(KEY_NAME); } catch (e) { /* ignore */ }
  try { localStorage.removeItem(KEY_NAME); } catch (e) { /* ignore */ }
}

// ---------- API key pop-up ----------
function openModal(message) {
  keyInput.value = "";
  keyInput.placeholder = getKey() ? "A key is saved. Paste a new one to replace it" : "Paste key here";
  rememberBox.checked = hasRememberedKey();
  if (message) {
    keyMessage.textContent = message;
    keyMessage.hidden = false;
  } else {
    keyMessage.hidden = true;
  }
  keyModal.hidden = false;
  keyInput.focus();
}

function closeModal() {
  keyModal.hidden = true;
  keyInput.value = "";
}

keyBtn.addEventListener("click", () => openModal());
keyCancel.addEventListener("click", closeModal);
keyModal.addEventListener("click", (e) => { if (e.target === keyModal) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !keyModal.hidden) closeModal(); });

keySave.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) {
    keyMessage.textContent = "Please paste your key first.";
    keyMessage.hidden = false;
    return;
  }
  saveKey(key, rememberBox.checked);
  closeModal();
  inputEl.focus();
});

keyRemove.addEventListener("click", () => {
  removeKey();
  closeModal();
});

// ---------- Safe text formatting ----------
// Step 1: escape HTML so nothing can be injected.
// Step 2: turn **bold** into bold text and "- item" lines into bullet lists.
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyBold(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function formatText(raw) {
  const lines = escapeHtml(raw).split("\n");
  let html = "";
  let paragraph = [];
  let inList = false;

  function flushParagraph() {
    if (paragraph.length) {
      html += "<p>" + paragraph.join("<br>") + "</p>";
      paragraph = [];
    }
  }
  function closeList() {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  }

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*\u2022]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (!inList) { html += "<ul>"; inList = true; }
      html += "<li>" + applyBold(bullet[1]) + "</li>";
    } else if (line.trim() === "") {
      flushParagraph();
      closeList();
    } else {
      closeList();
      paragraph.push(applyBold(line));
    }
  }
  flushParagraph();
  closeList();
  return html;
}

// ---------- Showing messages ----------
function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addMessage(who, text, isError) {
  const div = document.createElement("div");
  div.className = "msg " + who + (isError ? " error" : "");
  if (who === "user") {
    div.textContent = text;           // plain text, always safe
  } else {
    div.innerHTML = formatText(text); // escaped first, then formatted
  }
  chatEl.appendChild(div);
  scrollToBottom();
  return div;
}

function addTyping() {
  const div = document.createElement("div");
  div.className = "msg bot typing";
  div.setAttribute("aria-label", "Thinking");
  div.innerHTML = "<span></span><span></span><span></span>";
  chatEl.appendChild(div);
  scrollToBottom();
  return div;
}

function showStarters() {
  const wrap = document.createElement("div");
  wrap.className = "starters";
  wrap.id = "starters";
  BOT_CONFIG.starterQuestions.forEach((q) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "starter";
    b.textContent = q;
    b.addEventListener("click", () => sendMessage(q));
    wrap.appendChild(b);
  });
  chatEl.appendChild(wrap);
}

function removeStarters() {
  const s = document.getElementById("starters");
  if (s) s.remove();
}

function startNewChat() {
  history = [];
  chatEl.innerHTML = "";
  addMessage("bot", BOT_CONFIG.welcomeMessage);
  showStarters();
  inputEl.focus();
}

// ---------- Talking to Gemini ----------
async function askGemini(key) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(BOT_CONFIG.model) +
    ":generateContent";

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: BOT_CONFIG.systemInstructions }] },
        contents: history
      })
    });
  } catch (e) {
    throw { kind: "network" };
  }

  if (!response.ok) {
    throw { kind: "http", status: response.status };
  }

  const data = await response.json();
  const parts =
    (data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts) || [];

  // Join the text parts and skip any "thinking" parts.
  const text = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("");

  if (!text.trim()) {
    const reason = data.promptFeedback && data.promptFeedback.blockReason;
    throw { kind: "empty", reason: reason };
  }
  return text;
}

function friendlyError(err) {
  if (err && err.kind === "network") {
    return "I can't reach the internet right now. Check your connection and try again.";
  }
  if (err && err.kind === "empty") {
    return err.reason
      ? "Google blocked that message (" + err.reason + "). Try rewording it."
      : "I didn't get an answer back. Please try again.";
  }
  if (err && err.kind === "http") {
    const s = err.status;
    if (s === 400 || s === 403) {
      return "Your API key was not accepted. Click the \"API key\" button and paste a valid key.";
    }
    if (s === 404) {
      return "The model name wasn't found. Open config.js and check the \"model\" setting.";
    }
    if (s === 429) {
      return "Too many requests right now (rate limit). Wait a minute and try again.";
    }
    if (s >= 500) {
      return "Google's server is having problems. Please try again in a moment.";
    }
    return "Something went wrong (error " + s + "). Please try again.";
  }
  return "Something unexpected went wrong. Please try again.";
}

// ---------- Sending a message ----------
async function sendMessage(rawText) {
  const text = (rawText || "").trim();
  if (!text || busy) return;

  const key = getKey();
  if (!key) {
    openModal("Please paste your Gemini API key to start chatting.");
    return;
  }

  busy = true;
  sendBtn.disabled = true;
  removeStarters();

  const userBubble = addMessage("user", text);
  inputEl.value = "";
  autoGrow();
  history.push({ role: "user", parts: [{ text: text }] });

  const typing = addTyping();

  try {
    const reply = await askGemini(key);
    typing.remove();
    history.push({ role: "model", parts: [{ text: reply }] });
    addMessage("bot", reply);
  } catch (err) {
    typing.remove();
    history.pop();            // forget the unanswered message
    userBubble.remove();      // and put it back in the box so you can resend
    inputEl.value = text;
    autoGrow();
    addMessage("bot", friendlyError(err), true);
  } finally {
    busy = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// ---------- Input box behavior ----------
function autoGrow() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
}

inputEl.addEventListener("input", autoGrow);

// Enter sends. Shift+Enter makes a new line.
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage(inputEl.value);
  }
});

composerEl.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(inputEl.value);
});

newChatBtn.addEventListener("click", startNewChat);

// ---------- Start! ----------
startNewChat();
