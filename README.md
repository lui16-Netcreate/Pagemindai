# 📖 PageMind AI — Browser Extension

Ask AI questions about any webpage or document you're reading — powered by Claude.

---

## ✨ Features

- **One-click page reading** — extracts clean text from any webpage
- **Conversational Q&A** — ask follow-up questions with full conversation memory
- **Smart extraction** — strips ads, nav bars, and noise to focus on content
- **Works on any page** — articles, docs, PDFs rendered in browser, wikis, research papers
- **Suggested questions** — helpful prompts to get you started
- **Private** — your API key is stored locally only, never sent anywhere except Anthropic

---

## 🚀 Installation (Chrome / Edge)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer Mode** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `ai-reader-extension` folder
5. The PageMind icon will appear in your toolbar

---

## 🔑 Setup

1. Click the PageMind icon in the toolbar
2. The side panel will open — click your extension icon and select **"Open side panel"** if needed
3. Enter your Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com))
4. Click **Connect →**

---

## 💬 How to Use

1. Navigate to any webpage (article, doc, wiki, etc.)
2. Open the PageMind side panel
3. Click the **document pill** at the top to read the page
4. Type your question and press **Enter**

### Example questions:
- *"Summarize this in 3 bullet points"*
- *"What evidence supports the main argument?"*
- *"What are the pros and cons mentioned?"*
- *"Explain the key technical concepts for a beginner"*
- *"What action items or recommendations are suggested?"*

---

## 📁 File Structure

```
ai-reader-extension/
├── manifest.json       ← Extension config
├── background.js       ← Service worker (API calls, page reading)
├── content.js          ← Injected into pages
├── sidepanel.html      ← The full UI (all-in-one)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 🔧 Technical Notes

- Uses **Chrome Side Panel API** (Chrome 114+)
- Page content is capped at **~80,000 characters** to fit within context limits
- Chat history sends the last **10 turns** for context
- API key stored in `chrome.storage.local` (device-only)
- Model: `claude-sonnet-4-6`

---

## 🛠 Customization Ideas

- Add PDF.js for reading PDF files directly
- Add a "highlight mode" to highlight relevant text on the page
- Add support for selected text (right-click context menu)
- Export chat history as markdown
- Add custom system prompt editor

---

## ⚠️ Permissions Used

| Permission | Why |
|---|---|
| `activeTab` | Read content from the current tab |
| `scripting` | Inject the page reader script |
| `storage` | Save your API key locally |
| `sidePanel` | Show the UI in Chrome's side panel |
| `<all_urls>` | Work on any website you visit |
