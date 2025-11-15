
<p align="center">
  <img src="logo.png" width="450" alt="Writingway Logo"/>
</p>

# Writingway 2
**AI-powered creative writing tool — simple, friendly, and built for storytellers**

---

## 🌟 What is Writingway 2?

**Writingway 2** is a simple, powerful, and beginner‑friendly creative writing application designed for **writers**, not programmers.

It runs **entirely in your browser**, requires **no installation**, and stores all your work **locally** on your computer.  
Just **download → unzip → double‑click `start.bat` → begin writing**.

Writingway 2 is the successor to the original Writingway (Python/QML version).  
Unlike its predecessor, this new version is built with **JavaScript + HTML**, making it lightweight, portable, and extremely accessible to users with minimal technical experience.

---

## ✨ Key Features (Quick Overview)

- 🚀 **AI‑assisted writing tools**
  - continue drafts  
  - rewrite passages  
  - improve style or pacing  
  - brainstorm ideas  

- 📚 **Compendium for worldbuilding**
  - characters, places, lore, items  
  - searchable entries  
  - AI‑assisted creation  

- 🧩 **Scene‑based writing**
  - organize by scenes & chapters  
  - drag‑and‑drop reordering  
  - autosave  

- 🧠 **Creative Workshops**
  - plot generators  
  - character builders  
  - setting ideas  
  - prose improvement  

- 🧰 **Smart Prompt Builder (Codex)**
  - builds structured prompts automatically  
  - integrates compendium + scene metadata  
  - ensures consistent AI responses  

- 📥 **Writingway 1 Importer**
  - converts old Writingway projects  
  - imports compendium & scenes  

- 🔌 **Flexible AI backend**
  - works with local LLMs (LM Studio, Ollama, Jan)  
  - supports OpenAI / OpenRouter  
  - automatic retry handling  

---

## 📦 Installation

No technical setup required.

1. **Download** the latest ZIP release  
2. **Extract** the folder anywhere  
3. Double‑click **`start.bat`**  
4. Writingway opens at  
   **http://localhost:8000**

You're ready to write.

---

## 📝 Getting Started

### 1. Create a Project  
Choose a project name. Writingway handles the rest.

### 2. Add Scenes  
Scenes can be long or short.  
Reorder them visually via drag‑and‑drop.

### 3. Use AI to Write or Improve  
The AI panel allows you to:  
- continue your writing  
- polish prose  
- add detail  
- rewrite in a different tone  
- generate new ideas  

### 4. Expand Your Worldbuilding  
The **Compendium** stores your characters, locations, lore, and more.  
You can:
- write entries manually  
- or let AI help generate them  

### 5. Explore Workshops  
Creative tools designed to beat writer’s block:
- character workshop  
- plot generator  
- setting creation  
- prose enhancer  
- dialogue helper  

### 6. Everything Saves Automatically  
Your work is stored locally using JSON.  
No online accounts required.

---

## 🧭 Detailed Feature Breakdown

### 🗂 Project System
- Multiple local projects  
- Autosave  
- Human‑readable JSON files  
- Quick switching  
- Clear internal structure (scenes, compendium, metadata)

---

### 🎬 Scene Editor
- Clean writing interface  
- Scene titles & metadata  
- Drag‑and‑drop ordering  
- AI integration per scene  
- Automatic prompt construction using:
  - current scene  
  - compendium  
  - notes  
  - style settings  

---

### 📚 Compendium
- Characters, places, species, lore, items  
- Tags and categories  
- Integrated into prompt builder  
- AI assistance for automatic entry creation  

---

### 🧠 Workshops
Tools designed for inspiration and writer‑support:
- plot ideas  
- character outlines  
- worldbuilding prompts  
- style fixes  
- dialogue improvements  
- “retry / regenerate / variations” workflows  

---

### 🧩 Prompt Builder / Codex
Automatically generates high‑quality prompts by combining:
- scene text  
- compendium entries  
- metadata  
- tone/style guidelines  

Ensures the AI responds consistently and in the desired format.

---

### 🔁 AI Integration
Supports:
- **local LLMs** (LM Studio / Ollama / Jan)  
- **OpenAI / OpenRouter**  

Features:
- safe fallback prompts  
- retry logic  
- configurable token limits  
- user‑friendly settings  

---

### 📥 Writingway 1 Importer
Imports legacy Writingway 1 JSON projects:
- scenes  
- compendium  
- project metadata  
- fixes ordering  

Allows users to continue older stories seamlessly.

---

### 🖥 User Interface
Built with HTML + Alpine.js:
- clean and accessible  
- minimal visual clutter  
- responsive design  
- intuitive sidebars  
- modals, tabs, and simple navigation  

---

### 🔍 Update Checker
- Notifies you if a new version is available  
- Checks GitHub releases  
- Optional and unobtrusive  

---

## ⚙️ AI Setup (Optional)

Writingway 2 works out of the box with **local models**, meaning 100% privacy.

If using an online AI:
1. Open **Settings → AI Configuration**  
2. Paste your API key  
3. Select a model  

Writingway never sends your writing anywhere unless you configure it to do so.

---

## ❓ Troubleshooting

### Browser didn’t open automatically  
Visit: **http://localhost:8000**

### `start.bat` closes immediately  
Open a command prompt and run:
```
start.bat
```
to see the error message.

### AI not responding  
- Make sure LM Studio / Ollama / Jan is running  
- Or check API key / endpoint URL  

### Scenes not saving  
Ensure:
- localStorage  
- cookies  
are enabled for `localhost`.

---

## 🛠 Development (For Contributors)

Requires **Node 18+**.

Install:
```
npm install
```

Run development server:
```
npm run dev
```

Project structure:
```
src/
  components/
  scenes/
  compendium/
  ai.js
  app.js
  workshop.js
  codex.js
  update-checker.js
  ...
```

Tests located in `tests/`.

---

## 📄 License

Writingway 2 is free and open‑source software.  
Released under the **MIT License**.

---

## ❤️ Thank You for Using Writingway 2

Writingway was built to help **writers write** — not struggle with tools.  
If this app helps you bring your stories to life, it has succeeded.

**Happy writing! ✨**
