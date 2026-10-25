/* =====================================================================
   script.js - the "engine" of the chatbot.
   You should not need to edit this file. Change config.js instead.
   ===================================================================== */

// ---------- Grab the page elements we need ----------
const mainEl = document.getElementById("main");
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
const sidebarEl = document.getElementById("sidebar");
const scrimEl = document.getElementById("scrim");
const menuBtn = document.getElementById("menuBtn");
const sidebarClose = document.getElementById("sidebarClose");
const chatListEl = document.getElementById("chatList");
const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");
const attachmentsEl = document.getElementById("attachments");
const toastEl = document.getElementById("toast");
const kbStatusEl = document.getElementById("kbStatus");

const KEY_NAME = "gemini_api_key";
const STORE_KEY = "rmibot_chats_v1";

// Settings from config.js (with safe defaults in case a line is missing)
const MAX_FILE_MB = BOT_CONFIG.maxFileSizeMB || 10;
const MAX_CHAT_FILES_MB = BOT_CONFIG.maxChatFilesMB || 12;
const MAX_SAVED_CHATS = BOT_CONFIG.maxSavedChats || 40;
const FILE_ONLY_PROMPT =
  BOT_CONFIG.fileOnlyPrompt ||
  "Here are my study materials. Summarize the key topics in a few bullets, then quiz me on one of them.";

// ---------- Apply the settings from config.js ----------
document.title = BOT_CONFIG.name + " " + BOT_CONFIG.emoji;
document.getElementById("botName").textContent = BOT_CONFIG.name;
document.getElementById("botEmoji").textContent = BOT_CONFIG.emoji;
document.getElementById("botTagline").textContent = BOT_CONFIG.tagline;
document.documentElement.style.setProperty("--theme", BOT_CONFIG.themeColor);
document.documentElement.style.setProperty("--accent", BOT_CONFIG.accentColor);
document.querySelector('meta[name="theme-color"]').setAttribute("content", BOT_CONFIG.themeColor);

// ---------- Small helpers ----------
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function makeTitle(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 40 ? clean.slice(0, 40) + "\u2026" : clean || "New chat";
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 6500);
}

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
  initKnowledge(true);   // a key is now available, so prepare "meaning search"
});

keyRemove.addEventListener("click", () => {
  removeKey();
  closeModal();
  renderKbStatus();
});

// ---------- Saved files (stored in the browser's IndexedDB) ----------
// Chats are saved as small text. Attached files can be large, so they are
// kept in a separate browser database and linked to a chat by an id.
let dbPromise = null;
const memoryFiles = {};   // backup if the browser blocks IndexedDB

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open("rmibot-files", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("files", { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });
  }
  return dbPromise;
}

async function putFile(record) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    memoryFiles[record.id] = record;   // keep it for this visit at least
  }
}

async function getFile(id) {
  if (memoryFiles[id]) return memoryFiles[id];
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction("files").objectStore("files").get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

async function deleteFiles(ids) {
  for (const id of ids) {
    delete memoryFiles[id];
    try {
      const db = await openDb();
      await new Promise((resolve) => {
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").delete(id);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
        tx.onabort = resolve;
      });
    } catch (e) { /* ignore */ }
  }
}

// ---------- Chats: creating, saving, loading ----------
function makeChat() {
  const now = Date.now();
  return { id: newId(), title: "New chat", created: now, updated: now, messages: [] };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved && Array.isArray(saved.chats) && saved.chats.length) {
      saved.chats.forEach((c) => { if (!Array.isArray(c.messages)) c.messages = []; });
      return saved;
    }
  } catch (e) { /* ignore: start fresh */ }
  return null;
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

let state = loadState() || { activeId: null, chats: [] };
if (state.chats.length === 0) {
  const first = makeChat();
  state.chats.push(first);
  state.activeId = first.id;
}
if (!state.chats.some((c) => c.id === state.activeId)) state.activeId = state.chats[0].id;

const pending = new Set();   // ids of chats waiting for a reply right now
const drafts = {};           // files attached but not sent yet, per chat id
let preparing = false;       // true for a moment while a message is being sent

function activeChat() {
  return state.chats.find((c) => c.id === state.activeId);
}

function chatFileIds(chat) {
  return chat.messages.flatMap((m) => (m.files || []).map((f) => f.id));
}

function chatFileBytes(chat) {
  return chat.messages.reduce(
    (sum, m) => sum + (m.files || []).reduce((s, f) => s + (f.size || 0), 0), 0
  );
}

async function trimOldChats() {
  while (state.chats.length > MAX_SAVED_CHATS) {
    const candidates = state.chats
      .filter((c) => c.id !== state.activeId && !pending.has(c.id))
      .sort((a, b) => a.updated - b.updated);
    if (!candidates.length) break;
    const oldest = candidates[0];
    await deleteFiles(chatFileIds(oldest));
    state.chats = state.chats.filter((c) => c !== oldest);
  }
}

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

// Turns "Correct (9/10)" into a colored grade stamp.
function gradeChip(label) {
  const l = label.toLowerCase();
  let kind = "neutral";
  if (l.includes("partial")) kind = "partial";
  else if (l.includes("incorrect")) kind = "wrong";
  else if (l.includes("correct")) kind = "right";
  return '<div class="grade grade-' + kind + '">' + label + "</div>";
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
    // A line like **Grade: Correct (9/10)** becomes a grade stamp.
    const grade = line.match(/^\s*\*\*Grade:\s*(.+?)\*\*\s*$/i);
    if (grade) {
      flushParagraph();
      closeList();
      html += gradeChip(grade[1]);
      continue;
    }

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

// ---------- Downloading a reply ----------
// Saves one bot reply as a plain text (.txt) file on the person's device.
function downloadReply(replyText, sources) {
  let cleanText = replyText.replace(/\*\*(.+?)\*\*/g, "$1");

  // If the reply used the web, add the list of sources at the bottom.
  if (sources && sources.length) {
    cleanText += "\n\nSources:\n" + sources.map((s) => "- " + s.title + ": " + s.uri).join("\n");
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) +
    "-" + pad(now.getHours()) + pad(now.getMinutes());
  const botName = BOT_CONFIG.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const fileName = botName + "-reply-" + stamp + ".txt";

  const blob = new Blob([cleanText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Showing messages ----------
function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

// who = "bot" or "user". opts can include:
//   instant (no animation), files (names to show), download (add Download button),
//   isError (red edge), retry (function: adds a "Try again" button),
//   kb (the notes used for this answer), sources (web links used),
//   searchHtml (Google's search suggestions box)
function addBubble(who, text, opts) {
  opts = opts || {};
  const div = document.createElement("div");
  div.className = "msg " + who + (opts.isError ? " error" : "") + (opts.instant ? " instant" : "");

  if (who === "user") {
    if (opts.files && opts.files.length) {
      const row = document.createElement("div");
      row.className = "msg-files";
      opts.files.forEach((f) => {
        const pill = document.createElement("span");
        pill.className = "file-pill";
        pill.textContent = "\uD83D\uDCCE " + f.name;
        row.appendChild(pill);
      });
      div.appendChild(row);
    }
    const body = document.createElement("div");
    body.textContent = text;            // plain text, always safe
    div.appendChild(body);
  } else if (opts.isError) {
    const p = document.createElement("p");
    p.textContent = text;
    div.appendChild(p);
  } else {
    div.innerHTML = formatText(text);   // escaped first, then formatted
  }

  // "Sources": the notes from your knowledge file that this answer was based on
  if (opts.kb && opts.kb.notes && opts.kb.notes.length) {
    const details = document.createElement("details");
    details.className = "kb-sources";

    const count = opts.kb.notes.length;
    const summary = document.createElement("summary");
    summary.textContent =
      "Sources (" + count + (count === 1 ? " note" : " notes") + " \u00B7 " +
      (opts.kb.method === "meaning" ? "meaning" : "keyword") + " search)";
    details.appendChild(summary);

    opts.kb.notes.forEach((n, i) => {
      const item = document.createElement("div");
      item.className = "kb-item";

      const head = document.createElement("div");
      head.className = "kb-head";
      const title = document.createElement("span");
      title.className = "kb-title";
      title.textContent = "[" + (i + 1) + "] " + n.title;
      const score = document.createElement("span");
      score.className = "kb-score";
      score.textContent = "score " + Number(n.score).toFixed(2);
      head.appendChild(title);
      head.appendChild(score);

      const preview = document.createElement("p");
      preview.className = "kb-preview";
      preview.textContent = n.preview;

      item.appendChild(head);
      item.appendChild(preview);
      details.appendChild(item);
    });
    div.appendChild(details);
  }

  // Links to the web pages the bot used
  if (opts.sources && opts.sources.length) {
    const box = document.createElement("div");
    box.className = "sources";
    const label = document.createElement("span");
    label.className = "sources-label";
    label.textContent = "Web";
    box.appendChild(label);
    opts.sources.forEach((s) => {
      if (!/^https?:\/\//i.test(s.uri)) return;   // only real web links
      const a = document.createElement("a");
      a.className = "source-link";
      a.href = s.uri;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = s.title;
      a.title = s.uri;
      box.appendChild(a);
    });
    div.appendChild(box);
  }

  // Google requires its "search suggestions" box to be shown after a Google search.
  // It is displayed exactly as Google provides it, inside a locked-down frame.
  if (opts.searchHtml) {
    const frame = document.createElement("iframe");
    frame.className = "search-suggest";
    frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    frame.setAttribute("title", "Google Search suggestions");
    frame.srcdoc = opts.searchHtml;
    div.appendChild(frame);
  }

  if (opts.download) {
    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "dl-btn";
    dl.textContent = "\u2B07 Download";
    dl.setAttribute("aria-label", "Download this reply as a text file");
    dl.addEventListener("click", () => downloadReply(text, opts.sources));
    div.appendChild(dl);
  }

  if (opts.retry) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "dl-btn retry-btn";
    retry.textContent = "Try again";
    retry.addEventListener("click", opts.retry);
    div.appendChild(retry);
  }

  chatEl.appendChild(div);
  return div;
}

let typingEl = null;

function showTyping() {
  if (typingEl) return;
  typingEl = document.createElement("div");
  typingEl.className = "msg bot typing";
  typingEl.setAttribute("aria-label", "Thinking");
  typingEl.innerHTML = "<span></span><span></span><span></span>";
  chatEl.appendChild(typingEl);
  scrollToBottom();
}

function hideTyping() {
  if (typingEl) {
    typingEl.remove();
    typingEl = null;
  }
}

function removeErrorBubbles() {
  chatEl.querySelectorAll(".msg.error").forEach((el) => el.remove());
}

function showStarters() {
  const wrap = document.createElement("div");
  wrap.className = "starters";
  wrap.id = "starters";

  BOT_CONFIG.starterQuestions.forEach((q, i) => {
    // Split "Question? (description)" into a title and a description.
    const match = q.match(/^(.*?)\s*\((.*)\)\s*$/);
    const title = match ? match[1] : q;
    const detail = match ? match[2] : "";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "starter";

    const num = document.createElement("span");
    num.className = "starter-num";
    num.textContent = i + 1;

    const body = document.createElement("span");
    body.className = "starter-body";

    const titleEl = document.createElement("span");
    titleEl.className = "starter-title";
    titleEl.textContent = title;
    body.appendChild(titleEl);

    if (detail) {
      const detailEl = document.createElement("span");
      detailEl.className = "starter-detail";
      detailEl.textContent = detail;
      body.appendChild(detailEl);
    }

    button.appendChild(num);
    button.appendChild(body);
    button.addEventListener("click", () => sendMessage(q));
    wrap.appendChild(button);
  });

  chatEl.appendChild(wrap);
}

function removeStarters() {
  const s = document.getElementById("starters");
  if (s) s.remove();
}

// If the last message in a chat is the student's and nothing answered it,
// show a red note with a "Try again" button.
function showUnanswered(chat) {
  const last = chat.messages[chat.messages.length - 1];
  if (last && last.role === "user") {
    addBubble("bot", chat.error || "I didn't get to answer your last message.", {
      isError: true,
      retry: () => retryLast(chat)
    });
  }
}

// Draws the whole active chat from scratch (used when switching chats).
function renderConversation() {
  const chat = activeChat();
  typingEl = null;
  chatEl.innerHTML = "";

  if (chat.messages.length === 0) {
    addBubble("bot", BOT_CONFIG.welcomeMessage);
    showStarters();
  } else {
    chat.messages.forEach((m) => {
      if (m.role === "user") {
        addBubble("user", m.text, { files: m.files, instant: true });
      } else {
        addBubble("bot", m.text, {
          download: true,
          instant: true,
          kb: m.kb,
          sources: m.sources,
          searchHtml: m.searchHtml
        });
      }
    });
    if (pending.has(chat.id)) showTyping();
    else showUnanswered(chat);
  }
  scrollToBottom();
}

// ---------- Chat list (the left panel) ----------
function renderChatList() {
  chatListEl.innerHTML = "";
  const sorted = [...state.chats].sort((a, b) => b.updated - a.updated);

  sorted.forEach((chat) => {
    const li = document.createElement("li");
    li.className = "chat-item";
    if (chat.id === state.activeId) li.classList.add("active");
    if (chat.unread) li.classList.add("unread");
    if (pending.has(chat.id)) li.classList.add("pending");

    const open = document.createElement("button");
    open.type = "button";
    open.className = "chat-open";

    const title = document.createElement("span");
    title.className = "chat-title";
    title.textContent = chat.title;

    const meta = document.createElement("span");
    meta.className = "chat-meta";
    if (pending.has(chat.id)) meta.textContent = "Thinking\u2026";
    else if (chat.messages.length === 0) meta.textContent = "Not started";
    else meta.textContent = formatDate(chat.updated);

    open.appendChild(title);
    open.appendChild(meta);
    open.addEventListener("click", () => setActive(chat.id));

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "chat-act";
    rename.textContent = "\u270E";
    rename.setAttribute("aria-label", "Rename chat");
    rename.addEventListener("click", () => renameChat(chat));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "chat-act";
    del.textContent = "\u2715";
    del.setAttribute("aria-label", "Delete chat");
    del.addEventListener("click", () => deleteChat(chat));

    li.appendChild(open);
    li.appendChild(rename);
    li.appendChild(del);
    chatListEl.appendChild(li);
  });
}

function refreshAll() {
  saveState();
  closeSidebar();
  renderChatList();
  renderConversation();
  renderChips();
  updateSendState();
}

function setActive(id) {
  state.activeId = id;
  const chat = activeChat();
  if (chat) chat.unread = false;
  refreshAll();
}

function newChat() {
  const current = activeChat();
  // Don't pile up empty chats: reuse the empty one we already have.
  if (current && current.messages.length === 0) {
    closeSidebar();
    inputEl.focus();
    return;
  }
  const chat = makeChat();
  state.chats.unshift(chat);
  state.activeId = chat.id;
  trimOldChats().then(() => { saveState(); renderChatList(); });
  refreshAll();
  inputEl.focus();
}

function renameChat(chat) {
  const name = prompt("Rename this chat:", chat.title);
  if (name === null) return;
  const clean = name.trim();
  if (!clean) return;
  chat.title = clean.slice(0, 60);
  saveState();
  renderChatList();
}

async function deleteChat(chat) {
  if (!confirm('Delete "' + chat.title + '"? Its attached files will be removed too.')) return;
  await deleteFiles(chatFileIds(chat));
  state.chats = state.chats.filter((c) => c !== chat);
  delete drafts[chat.id];
  if (state.chats.length === 0) state.chats.push(makeChat());
  if (state.activeId === chat.id) {
    const latest = [...state.chats].sort((a, b) => b.updated - a.updated)[0];
    state.activeId = latest.id;
  }
  refreshAll();
}

function openSidebar() {
  sidebarEl.classList.add("open");
  scrimEl.hidden = false;
}

function closeSidebar() {
  sidebarEl.classList.remove("open");
  scrimEl.hidden = true;
}

menuBtn.addEventListener("click", openSidebar);
sidebarClose.addEventListener("click", closeSidebar);
scrimEl.addEventListener("click", closeSidebar);
newChatBtn.addEventListener("click", newChat);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!keyModal.hidden) closeModal();
  else closeSidebar();
});

// ---------- Attaching files ----------
const TEXT_TYPES = ["txt", "md", "markdown", "csv", "tsv", "json", "html"];
const INLINE_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp"
};

function classifyFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (TEXT_TYPES.includes(ext)) return { kind: "text", mime: "text/plain" };
  if (INLINE_TYPES[ext]) return { kind: "inline", mime: INLINE_TYPES[ext] };
  return null;
}

function unsupportedReason(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (["doc", "docx", "ppt", "pptx", "xls", "xlsx"].includes(ext)) {
    return "Word, PowerPoint and Excel files can't be read yet. Save it as a PDF (File > Save As) and attach that.";
  }
  return "That file type isn't supported. Use a PDF, an image (PNG, JPG, WebP) or a text file.";
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleFiles(fileList) {
  const chat = activeChat();
  drafts[chat.id] = drafts[chat.id] || [];
  const list = drafts[chat.id];
  const problems = [];

  for (const file of Array.from(fileList)) {
    const type = classifyFile(file);
    if (!type) {
      problems.push('"' + file.name + '": ' + unsupportedReason(file));
      continue;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      problems.push('"' + file.name + '" is bigger than ' + MAX_FILE_MB + " MB.");
      continue;
    }
    const used = chatFileBytes(chat) + list.reduce((sum, f) => sum + f.size, 0);
    if (used + file.size > MAX_CHAT_FILES_MB * 1024 * 1024) {
      problems.push("This chat already holds a lot of files (limit " + MAX_CHAT_FILES_MB + ' MB). Start a new chat to add "' + file.name + '".');
      continue;
    }
    try {
      const data = type.kind === "text" ? await file.text() : await readBase64(file);
      list.push({ id: newId(), name: file.name, mime: type.mime, kind: type.kind, size: file.size, data: data });
    } catch (e) {
      problems.push('Couldn\'t read "' + file.name + '".');
    }
  }

  renderChips();
  if (problems.length) showToast(problems.join(" "));
  fileInput.value = "";
}

// The small "chips" above the message box showing files waiting to be sent.
function renderChips() {
  const list = drafts[state.activeId] || [];
  attachmentsEl.innerHTML = "";
  attachmentsEl.hidden = list.length === 0;

  list.forEach((f) => {
    const chip = document.createElement("span");
    chip.className = "chip";

    const name = document.createElement("span");
    name.className = "chip-name";
    name.textContent = f.name;

    const size = document.createElement("span");
    size.className = "chip-size";
    size.textContent = formatSize(f.size);

    const x = document.createElement("button");
    x.type = "button";
    x.className = "chip-x";
    x.textContent = "\u2715";
    x.setAttribute("aria-label", "Remove " + f.name);
    x.addEventListener("click", () => {
      drafts[state.activeId] = (drafts[state.activeId] || []).filter((item) => item.id !== f.id);
      renderChips();
    });

    chip.appendChild(name);
    chip.appendChild(size);
    chip.appendChild(x);
    attachmentsEl.appendChild(chip);
  });
}

attachBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFiles(fileInput.files);
});

// Drag and drop files anywhere on the chat area
let dragDepth = 0;
function dragHasFiles(e) {
  return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
}
mainEl.addEventListener("dragenter", (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  mainEl.classList.add("dragging");
});
mainEl.addEventListener("dragover", (e) => { if (dragHasFiles(e)) e.preventDefault(); });
mainEl.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) mainEl.classList.remove("dragging");
});
mainEl.addEventListener("drop", (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  mainEl.classList.remove("dragging");
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

// =====================================================================
// YOUR NOTES (knowledge.md): loading, "meaning search", keyword search
// =====================================================================
const KB_CACHE_KEY = "rmibot_kb_v1";
const MAX_NOTE_CHARS = 1500;   // longer notes are split into parts at blank lines

const kb = {
  state: "idle",      // idle | loading | missing | empty | ready
  chunks: [],         // every note (or part of a note): { title, text }
  noteCount: 0,       // how many "## ..." notes the file has
  fingerprint: "",    // changes whenever knowledge.md (or the embedding model) changes
  vectors: null,      // one list of "meaning numbers" per chunk
  embedding: null,    // a promise while the meaning numbers are being made
  retryAfter: 0,      // wait a bit before trying again after a failure
  problem: "",        // short reason why meaning search isn't working
  loadPromise: null
};

const STOPWORDS = new Set([
  "the", "and", "for", "are", "was", "were", "you", "your", "what", "which", "who", "whom",
  "how", "why", "when", "where", "does", "did", "can", "could", "would", "should", "this",
  "that", "these", "those", "with", "from", "about", "into", "have", "has", "had", "not",
  "but", "any", "all", "our", "out", "its", "than", "then", "them", "they", "their", "there",
  "here", "tell", "give", "please", "need", "want", "explain", "describe", "define"
]);

// A short code that changes whenever the text changes.
function fingerprint(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + "-" + str.length;
}

// Cuts a long note into parts of about maxLen characters, at blank lines.
function splitLongText(body, maxLen) {
  if (body.length <= maxLen) return [body];

  const parts = [];
  let current = "";
  function pushCurrent() {
    if (current.trim()) parts.push(current.trim());
    current = "";
  }

  body.split(/\n\s*\n/).forEach((raw) => {
    const paragraph = raw.trim();
    if (!paragraph) return;

    // One single paragraph that is longer than the limit: cut it at a sentence or space.
    if (paragraph.length > maxLen) {
      pushCurrent();
      let rest = paragraph;
      while (rest.length > maxLen) {
        let cut = rest.lastIndexOf(". ", maxLen);
        if (cut >= maxLen * 0.5) {
          cut += 1;
        } else {
          cut = rest.lastIndexOf(" ", maxLen);
          if (cut < maxLen * 0.5) cut = maxLen;
        }
        parts.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
      return;
    }

    if (current && current.length + 2 + paragraph.length > maxLen) pushCurrent();
    current = current ? current + "\n\n" + paragraph : paragraph;
  });
  pushCurrent();
  return parts;
}

// Turns the text of knowledge.md into a list of notes.
// Every note starts with a "## Title" line. Anything above the first one is ignored.
function parseKnowledge(rawText) {
  const lines = rawText.replace(/\r\n?/g, "\n").split("\n");
  const notes = [];
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1], lines: [] };
      notes.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  const chunks = [];
  let noteCount = 0;
  notes.forEach((note) => {
    const body = note.lines.join("\n").trim();
    if (!body) return;   // a title with no text under it is skipped
    noteCount++;
    const parts = splitLongText(body, MAX_NOTE_CHARS);
    parts.forEach((part, i) => {
      const title = parts.length > 1
        ? note.title + " (part " + (i + 1) + " of " + parts.length + ")"
        : note.title;
      chunks.push({ title: title, text: part });
    });
  });
  return { noteCount: noteCount, chunks: chunks };
}

// ---- Status line under the header ----
function renderKbStatus() {
  if (!BOT_CONFIG.useKnowledge) {
    kbStatusEl.hidden = true;
    return;
  }
  const file = BOT_CONFIG.knowledgeFile || "knowledge.md";
  let text = "";
  let level = "";

  if (kb.state === "idle" || kb.state === "loading") {
    text = "\uD83D\uDCDA Loading your notes\u2026";
  } else if (kb.state === "missing") {
    text = "\uD83D\uDCDA Couldn't find " + file + ". Add it to your GitHub repository, in the same folder as index.html.";
    level = "error";
  } else if (kb.state === "empty") {
    text = "\uD83D\uDCDA " + file + " has no notes yet. Start each note with a line like:  ## Note title";
    level = "warn";
  } else {
    let count = kb.noteCount + (kb.noteCount === 1 ? " note" : " notes");
    if (kb.chunks.length !== kb.noteCount) count += " (" + kb.chunks.length + " parts)";

    let how;
    if (BOT_CONFIG.searchMethod === "keywords") {
      how = "keyword search";
    } else if (kb.vectors && !kb.problem) {
      how = "meaning search";
    } else if (kb.embedding) {
      how = "preparing meaning search\u2026";
    } else if (!getKey()) {
      how = "keyword search for now (add your API key for meaning search)";
    } else {
      how = "keyword search (meaning search unavailable" + (kb.problem ? ": " + kb.problem : "") + ")";
      level = "warn";
    }
    text = "\uD83D\uDCDA " + count + " loaded \u00B7 " + how;
  }

  kbStatusEl.textContent = text;
  kbStatusEl.className = "kb-status" + (level ? " " + level : "");
  kbStatusEl.hidden = false;
}

// ---- Loading knowledge.md ----
async function loadKnowledgeFile() {
  kb.state = "loading";
  renderKbStatus();

  const file = BOT_CONFIG.knowledgeFile || "knowledge.md";
  let text;
  try {
    const response = await fetch(file, { cache: "no-cache" });
    if (!response.ok) throw new Error("status " + response.status);
    text = await response.text();
  } catch (e) {
    kb.state = "missing";
    kb.chunks = [];
    kb.vectors = null;
    renderKbStatus();
    return false;
  }

  const parsed = parseKnowledge(text);
  kb.chunks = parsed.chunks;
  kb.noteCount = parsed.noteCount;
  kb.vectors = null;
  kb.fingerprint = fingerprint(text + "|" + (BOT_CONFIG.embeddingModel || "gemini-embedding-2"));

  if (kb.chunks.length === 0) {
    kb.state = "empty";
    renderKbStatus();
    return false;
  }
  kb.state = "ready";
  return true;
}

function ensureKnowledgeLoaded() {
  if (!kb.loadPromise) {
    kb.loadPromise = loadKnowledgeFile().then((ok) => {
      if (!ok) kb.loadPromise = null;   // allow trying again later
      return ok;
    });
  }
  return kb.loadPromise;
}

// ---- Embeddings (turning text into "meaning numbers") ----
async function embedTexts(texts, key) {
  const model = BOT_CONFIG.embeddingModel || "gemini-embedding-2";
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":batchEmbedContents";

  const all = [];
  for (let start = 0; start < texts.length; start += 50) {   // at most 50 notes per request
    const batch = texts.slice(start, start + 50);
    const body = {
      requests: batch.map((t) => ({
        model: "models/" + model,
        content: { parts: [{ text: t }] }
      }))
    };

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw { kind: "network" };
    }

    if (!response.ok) {
      let detail = "";
      try {
        const errBody = await response.json();
        detail = (errBody.error && errBody.error.message) || "";
      } catch (e) { /* ignore */ }
      throw { kind: "http", status: response.status, detail: detail };
    }

    const data = await response.json();
    const list = data.embeddings || [];
    if (list.length !== batch.length) throw { kind: "embedding" };
    list.forEach((item) => all.push(item.values));
  }
  return all;
}

function describeEmbedError(err) {
  if (err && err.kind === "network") return "no internet connection";
  if (err && err.kind === "http") {
    if (err.status === 400 || err.status === 403) return "Google rejected the request, check your API key (error " + err.status + ")";
    if (err.status === 404) return "check embeddingModel in config.js";
    if (err.status === 429) return "rate limit, will try again soon";
    return "Google error " + err.status;
  }
  return "unexpected problem";
}

function roundVector(values) {
  return values.map((v) => Math.round(v * 1e5) / 1e5);   // shorter numbers = less storage
}

function loadCachedVectors() {
  try {
    const raw = localStorage.getItem(KB_CACHE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved && saved.fp === kb.fingerprint && Array.isArray(saved.vectors) &&
        saved.vectors.length === kb.chunks.length) {
      return saved.vectors;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveCachedVectors(vectors) {
  try {
    localStorage.setItem(KB_CACHE_KEY, JSON.stringify({ fp: kb.fingerprint, vectors: vectors }));
  } catch (e) { /* storage full or blocked: it still works, just re-made next visit */ }
}

// Makes (or loads from storage) the meaning numbers for every note.
async function prepareEmbeddings(force) {
  if (BOT_CONFIG.searchMethod === "keywords") return;
  if (kb.vectors || kb.chunks.length === 0) return;
  if (kb.embedding) return kb.embedding;

  const key = getKey();
  if (!key) return;                                  // wait until an API key is saved
  if (!force && Date.now() < kb.retryAfter) return;  // recently failed: wait a little

  kb.embedding = (async () => {
    const cached = loadCachedVectors();
    if (cached) {
      kb.vectors = cached;
      kb.problem = "";
      return;
    }
    try {
      const texts = kb.chunks.map((c) => "title: " + c.title + " | text: " + c.text);
      const vectors = await embedTexts(texts, key);
      kb.vectors = vectors.map(roundVector);
      kb.problem = "";
      kb.retryAfter = 0;
      saveCachedVectors(kb.vectors);
    } catch (err) {
      kb.vectors = null;
      kb.problem = describeEmbedError(err);
      kb.retryAfter = Date.now() + 60000;
    }
  })().finally(() => {
    kb.embedding = null;
    renderKbStatus();
  });

  renderKbStatus();   // shows "preparing meaning search..."
  return kb.embedding;
}

// Called when the page opens and when an API key is saved.
async function initKnowledge(force) {
  if (!BOT_CONFIG.useKnowledge) {
    renderKbStatus();
    return;
  }
  const loaded = await ensureKnowledgeLoaded();
  if (loaded) await prepareEmbeddings(force);
  renderKbStatus();
}

// ---- Searching ----
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Simple keyword search: the more of your question's words a note contains
// (and the more they appear in its title), the higher its score (0 to 1).
function keywordScores(question) {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const terms = [...new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];
  if (!terms.length) return [];

  return kb.chunks.map((chunk) => {
    const title = chunk.title.toLowerCase();
    const text = chunk.text.toLowerCase();
    let total = 0;

    terms.forEach((term) => {
      const pattern = "(?:^|[^\\p{L}\\p{N}])" + escapeRegExp(term);
      const inTitle = new RegExp(pattern, "u").test(title);
      const count = (text.match(new RegExp(pattern, "gu")) || []).length;
      total += (inTitle ? 0.5 : 0) + 0.5 * Math.min(count, 3) / 3;
    });
    return { chunk: chunk, score: total / terms.length };
  });
}

// Finds the best notes for a question. Returns null if notes aren't in use.
async function retrieveNotes(question) {
  if (!BOT_CONFIG.useKnowledge) return null;
  await ensureKnowledgeLoaded();
  if (kb.chunks.length === 0) return null;

  const topK = Math.max(1, Number(BOT_CONFIG.topK) || 3);
  let method = BOT_CONFIG.searchMethod === "keywords" ? "keywords" : "meaning";
  let scored = null;

  if (method === "meaning") {
    try {
      await prepareEmbeddings(false);
      if (!kb.vectors) throw { kind: "unavailable" };
      const queryVectors = await embedTexts(["task: search result | query: " + question], getKey());
      const q = queryVectors[0];
      scored = kb.chunks.map((chunk, i) => ({ chunk: chunk, score: cosine(q, kb.vectors[i]) }));
      if (kb.problem) {
        kb.problem = "";
        renderKbStatus();
      }
    } catch (err) {
      // Meaning search didn't work: switch to keyword search automatically.
      scored = null;
      if (kb.vectors) {
        kb.problem = describeEmbedError(err);
        renderKbStatus();
      }
    }
  }

  if (!scored) {
    method = "keywords";
    scored = keywordScores(question);
  }

  const picked = scored
    .filter((s) => method === "meaning" || s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => ({ title: s.chunk.title, text: s.chunk.text, score: s.score }));

  return { method: method, notes: picked };
}

// The text that goes to Gemini: numbered notes [1] [2] [3].
function notesBlock(retrieval) {
  if (!retrieval.notes.length) {
    return "NOTES from my knowledge file:\n(No matching notes were found.)";
  }
  return "NOTES from my knowledge file:\n\n" +
    retrieval.notes.map((n, i) => "[" + (i + 1) + "] " + n.title + "\n" + n.text).join("\n\n");
}

// A small summary saved with the reply, so "Sources" can be shown later.
function summarizeRetrieval(retrieval) {
  return {
    method: retrieval.method,
    notes: retrieval.notes.map((n) => ({
      title: n.title,
      score: Math.round(n.score * 1000) / 1000,
      preview: n.text.length > 220 ? n.text.slice(0, 220).trim() + "\u2026" : n.text
    }))
  };
}

// ---------- Talking to Gemini ----------

// Pauses for a number of milliseconds (used between retries).
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The bot's rules from config.js, plus the list of useful websites,
// plus the notes rules when notes are being sent with this question.
function buildSystemText(withKnowledge) {
  let text = BOT_CONFIG.systemInstructions;
  const sites = BOT_CONFIG.usefulWebsites || [];
  if (sites.length && BOT_CONFIG.enableUrlReading !== false) {
    text += "\n\nUseful websites you can read when relevant:\n" +
      sites.map((s) => "- " + s.name + ": " + s.url).join("\n");
  }
  if (withKnowledge && BOT_CONFIG.knowledgeRules) {
    text += "\n\n" + BOT_CONFIG.knowledgeRules;
  }
  return text;
}

// Which web tools to give the bot (set in config.js).
function buildTools() {
  const tools = [];
  if (BOT_CONFIG.enableUrlReading !== false) tools.push({ url_context: {} });
  if (BOT_CONFIG.enableGoogleSearch !== false) tools.push({ google_search: {} });
  return tools;
}

// If the student's message mentions one of the sites in config.js
// (for example "Don Quijote"), return that site so we can point the bot to it.
function websiteHints(text) {
  const lower = text.toLowerCase();
  return (BOT_CONFIG.usefulWebsites || []).filter((site) => {
    const words = site.keywords && site.keywords.length ? site.keywords : [site.name];
    const mentioned = words.some((w) => lower.includes(w.toLowerCase()));
    return mentioned && !lower.includes(site.url.toLowerCase());
  });
}

// Turns a saved chat into the "contents" list Gemini expects,
// loading any attached files from the browser's file storage.
// If notes were found for the latest question, they are added to that one
// message only. The saved chat keeps just your plain question.
async function buildContents(chat, retrieval) {
  const contents = [];
  const lastIndex = chat.messages.length - 1;

  for (let index = 0; index < chat.messages.length; index++) {
    const m = chat.messages[index];
    const role = m.role === "user" ? "user" : "model";
    const parts = [];

    for (const f of m.files || []) {
      const rec = await getFile(f.id);
      if (!rec) {
        parts.push({ text: '[The student attached "' + f.name + '" but the file is no longer available.]' });
      } else if (rec.kind === "text") {
        parts.push({ text: '[Attached file: ' + f.name + "]\n" + rec.data + "\n[End of file]" });
      } else {
        parts.push({ text: "[Attached file: " + f.name + "]" });
        parts.push({ inlineData: { mimeType: rec.mime, data: rec.data } });
      }
    }

    if (retrieval && index === lastIndex && m.role === "user") {
      parts.push({ text: notesBlock(retrieval) });
      parts.push({ text: "QUESTION: " + m.text });
    } else {
      parts.push({ text: m.text });
    }

    // Gemini likes alternating turns, so merge two messages from the same side.
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role: role, parts: parts });
  }

  // Point the bot to a site from config.js if the latest message mentions it.
  const lastMsg = chat.messages[lastIndex];
  const lastContent = contents[contents.length - 1];
  if (BOT_CONFIG.enableUrlReading !== false && lastMsg && lastMsg.role === "user" && lastContent) {
    websiteHints(lastMsg.text).forEach((site) => {
      lastContent.parts.push({ text: "(Page you may read for this question: " + site.url + " - " + site.name + ")" });
    });
  }
  return contents;
}

function hostName(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return url; }
}

// Collects the web pages the bot used, so we can show them as sources.
function collectSources(candidate) {
  const found = [];
  const seen = {};
  function add(title, uri) {
    if (!uri || !/^https?:\/\//i.test(uri) || seen[uri]) return;
    seen[uri] = true;
    found.push({ title: title || hostName(uri), uri: uri });
  }

  const grounding = candidate.groundingMetadata;
  if (grounding && grounding.groundingChunks) {
    grounding.groundingChunks.forEach((c) => { if (c.web) add(c.web.title, c.web.uri); });
  }
  const urlMeta = candidate.urlContextMetadata;
  if (urlMeta && urlMeta.urlMetadata) {
    urlMeta.urlMetadata.forEach((u) => {
      if (!u.urlRetrievalStatus || /SUCCESS/.test(u.urlRetrievalStatus)) {
        add(hostName(u.retrievedUrl), u.retrievedUrl);
      }
    });
  }
  return found.slice(0, 6);
}

// Sends ONE request to ONE model. Throws an error if it fails.
// opts.tools = use the web tools, opts.knowledge = add the notes rules.
async function callModel(model, key, contents, opts) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent";

  const body = {
    systemInstruction: { parts: [{ text: buildSystemText(opts.knowledge) }] },
    contents: contents
  };
  const tools = opts.tools ? buildTools() : [];
  if (tools.length) body.tools = tools;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw { kind: "network" };
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errBody = await response.json();
      detail = (errBody.error && errBody.error.message) || "";
    } catch (e) { /* ignore */ }
    throw { kind: "http", status: response.status, detail: detail };
  }

  const data = await response.json();
  const candidate = (data.candidates && data.candidates[0]) || {};
  const parts = (candidate.content && candidate.content.parts) || [];

  // Join the text parts and skip any "thinking" parts.
  const text = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("");

  if (!text.trim()) {
    const reason = data.promptFeedback && data.promptFeedback.blockReason;
    throw { kind: "empty", reason: reason };
  }

  const grounding = candidate.groundingMetadata;
  return {
    text: text,
    sources: collectSources(candidate),
    searchHtml: (grounding && grounding.searchEntryPoint && grounding.searchEntryPoint.renderedContent) || ""
  };
}

// Tries the main model up to 3 times if Google is having a temporary
// problem (error 500 or higher), then tries the backup model.
async function askWithModels(key, contents, opts) {
  const models = [BOT_CONFIG.model];
  if (BOT_CONFIG.fallbackModel && BOT_CONFIG.fallbackModel !== BOT_CONFIG.model) {
    models.push(BOT_CONFIG.fallbackModel);
  }

  let firstError = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await callModel(model, key, contents, opts);
      } catch (err) {
        if (!firstError) firstError = err;

        const temporary = err && err.kind === "http" && err.status >= 500;
        if (!temporary) {
          // Not a temporary problem (bad key, wrong model name, no internet...).
          // Retrying won't help, so report the ORIGINAL problem right away.
          throw firstError;
        }
        if (attempt < 2) await wait(1500 * (attempt + 1)); // wait 1.5s, then 3s
      }
    }
  }
  throw firstError;
}

// Asks with the web tools on. If Google rejects the request (error 400, not a
// key problem), try once more without the web tools so you still get an answer.
async function askGemini(key, contents, withKnowledge) {
  try {
    return await askWithModels(key, contents, { tools: true, knowledge: withKnowledge });
  } catch (err) {
    const toolsOn = buildTools().length > 0;
    const maybeToolProblem =
      err && err.kind === "http" && err.status === 400 && !/api key/i.test(err.detail || "");
    if (toolsOn && maybeToolProblem) {
      try {
        return await askWithModels(key, contents, { tools: false, knowledge: withKnowledge });
      } catch (e) {
        throw err;
      }
    }
    throw err;
  }
}

function friendlyError(err) {
  const badKey = "Your API key was not accepted. Click the \"API key\" button and paste a valid key.";

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
    if (s === 400) {
      if (/api key/i.test(err.detail || "")) return badKey;
      return "Google couldn't process that request (error 400). If you attached a file, it may be damaged, password-protected, or too long. Try a different file.";
    }
    if (s === 403) return badKey;
    if (s === 404) {
      return "The model name wasn't found. Open config.js and check the \"model\" setting.";
    }
    if (s === 413) {
      return "Your attached files are too large for one request. Start a new chat with smaller files.";
    }
    if (s === 429) {
      return "Too many requests right now (rate limit). Wait a minute and try again.";
    }
    if (s >= 500) {
      return "Google's server is busy or having problems (error " + s + "). I tried a few times. Please try again in a minute.";
    }
    return "Something went wrong (error " + s + "). Please try again.";
  }
  return "Something unexpected went wrong. Please try again.";
}

// ---------- Sending a message ----------
function updateSendState() {
  sendBtn.disabled = pending.has(state.activeId);
}

// Asks Gemini to answer the latest message in a chat.
// Works even if you switch to another chat while it thinks.
async function requestReply(chat) {
  pending.add(chat.id);
  chat.error = "";
  updateSendState();
  renderChatList();
  if (chat.id === state.activeId) {
    removeErrorBubbles();
    showTyping();
  }

  try {
    // 1) Find the best notes for this question (if notes are turned on).
    const lastMsg = chat.messages[chat.messages.length - 1];
    let retrieval = null;
    try {
      retrieval = await retrieveNotes(lastMsg.text);
    } catch (e) {
      retrieval = null;   // never let a notes problem stop the answer
    }

    // 2) Ask Gemini, with the notes attached to this one question.
    const contents = await buildContents(chat, retrieval);
    const result = await askGemini(getKey(), contents, !!retrieval);

    if (!state.chats.includes(chat)) return;   // the chat was deleted meanwhile
    const kbSummary = retrieval ? summarizeRetrieval(retrieval) : null;
    chat.messages.push({
      role: "bot",
      text: result.text,
      kb: kbSummary,
      sources: result.sources,
      searchHtml: result.searchHtml
    });
    chat.updated = Date.now();
    if (chat.id !== state.activeId) chat.unread = true;
    saveState();

    if (chat.id === state.activeId) {
      hideTyping();
      addBubble("bot", result.text, {
        download: true,
        kb: kbSummary,
        sources: result.sources,
        searchHtml: result.searchHtml
      });
      scrollToBottom();
    }
  } catch (err) {
    if (!state.chats.includes(chat)) return;
    chat.error = friendlyError(err);
    if (chat.id === state.activeId) {
      hideTyping();
      showUnanswered(chat);
      scrollToBottom();
    }
  } finally {
    pending.delete(chat.id);
    updateSendState();
    renderChatList();
  }
}

function retryLast(chat) {
  if (pending.has(chat.id)) return;
  if (!getKey()) {
    openModal("Please paste your Gemini API key to continue.");
    return;
  }
  requestReply(chat);
}

async function sendMessage(rawText) {
  const chat = activeChat();
  const typed = (rawText || "").trim();
  const draft = drafts[chat.id] || [];

  if ((!typed && draft.length === 0) || pending.has(chat.id) || preparing) return;
  if (!getKey()) {
    openModal("Please paste your Gemini API key to start chatting.");
    return;
  }

  preparing = true;
  try {
    const text = typed || FILE_ONLY_PROMPT;

    // Save the attached files in the browser, linked to this chat.
    for (const rec of draft) await putFile(rec);
    const message = {
      role: "user",
      text: text,
      files: draft.map((f) => ({ id: f.id, name: f.name, size: f.size }))
    };

    if (chat.messages.length === 0) {
      chat.title = makeTitle(typed || (draft[0] && draft[0].name) || "New chat");
    }
    chat.messages.push(message);
    chat.updated = Date.now();
    chat.unread = false;
    drafts[chat.id] = [];
    saveState();

    inputEl.value = "";
    autoGrow();
    renderChips();
    removeStarters();
    addBubble("user", text, { files: message.files });
    scrollToBottom();
  } finally {
    preparing = false;
  }

  requestReply(chat);
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

// ---------- Start! ----------
renderChatList();
renderConversation();
renderChips();
updateSendState();
initKnowledge(false);   // load knowledge.md and get "meaning search" ready
