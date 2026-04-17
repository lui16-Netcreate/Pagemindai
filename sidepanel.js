// sidepanel.js — PageMind AI

let apiKey = null;
let pageContent = null;
let chatHistory = [];
let isLoading = false;

document.addEventListener("DOMContentLoaded", () => {

  async function init() {
    const stored = await chrome.storage.local.get(["apiKey"]);
    apiKey = stored.apiKey || null;
    if (apiKey) {
      showMain();
      loadPage();
    } else {
      showSetup();
    }
  }

  function showSetup() {
    document.getElementById("setup-panel").style.display = "flex";
    document.getElementById("main-interface").style.display = "none";
  }

  function showMain() {
    document.getElementById("setup-panel").style.display = "none";
    const main = document.getElementById("main-interface");
    main.style.display = "flex";
    setTimeout(() => {
      const input = document.getElementById("question-input");
      if (input) input.focus();
    }, 150);
  }

  // API KEY SETUP
  document.getElementById("save-api-key").addEventListener("click", async () => {
    const val = document.getElementById("api-key-input").value.trim();
    if (!val.startsWith("sk-ant")) {
      showToast("Key should start with sk-ant…");
      return;
    }
    apiKey = val;
    await chrome.storage.local.set({ apiKey });
    showMain();
    loadPage();
  });

  document.getElementById("api-key-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("save-api-key").click();
  });

  document.getElementById("toggle-eye").addEventListener("click", () => {
    const input = document.getElementById("api-key-input");
    input.type = input.type === "password" ? "text" : "password";
  });

  // SETTINGS DRAWER
  document.getElementById("settings-btn").addEventListener("click", () => {
    const drawer = document.getElementById("settings-drawer");
    drawer.classList.toggle("open");
    if (drawer.classList.contains("open") && apiKey) {
      document.getElementById("settings-key").value = apiKey;
    }
  });

  document.getElementById("save-key-btn").addEventListener("click", async () => {
    const val = document.getElementById("settings-key").value.trim();
    if (val) {
      apiKey = val;
      await chrome.storage.local.set({ apiKey });
      document.getElementById("settings-drawer").classList.remove("open");
      showToast("✓ Key saved", true);
    }
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    apiKey = null;
    await chrome.storage.local.remove("apiKey");
    document.getElementById("settings-drawer").classList.remove("open");
    showSetup();
    showToast("Key removed");
  });

  // LOAD PAGE
  async function loadPage() {
    const pill = document.getElementById("doc-pill");
    const title = document.getElementById("doc-title");
    const meta = document.getElementById("doc-meta");

    pill.className = "doc-pill loading";
    title.textContent = "Reading page…";
    meta.textContent = "Extracting content";

    try {
      const res = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTENT" });
      if (res.error) throw new Error(res.error);
      pageContent = res.content;
      pill.className = "doc-pill loaded";
      title.textContent = pageContent.title || "Untitled Page";
      const typeLabel = pageContent.isPdf
        ? `PDF · ${pageContent.pageCount} pages · ${pageContent.wordCount.toLocaleString()} words · ready`
        : `${pageContent.wordCount.toLocaleString()} words · ready`;
      meta.textContent = typeLabel;
    } catch (err) {
      pill.className = "doc-pill error";
      title.textContent = "Could not read page";
      meta.textContent = err.message.slice(0, 80);
      showToast("Failed: " + err.message.slice(0, 80));
      console.error("[PageMind] Load error:", err.message);
    }
  }

  document.getElementById("doc-pill").addEventListener("click", loadPage);

  // CHAT INPUT
  const questionInput = document.getElementById("question-input");

  questionInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  questionInput.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 100) + "px";
  });

  document.getElementById("send-btn").addEventListener("click", sendMessage);

  // SEND MESSAGE
  async function sendMessage() {
    const input = document.getElementById("question-input");
    const question = input.value.trim();
    if (!question || isLoading) return;
    if (!pageContent) { showToast("Load a page first!"); return; }
    if (!apiKey) { showToast("No API key set"); return; }

    input.value = "";
    input.style.height = "auto";
    document.getElementById("empty-state").style.display = "none";

    appendMessage("user", question);
    const typingEl = appendTyping();
    isLoading = true;
    document.getElementById("send-btn").disabled = true;

    let streamEl = null;

    try {
      const finalText = await askClaudeStream(
        apiKey, pageContent, question, chatHistory.slice(-10),
        (partialText) => {
          if (!streamEl) {
            typingEl.remove();
            streamEl = appendStreamingBubble();
          }
          updateStreamingBubble(streamEl, partialText);
        }
      );

      if (streamEl) {
        finalizeStreamingBubble(streamEl, finalText);
      } else {
        typingEl.remove();
        appendMessage("ai", finalText);
      }

      chatHistory.push(
        { role: "user", content: question },
        { role: "assistant", content: finalText }
      );
    } catch (err) {
      typingEl.remove();
      if (streamEl) streamEl.remove();
      appendMessage("ai", "⚠ Error: " + err.message);
    } finally {
      isLoading = false;
      document.getElementById("send-btn").disabled = false;
      document.getElementById("question-input").focus();
    }
  }

  // SUGGESTION BUTTONS
  document.querySelectorAll(".suggestion").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("question-input").value = btn.textContent;
      sendMessage();
    });
  });

  // CLEAR CHAT
  document.getElementById("clear-btn").addEventListener("click", () => {
    const area = document.getElementById("chat-area");
    area.querySelectorAll(".message").forEach(el => el.remove());
    document.getElementById("empty-state").style.display = "";
    chatHistory = [];
  });

  // STREAMING BUBBLE HELPERS
  function appendStreamingBubble() {
    const area = document.getElementById("chat-area");
    const wrapper = document.createElement("div");
    wrapper.className = "message ai";

    const label = document.createElement("div");
    label.className = "msg-role";
    label.textContent = "PageMind";

    const bubble = document.createElement("div");
    bubble.className = "bubble streaming";

    wrapper.appendChild(label);
    wrapper.appendChild(bubble);
    area.appendChild(wrapper);
    area.scrollTop = area.scrollHeight;
    return wrapper;
  }

  function updateStreamingBubble(wrapper, text) {
    const bubble = wrapper.querySelector(".bubble");
    bubble.textContent = text;
    const cursor = document.createElement("span");
    cursor.className = "stream-cursor";
    bubble.appendChild(cursor);
    const area = document.getElementById("chat-area");
    area.scrollTop = area.scrollHeight;
  }

  function finalizeStreamingBubble(wrapper, text) {
    const bubble = wrapper.querySelector(".bubble");
    bubble.classList.remove("streaming");
    bubble.innerHTML = renderMarkdown(text);
    const area = document.getElementById("chat-area");
    area.scrollTop = area.scrollHeight;
  }

  // APPEND MESSAGES
  function appendMessage(role, text) {
    const area = document.getElementById("chat-area");
    const wrapper = document.createElement("div");
    wrapper.className = "message " + role;

    const label = document.createElement("div");
    label.className = "msg-role";
    label.textContent = role === "ai" ? "PageMind" : "You";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = renderMarkdown(text);

    wrapper.appendChild(label);
    wrapper.appendChild(bubble);
    area.appendChild(wrapper);
    area.scrollTop = area.scrollHeight;
    return wrapper;
  }

  function appendTyping() {
    const area = document.getElementById("chat-area");
    const wrapper = document.createElement("div");
    wrapper.className = "message ai";

    const label = document.createElement("div");
    label.className = "msg-role";
    label.textContent = "PageMind";

    const bubble = document.createElement("div");
    bubble.className = "bubble typing-bubble";
    [1,2,3].forEach(() => {
      const d = document.createElement("div");
      d.className = "typing-dot";
      bubble.appendChild(d);
    });

    wrapper.appendChild(label);
    wrapper.appendChild(bubble);
    area.appendChild(wrapper);
    area.scrollTop = area.scrollHeight;
    return wrapper;
  }

  // MARKDOWN RENDERER
  function renderMarkdown(text) {
    return text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/```[\w]*\n?([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
      .replace(/^#{1,3} (.+)$/gm, "<strong>$1</strong>")
      .replace(/^[-•] (.+)$/gm, "• $1")
      .replace(/^\d+\. (.+)$/gm, "• $1")
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>")
      .replace(/^(.+)$/, "<p>$1</p>");
  }

  // TOAST
  function showToast(msg, success = false) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.style.borderColor = success ? "var(--success)" : "var(--error)";
    t.style.color = success ? "var(--success)" : "var(--error)";
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2800);
  }

  // BOOT
  init();

}); // end DOMContentLoaded

// ── Smart content trimmer ──
function getRelevantContent(text, question) {
  const CHAR_LIMIT = 20000;
  if (text.length <= CHAR_LIMIT) return text;

  const qLower = question.toLowerCase();

  const pageMatch = qLower.match(/pages?\s*(\d+)(?:\s*[-–to]+\s*(\d+))?/);
  if (pageMatch) {
    const startPage = parseInt(pageMatch[1]);
    const endPage   = parseInt(pageMatch[2] || pageMatch[1]);
    const pageMarkers = [...text.matchAll(/\[Page (\d+)\]/g)];
    if (pageMarkers.length > 0) {
      let startIdx = 0, endIdx = text.length;
      for (let i = 0; i < pageMarkers.length; i++) {
        const pg = parseInt(pageMarkers[i][1]);
        if (pg <= startPage) startIdx = pageMarkers[i].index;
        if (pg === endPage + 1 && endIdx === text.length) endIdx = pageMarkers[i].index;
      }
      const intro = text.slice(0, 800);
      return (intro + "\n...\n" + text.slice(startIdx, endIdx)).slice(0, CHAR_LIMIT * 2);
    }
  }

  const sectionMatch = qLower.match(/section\s*([\d.]+)/);
  if (sectionMatch) {
    const sectionRe = new RegExp(`\\b${sectionMatch[1].replace('.', '\\.')}\\s`, 'i');
    const idx = text.search(sectionRe);
    if (idx > 0) {
      const intro = text.slice(0, 800);
      return (intro + "\n...\n" + text.slice(Math.max(0, idx - 200), idx + CHAR_LIMIT)).slice(0, CHAR_LIMIT * 2);
    }
  }

  const stopWords = new Set(["what","is","are","the","a","an","of","in","on","at","to","for",
    "and","or","but","how","why","when","where","who","which","does","do","did","was","were",
    "has","have","had","can","could","would","should","will","tell","me","about","give","list",
    "summarize","summary","describe","explain","overview"]);

  const keywords = qLower.replace(/[^a-z0-9\s]/g, "").split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  if (keywords.length === 0) return text.slice(0, CHAR_LIMIT);

  const paragraphs = text.split(/\n{1,2}/);
  const scored = paragraphs.map((para, idx) => {
    const lower = para.toLowerCase();
    const score = keywords.reduce((s, kw) => {
      return s + (lower.match(new RegExp(`\\b${kw}\\b`, "g")) || []).length * 2 + (lower.includes(kw) ? 1 : 0);
    }, 0);
    return { idx, score, para };
  });

  const top = scored.filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score).slice(0, 30)
    .sort((a, b) => a.idx - b.idx);

  if (top.length === 0) return text.slice(0, CHAR_LIMIT);

  const firstIdx = Math.max(0, top[0].idx - 3);
  const lastIdx  = Math.min(paragraphs.length - 1, top[top.length - 1].idx + 3);
  const intro = text.slice(0, 800);
  return (intro + "\n...\n" + paragraphs.slice(firstIdx, lastIdx + 1).join("\n")).slice(0, CHAR_LIMIT);
}

// ── Build system prompt ──
function buildSystemPrompt(context, question) {
  const docType = context.isPdf ? `PDF DOCUMENT (${context.pageCount} pages)` : "WEBPAGE";
  const relevantContent = getRelevantContent(context.text, question);
  const isTrimmed = relevantContent.length < context.text.length;

  return `You are PageMind, an intelligent reading assistant. The user is viewing a ${docType}.

TITLE: ${context.title}
URL: ${context.url}
WORD COUNT: ~${context.wordCount} words${isTrimmed ? " (showing most relevant section)" : ""}

CONTENT:
---
${relevantContent}
---

Answer questions based on this content. Be concise but thorough. If the answer isn't in the content, say so clearly. Use markdown formatting when helpful.`;
}

// ── Claude streaming API ──
async function askClaudeStream(apiKey, context, question, history, onChunk) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      stream: true,
      system: buildSystemPrompt(context, question),
      messages: [...history, { role: "user", content: question }],
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "API request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // hold incomplete line for next chunk

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
          fullText += parsed.delta.text;
          onChunk(fullText);
        }
      } catch { /* skip malformed lines */ }
    }
  }

  return fullText;
}
