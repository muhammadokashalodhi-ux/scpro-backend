'use strict';

const fetch = require('node-fetch');
const { PROFILE_CONTEXT, TREND_WRITER_SYSTEM, PILLARS, FORMAT_INSTRUCTIONS } = require('./profile');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_MAIN = 'llama-3.3-70b-versatile';
const MODEL_FAST = 'llama-3.1-8b-instant';

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
      max_tokens: 1024,
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

// Fetch top trending supply chain topics
async function fetchTopTrends() {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const messages = [
    {
      role: 'system',
      content: 'You are a supply chain industry analyst. Return ONLY valid JSON, no markdown, no explanation.'
    },
    {
      role: 'user',
      content: `Today is ${today}. Return the 6 most relevant and currently discussed supply chain and procurement topics. 
      
      Return ONLY this JSON structure:
      {
        "trends": [
          {
            "id": 1,
            "title": "Short title (5-8 words)",
            "summary": "2-3 sentence summary of why this is trending now",
            "category": "one of: Technology, Geopolitics, Sustainability, Operations, Finance, Talent",
            "heat": 85
          }
        ]
      }`
    }
  ];

  const raw = await callGroq(messages, MODEL_FAST, 0.6);
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  return parsed.trends;
}

// Fetch trend relevant to a specific content calendar theme
async function fetchRelevantTrend(contentTheme) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const messages = [
    {
      role: 'system',
      content: 'You are a supply chain industry analyst. Return ONLY valid JSON, no markdown, no explanation.'
    },
    {
      role: 'user',
      content: `Today is ${today}. Content calendar theme for today: "${contentTheme}".
      
      Find the most relevant trending supply chain topic that fits this theme.
      
      Return ONLY this JSON:
      {
        "title": "Trend title (5-8 words)",
        "summary": "2-3 sentences on why this is relevant and trending now",
        "angle": "Specific angle to take in a LinkedIn post about this trend",
        "supporting_insights": ["insight 1", "insight 2", "insight 3"]
      }`
    }
  ];

  const raw = await callGroq(messages, MODEL_FAST, 0.6);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// Generate a TREND POST (no personal story)
async function generateTrendPost(trendTitle, trendSummary, angle = '') {
  const messages = [
    {
      role: 'system',
      content: TREND_WRITER_SYSTEM
    },
    {
      role: 'user',
      content: `Write a LinkedIn post about this supply chain trend:

TREND: ${trendTitle}
CONTEXT: ${trendSummary}
${angle ? `ANGLE: ${angle}` : ''}

${FORMAT_INSTRUCTIONS}

Length: Medium (150-250 words). Output only the post text, nothing else.`
    }
  ];

  return await callGroq(messages, MODEL_MAIN, 0.85);
}

// Generate a PILLAR POST (personal story)
async function generatePillarPost(pillarId, direction = '', tone = 'Authentic', length = 'Medium') {
  const pillar = PILLARS.find(p => p.id === pillarId);
  if (!pillar) throw new Error(`Pillar not found: ${pillarId}`);

  const lengthWords = { Short: '100-150', Medium: '150-250', Long: '250-350' }[length] || '150-250';

  const messages = [
    {
      role: 'system',
      content: PROFILE_CONTEXT
    },
    {
      role: 'user',
      content: `${pillar.prompt}

${direction ? `ADDITIONAL DIRECTION: ${direction}` : ''}

TONE: ${tone}
${FORMAT_INSTRUCTIONS}
Length: ${length} (${lengthWords} words). Output only the post text, nothing else.`
    }
  ];

  return await callGroq(messages, MODEL_MAIN, 0.85);
}

// Generate a custom post
async function generateCustomPost(topic, direction, tone = 'Authentic', length = 'Medium', postType = 'trend') {
  const lengthWords = { Short: '100-150', Medium: '150-250', Long: '250-350' }[length] || '150-250';
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
${FORMAT_INSTRUCTIONS}
Length: ${length} (${lengthWords} words). Output only the post text, nothing else.`
    }
  ];

  return await callGroq(messages, MODEL_MAIN, 0.85);
}

// Generate 3 comment suggestions
async function generateComments(postText) {
  const messages = [
    {
      role: 'system',
      content: `You are SC Pro — a supply chain professional with 6+ years experience. 
      Write LinkedIn comments that are genuine, add value, and sound like a real person.
      No sycophancy. No "Great post!" openings. Each comment should add a perspective, question, or insight.
      Return ONLY valid JSON, no markdown.`
    },
    {
      role: 'user',
      content: `Generate 3 different LinkedIn comment options for this post:

"${postText}"

Return ONLY this JSON:
{
  "comments": [
    {
      "style": "Adds perspective",
      "text": "comment text here"
    },
    {
      "style": "Asks a question",
      "text": "comment text here"
    },
    {
      "style": "Shares experience",
      "text": "comment text here"
    }
  ]
}`
    }
  ];

  const raw = await callGroq(messages, MODEL_MAIN, 0.8);
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  return parsed.comments;
}

// Analyze LinkedIn profile
async function analyzeProfile(profileText) {
  const messages = [
    {
      role: 'system',
      content: 'You are a LinkedIn profile optimization expert specializing in supply chain professionals in the UAE/GCC market. Return ONLY valid JSON, no markdown.'
    },
    {
      role: 'user',
      content: `Analyze this LinkedIn profile and provide detailed optimization suggestions:

${profileText}

Return ONLY this JSON:
{
  "overall_score": 72,
  "summary": "2-3 sentence overall assessment",
  "sections": [
    {
      "name": "Headline",
      "score": 65,
      "issues": ["issue 1", "issue 2"],
      "rewrite": "Suggested rewrite here"
    }
  ],
  "quick_wins": ["win 1", "win 2", "win 3"],
  "keywords_missing": ["keyword 1", "keyword 2"],
  "uae_gccc_tips": ["tip 1", "tip 2"]
}`
    }
  ];

  const raw = await callGroq(messages, MODEL_MAIN, 0.6);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// Generate weekly content calendar suggestions
async function generateWeeklyCalendar() {
  const nextMonday = new Date();
  const day = nextMonday.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  nextMonday.setDate(nextMonday.getDate() + diff);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(nextMonday);
    d.setDate(d.getDate() + i);
    days.push(d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }));
  }

  const messages = [
    {
      role: 'system',
      content: 'You are a supply chain content strategist. Return ONLY valid JSON, no markdown.'
    },
    {
      role: 'user',
      content: `Create a 7-day LinkedIn content calendar for a supply chain professional for next week: ${days.join(', ')}.

Each day should have a distinct, timely supply chain topic. Vary between: technology, operations, trade, sustainability, talent/careers, data/analytics, market trends.

Return ONLY this JSON:
{
  "week_start": "${days[0]}",
  "week_end": "${days[6]}",
  "days": [
    {
      "date": "${days[0]}",
      "day_name": "Monday",
      "theme": "Short theme title (4-6 words)",
      "topic": "More specific topic description (1-2 sentences)",
      "post_type": "trend",
      "category": "Technology"
    }
  ]
}`
    }
  ];

  const raw = await callGroq(messages, MODEL_FAST, 0.7);
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
