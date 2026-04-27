'use strict';

const fetch = require('node-fetch');
const { PROFILE_CONTEXT, TREND_WRITER_SYSTEM, PILLARS, FORMAT_INSTRUCTIONS } = require('./profile');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_MAIN = 'llama-3.3-70b-versatile';
const MODEL_FAST = 'llama-3.1-8b-instant';

// ─────────────────────────────────────────────────────────────────────────────
// Core API call
// ─────────────────────────────────────────────────────────────────────────────

async function callGroq(messages, model = MODEL_MAIN, temperature = 0.8) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not configured');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature,
      messages
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// TRENDS — fetch and cache
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTopTrends() {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const messages = [
    {
      role: 'system',
      content: 'You are a supply chain industry analyst. Return ONLY valid JSON with no markdown, no explanation, no preamble.'
    },
    {
      role: 'user',
      content: `Today is ${today}.

Return the 6 most relevant and actively discussed supply chain and procurement topics right now.
Focus on topics that have real operational or strategic implications — not abstract trends.

Return ONLY this exact JSON structure, nothing else:
{
  "trends": [
    {
      "id": 1,
      "title": "Short specific title (5-8 words)",
      "summary": "2-3 sentences explaining why this is relevant right now and what the real-world impact is",
      "category": "one of: Technology, Geopolitics, Sustainability, Operations, Finance, Talent",
      "heat": 85
    }
  ]
}`
    }
  ];

  const raw = await callGroq(messages, MODEL_FAST, 0.5);
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  return parsed.trends;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR TREND — fetch trend relevant to today's content theme
// ─────────────────────────────────────────────────────────────────────────────

async function fetchRelevantTrend(contentTheme) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const messages = [
    {
      role: 'system',
      content: 'You are a supply chain industry analyst. Return ONLY valid JSON with no markdown, no explanation, no preamble.'
    },
    {
      role: 'user',
      content: `Today is ${today}.
Content calendar theme for today: "${contentTheme}"

Find the most relevant currently-active supply chain topic that fits this theme.
Choose something with real operational consequences — not abstract trends.

Return ONLY this JSON:
{
  "title": "Specific trend title (5-8 words)",
  "summary": "2-3 sentences: what is happening, why it matters to practitioners right now",
  "angle": "One specific provocative angle to take in a LinkedIn post — a position someone could disagree with",
  "supporting_insights": [
    "Specific insight 1 with a real detail or number",
    "Specific insight 2 with a real detail or number",
    "Specific insight 3 with a real detail or number"
  ]
}`
    }
  ];

  const raw = await callGroq(messages, MODEL_FAST, 0.5);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE TREND POST — industry commentary, no personal story
// ─────────────────────────────────────────────────────────────────────────────

async function generateTrendPost(trendTitle, trendSummary, angle = '') {
  const messages = [
    {
      role: 'system',
      content: TREND_WRITER_SYSTEM
    },
    {
      role: 'user',
      content: `Write a LinkedIn post about this supply chain trend.

TREND: ${trendTitle}
CONTEXT: ${trendSummary}
${angle ? `ANGLE TO TAKE: ${angle}` : ''}

BEFORE YOU WRITE — remind yourself of the most important rule:
Every line must be a COMPLETE sentence. Never split a sentence across two lines.
WRONG: "Companies must adapt. / To new pressures now." 
RIGHT: "Companies that ignore this are running out of time."

The post must:
- Open with a hook that makes a bold specific claim (not context-setting)
- Take one clear position that someone could disagree with
- Include at least one specific number, regulation, or named example
- End with a question specific enough that a supply chain professional wants to answer it
- Use NO corporate buzzwords (no leverage, synergy, game-changer, unprecedented, transformative)

${FORMAT_INSTRUCTIONS}

Target length: 180-240 words. Output ONLY the post text. Nothing else.`
    }
  ];

  return await callGroq(messages, MODEL_MAIN, 0.82);
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE PILLAR POST — personal career story
// ─────────────────────────────────────────────────────────────────────────────

async function generatePillarPost(pillarId, direction = '', tone = 'Authentic', length = 'Medium') {
  const pillar = PILLARS.find(p => p.id === pillarId);
  if (!pillar) throw new Error(`Pillar not found: ${pillarId}`);

  const lengthWords = {
    Short: '120-160',
    Medium: '180-250',
    Long: '260-340'
  }[length] || '180-250';

  const messages = [
    {
      role: 'system',
      content: PROFILE_CONTEXT
    },
    {
      role: 'user',
      content: `${pillar.prompt}

${direction ? `ADDITIONAL DIRECTION FROM USER: ${direction}` : ''}

TONE: ${tone}

BEFORE YOU WRITE — remind yourself of the most important rule:
Every line must be a COMPLETE sentence or complete thought. Never break a sentence mid-way across two lines.
WRONG: "Supply chains are under pressure. / To transform now." (second line is a fragment)
RIGHT: "Supply chains are under pressure to transform now." (complete sentence, one line)

${FORMAT_INSTRUCTIONS}

Target length: ${length} (${lengthWords} words).
Output ONLY the post text. No "Here's the post:" or any other commentary before or after.`
    }
  ];

  return await callGroq(messages, MODEL_MAIN, 0.82);
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE CUSTOM POST
// ─────────────────────────────────────────────────────────────────────────────

async function generateCustomPost(topic, direction, tone = 'Authentic', length = 'Medium', postType = 'trend') {
  const lengthWords = {
    Short: '120-160',
    Medium: '180-250',
    Long: '260-340'
  }[length] || '180-250';

  const systemPrompt = postType === 'pillar' ? PROFILE_CONTEXT : TREND_WRITER_SYSTEM;

  const messages = [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user',
      content: `Write a LinkedIn post about: ${topic}

${direction ? `Direction: ${direction}` : ''}
Tone: ${tone}

BEFORE YOU WRITE — the most important rule:
Every line must be a COMPLETE sentence. Never break a sentence mid-way across two lines.
WRONG: "Companies must adapt. / To survive this change." (fragment on second line)
RIGHT: "Companies that don't adapt to this will lose ground fast." (complete sentence)

The post must take ONE clear position, not a list of observations.
Include at least one specific number or real example.
End with a genuine question an industry professional would want to answer.
Use no corporate buzzwords.

${FORMAT_INSTRUCTIONS}

Target length: ${length} (${lengthWords} words).
Output ONLY the post text. Nothing else.`
    }
  ];

  return await callGroq(messages, MODEL_MAIN, 0.82);
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE COMMENTS
// ─────────────────────────────────────────────────────────────────────────────

async function generateComments(postText) {
  const messages = [
    {
      role: 'system',
      content: `You are SC Pro — a supply chain professional with 6+ years of hands-on experience.
You write LinkedIn comments that are genuine, add real value, and sound like a real person.

Rules for comments:
- Never open with "Great post!" or any compliment about the post
- Each comment must add something: a perspective, a pushback, a real question, or a related experience
- Write like a practitioner, not a consultant
- Keep each comment under 80 words — punchy and direct
- Return ONLY valid JSON, no markdown`
    },
    {
      role: 'user',
      content: `Generate 3 distinct LinkedIn comment options for this post:

"${postText}"

Each comment should take a different approach.

Return ONLY this JSON structure:
{
  "comments": [
    {
      "style": "Adds a perspective",
      "text": "The comment text here — complete sentences, direct, under 80 words"
    },
    {
      "style": "Asks a specific question",
      "text": "The comment text here — a real question that adds to the discussion"
    },
    {
      "style": "Shares a related experience",
      "text": "The comment text here — a brief specific experience that connects to the post's point"
    }
  ]
}`
    }
  ];

  const raw = await callGroq(messages, MODEL_MAIN, 0.78);
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  return parsed.comments;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

async function analyzeProfile(profileText) {
  const messages = [
    {
      role: 'system',
      content: `You are a LinkedIn profile optimization expert specializing in supply chain professionals in the UAE/GCC market.
You give honest, specific, actionable feedback — not generic advice.
Return ONLY valid JSON. No markdown. No preamble.`
    },
    {
      role: 'user',
      content: `Analyze this LinkedIn profile and provide specific optimization suggestions for the UAE/GCC supply chain job market:

${profileText}

Return ONLY this exact JSON structure:
{
  "overall_score": 72,
  "summary": "2-3 sentences of honest overall assessment — what is working and what is not",
  "sections": [
    {
      "name": "Headline",
      "score": 65,
      "issues": ["Specific issue 1", "Specific issue 2"],
      "rewrite": "Concrete suggested rewrite of this section"
    },
    {
      "name": "About / Summary",
      "score": 70,
      "issues": ["Specific issue 1"],
      "rewrite": "Concrete suggested rewrite"
    },
    {
      "name": "Experience Descriptions",
      "score": 60,
      "issues": ["Specific issue 1", "Specific issue 2"],
      "rewrite": "Example of how one experience entry should be rewritten"
    }
  ],
  "quick_wins": [
    "Specific quick win 1 — actionable and specific",
    "Specific quick win 2",
    "Specific quick win 3"
  ],
  "keywords_missing": ["keyword1", "keyword2", "keyword3"],
  "uae_gcc_tips": [
    "UAE/GCC specific tip 1 — based on how this market actually works",
    "UAE/GCC specific tip 2"
  ]
}`
    }
  ];

  const raw = await callGroq(messages, MODEL_MAIN, 0.55);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY CALENDAR GENERATION
// ─────────────────────────────────────────────────────────────────────────────

async function generateWeeklyCalendar() {
  const nextMonday = new Date();
  const day = nextMonday.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  nextMonday.setDate(nextMonday.getDate() + diff);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(nextMonday);
    d.setDate(d.getDate() + i);
    days.push(d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric'
    }));
  }

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const messages = [
    {
      role: 'system',
      content: 'You are a supply chain content strategist. Return ONLY valid JSON with no markdown, no explanation.'
    },
    {
      role: 'user',
      content: `Create a 7-day LinkedIn content calendar for a supply chain professional for next week.
Days: ${days.join(', ')}

Requirements:
- Each day must have a distinct, currently relevant supply chain topic
- Vary categories across the week: Technology, Operations, Geopolitics, Sustainability, Finance, Talent, Analytics
- Each theme should be specific enough to generate a focused post — not vague like "supply chain innovation"
- Topics should reflect what practitioners are actually discussing right now

Return ONLY this exact JSON structure:
{
  "week_start": "${days[0]}",
  "week_end": "${days[6]}",
  "days": [
    {
      "date": "${days[0]}",
      "day_name": "Monday",
      "theme": "Specific theme title — 4-7 words",
      "topic": "One specific angle or question the post should address — 1-2 sentences",
      "post_type": "trend",
      "category": "Technology"
    },
    {
      "date": "${days[1]}",
      "day_name": "Tuesday",
      "theme": "Specific theme title",
      "topic": "Specific angle",
      "post_type": "trend",
      "category": "Operations"
    },
    {
      "date": "${days[2]}",
      "day_name": "Wednesday",
      "theme": "Specific theme title",
      "topic": "Specific angle",
      "post_type": "trend",
      "category": "Geopolitics"
    },
    {
      "date": "${days[3]}",
      "day_name": "Thursday",
      "theme": "Specific theme title",
      "topic": "Specific angle",
      "post_type": "trend",
      "category": "Sustainability"
    },
    {
      "date": "${days[4]}",
      "day_name": "Friday",
      "theme": "Specific theme title",
      "topic": "Specific angle",
      "post_type": "trend",
      "category": "Finance"
    },
    {
      "date": "${days[5]}",
      "day_name": "Saturday",
      "theme": "Specific theme title",
      "topic": "Specific angle",
      "post_type": "trend",
      "category": "Talent"
    },
    {
      "date": "${days[6]}",
      "day_name": "Sunday",
      "theme": "Specific theme title",
      "topic": "Specific angle",
      "post_type": "trend",
      "category": "Analytics"
    }
  ]
}`
    }
  ];

  const raw = await callGroq(messages, MODEL_FAST, 0.65);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

module.exports = {
  fetchTopTrends,
  fetchRelevantTrend,
  generateTrendPost,
  generatePillarPost,
  generateCustomPost,
  generateComments,
  analyzeProfile,
  generateWeeklyCalendar
};
