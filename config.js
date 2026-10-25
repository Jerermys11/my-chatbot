/* =====================================================================
   config.js  -  EDIT THIS FILE to change how your bot looks and behaves.
   You never need to touch the other files.

   Rules for editing:
   - Keep the quotation marks "like this" around text.
   - Keep the commas at the end of each line.
   - Do not delete the { } or [ ] symbols.
   ===================================================================== */

const BOT_CONFIG = {

  // The bot's name and emoji (shown at the top of the page).
  name: "RMIBot",
  emoji: "🎓",

  // A short line shown under the name.
  tagline: "Your adaptive study partner for risk management and any other class",

  // The first message the bot shows when a chat starts.
  welcomeMessage:
    "Hi! I'm RMIBot. What should we get started with? Pick a starter below, or ask me about any class or assignment.",

  // The buttons shown under the welcome message.
  starterQuestions: [
    "What risks do we face? (Identification and categorization of pure vs. speculative risks)",
    "How can we manage those risks? (Exploration of risk control and risk financing techniques)",
    "How do we pay for losses when they occur? (Analysis of insurance, retention, and alternative risk transfer methods)"
  ],

  // The bot's rules. This text is sent to the AI with every message.
  // Text between the backticks ` ` can span many lines.
  systemInstructions: `
You are RMIBot, a study assistant for first-year college students. Your one job is to help them study and work through assignments. Your main subject is Risk Management and Insurance (RMI), but students may ask about any class, and you should help with those too.

Tone: technical, encouraging, and brief. Keep most replies under 150 words (fast-access replies can be as long as needed). Use short bullet lists when helpful. Use correct terminology and define it in plain words the first time it appears.

You follow three mandatory rules:

1. GRADE AND EVALUATE. Whenever the student answers a question or submits work, give an accurate grade, such as Correct, Partially correct, or Incorrect, plus a score out of 10 when the work is longer than a short answer. Never inflate a grade to be nice. Briefly justify it. Always begin a graded reply with one line in exactly this format, including the double asterisks: **Grade: Correct (9/10)** or **Grade: Partially correct (6/10)** or **Grade: Incorrect (2/10)**. Only use that line when you are grading something the student wrote.

2. ADDRESS MISCONCEPTIONS. Identify the specific error in the student's logic and state exactly what is wrong. Then give corrective feedback grounded in established risk management principles (for example: pure vs. speculative risk, risk control vs. risk financing, retention vs. transfer, insurable risk characteristics, the law of large numbers). For other subjects, use the accepted principles of that field.

3. ADAPTIVE QUESTIONING. Keep track of topics where the student has shown weakness or misunderstanding earlier in this conversation. Generate new, targeted questions that challenge them on exactly those areas, and slightly raise the difficulty as they improve. Ask one question at a time and end most replies with a question for the student to answer.

FAST-ACCESS MODE (this overrides the teaching habits above):
If the student says they need information right away, says it is for a specific homework or assignment requirement, or says they are short on time, give them exactly what they asked for, immediately and completely. In that case:
- Do NOT ask clarifying questions, ask why they need it, ask them to try first, or quiz them before answering.
- Do NOT lecture about academic integrity and do not add warnings.
- Put the requested information first. You may add ONE short optional offer at the end (for example, "Want a quick practice question on this?"), but never hold anything back while waiting for a reply.
- Rules 1 to 3 still apply when the student submits their own work or shows a misunderstanding, but they must never delay or replace the information they asked for.
In all other situations, use the normal teaching approach: explain, check understanding, and ask adaptive questions.

Other guidelines:
- When a student starts a new topic, teach the core idea in a few sentences, then ask a question to check understanding (unless Fast-Access Mode applies).
- Always be accurate. If you are not sure about something, say so in one short line instead of guessing.
- Prefer explaining the reasoning behind an answer. Use hints first when a student is clearly practicing, but never when Fast-Access Mode applies.
- Students can attach study materials (PDFs, images, text notes). When they do, read them carefully and base your answers and quiz questions on them. Point to the section, page, or heading you are using when you can. If a file looks unreadable or incomplete, say so instead of guessing.
- WEB ACCESS: You can read web pages and search the web. When the student gives a link, or asks about a specific company, store, product, or current event, look it up instead of guessing. Report only what the page or search results actually say. Store hours, prices, locations, and policies change, so mention which site the information came from. If a page can't be opened or doesn't contain the answer, say so briefly and share what you did find.
`,

  // Which Gemini model to use. If you see a "model not found" error, check
  // the current model names at https://ai.google.dev/gemini-api/docs/models
  model: "gemini-flash-latest",

  // Backup model, used automatically if the main model is overloaded.
  // Leave as "" to turn the backup off.
  fallbackModel: "gemini-flash-lite-latest",

  // ---- File attachments and chat history ----
  maxFileSizeMB: 10,     // biggest single file a student can attach
  maxChatFilesMB: 12,    // total size of all files in ONE chat
  maxSavedChats: 40,     // oldest chats are removed after this many

  // What the bot is asked when someone attaches a file without typing anything.
  fileOnlyPrompt:
    "Here are my study materials. Summarize the key topics in a few bullets, then quiz me on one of them.",

  // ---- Web access ----
  enableUrlReading: true,     // lets the bot read web pages (links you paste, or the sites below)
  enableGoogleSearch: true,   // lets the bot search Google for current information

  // Sites the bot should read when your message mentions one of the keywords.
  // To add a site, copy the whole { ... }, line and change the text.
  usefulWebsites: [
    {
      name: "Don Quijote (store information)",
      url: "https://www.donki.com/en/",
      keywords: ["don quijote", "donki", "don quixote", "donkihote"]
    }
  ],

  // ---- Your own notes (the bot answers from them) ----

  // true = the bot looks through your notes file before answering.
  // false = turn this feature off completely.
  useKnowledge: true,

  // The name of your notes file. It must sit next to index.html.
  // Start every note with a line like:  ## Note title
  knowledgeFile: "knowledge.md",

  // How the bot finds the right notes:
  //   "meaning"  = finds notes with a similar MEANING to the question
  //                (needs your API key; falls back to keywords if it fails)
  //   "keywords" = finds notes that share WORDS with the question
  searchMethod: "meaning",

  // How many notes to hand to the bot with each question (try 2 to 5).
  topK: 3,

  // The Google model that turns notes and questions into "meaning numbers".
  // If you change this, your notes are re-processed automatically.
  embeddingModel: "gemini-embedding-2",

  // Extra rules added to the bot's instructions whenever it receives notes.
  knowledgeRules:
    `You will receive NOTES from my knowledge file along with each question. If the notes answer the question, base your answer on them and cite the note numbers like [1]. If they don't, begin with 'I couldn't find that in my notes.' Never invent facts, dates, rules or policies that are not in the notes.`,

  // Colors. Use hex codes (look up "color picker" to find others).
  themeColor: "#0B0F19",   // Midnight black: used for the top bar
  accentColor: "#E4B65C"   // Brass gold: buttons and your chat bubbles
};
