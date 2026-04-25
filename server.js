'use strict';

require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('crypto');

const {
  fetchTopTrends,
  fetchRelevantTrend,
  generateTrendPost,
  generatePillarPost,
  generateCustomPost,
  generateComments,
  analyzeProfile,
  generateWeeklyCalendar
} = require('./groq');

const { notifyNewPost, notifyCalendarReset, sendTestNotification } = require('./notify');
const { PILLARS } = require('./profile');

const app = express();
app.use(express.json());

// CORS — allow any origin for the HTML dashboard
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ----------- IN-MEMORY STATE -----------
// In production you'd use SQLite or a file, but this works reliably on Render

let posts = [];           // All posts (generated, approved, discarded)
let trendsCache = [];     // Cached trending topics
let trendsLastFetch = 0;  // Timestamp of last trends fetch
let contentCalendar = []; // Weekly content calendar
let calendarWeekStart = null; // ISO date string for the week this calendar covers
let scheduleRunning = false;

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// ----------- ROUTES -----------

// Health check
app.get('/', (req, res) => {
  const pending = posts.filter(p => p.status === 'pending').length;
  res.json({
    status: 'online',
    service: 'SCPro LinkedIn Co-Pilot',
    time_uae: new Date().toLocaleString('en-AE', { timeZone: 'Asia/Dubai' }),
    queue_count: pending,
    calendar_active: contentCalendar.length > 0,
    calendar_week: calendarWeekStart || 'not set',
    groq_configured: !!process.env.GROQ_API_KEY,
    whatsapp_configured: !!(process.env.WA_PHONE && process.env.WA_APIKEY),
    email_configured: !!(process.env.EMAIL_FROM && process.env.EMAIL_APP_PASSWORD)
  });
});

// External trigger — cron-job.org hits this daily
app.post('/api/run-schedule', async (req, res) => {
  if (scheduleRunning) {
    return res.json({ status: 'already_running', message: 'Schedule already in progress' });
  }
  res.json({ status: 'triggered', message: 'Schedule started' });
  runDailySchedule().catch(err => console.error('[Schedule] Error:', err));
});

// List posts
app.get('/api/posts', (req, res) => {
  const { status } = req.query;
  const result = status ? posts.filter(p => p.status === status) : posts;
  res.json(result.slice().reverse());
});

// Generate post
app.post('/api/generate', async (req, res) => {
  const { type, pillarId, topic, direction, tone, length } = req.body;

  try {
    let body, postType;

    if (type === 'pillar' && pillarId) {
      body = await generatePillarPost(pillarId, direction, tone, length);
      postType = 'pillar';
    } else if (type === 'trend' && topic) {
      body = await generateTrendPost(topic, direction || '', direction);
      postType = 'trend';
    } else if (type === 'custom') {
      body = await generateCustomPost(topic || 'supply chain trends', direction, tone, length, 'trend');
      postType = 'custom';
    } else {
      return res.status(400).json({ error: 'Invalid generation request' });
    }

    const post = {
      id: newId(),
      type: postType,
      pillarId: pillarId || null,
      topic: topic || null,
      body,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    posts.push(post);
    notifyNewPost(post).catch(err => console.error('[Notify] Error:', err));

    res.json(post);
  } catch (err) {
    console.error('[Generate] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Approve post
app.put('/api/posts/:id/approve', (req, res) => {
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  post.status = 'approved';
  post.approvedAt = new Date().toISOString();
  res.json(post);
});

// Edit post body
app.put('/api/posts/:id/body', (req, res) => {
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (req.body.body !== undefined) post.body = req.body.body;
  post.updatedAt = new Date().toISOString();
  res.json(post);
});

// Discard post
app.delete('/api/posts/:id', (req, res) => {
  const idx = posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found' });
  posts[idx].status = 'discarded';
  res.json({ success: true });
});

// Get trends
app.get('/api/trends', async (req, res) => {
  const cacheAge = Date.now() - trendsLastFetch;
  if (trendsCache.length > 0 && cacheAge < 3 * 60 * 60 * 1000) {
    return res.json({ trends: trendsCache, cached: true, age_minutes: Math.floor(cacheAge / 60000) });
  }

  try {
    trendsCache = await fetchTopTrends();
    trendsLastFetch = Date.now();
    res.json({ trends: trendsCache, cached: false });
  } catch (err) {
    if (trendsCache.length > 0) {
      return res.json({ trends: trendsCache, cached: true, error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// Force-refresh trends
app.post('/api/trends/refresh', async (req, res) => {
  try {
    trendsCache = await fetchTopTrends();
    trendsLastFetch = Date.now();
    res.json({ trends: trendsCache });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate comment suggestions
app.post('/api/comments', async (req, res) => {
  const { postText } = req.body;
  if (!postText) return res.status(400).json({ error: 'postText required' });

  try {
    const comments = await generateComments(postText);
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Analyze LinkedIn profile
app.post('/api/profile/analyze', async (req, res) => {
  const { profileText } = req.body;
  if (!profileText) return res.status(400).json({ error: 'profileText required' });

  try {
    const analysis = await analyzeProfile(profileText);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send test notification
app.post('/api/test', async (req, res) => {
  try {
    const result = await sendTestNotification();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List content pillars
app.get('/api/pillars', (req, res) => {
  res.json(PILLARS);
});

// Get current content calendar
app.get('/api/calendar', (req, res) => {
  res.json({ calendar: contentCalendar, week_start: calendarWeekStart });
});

// Update a specific day's topic in the calendar
app.put('/api/calendar/:dayIndex', (req, res) => {
  const idx = parseInt(req.params.dayIndex);
  if (isNaN(idx) || idx < 0 || idx >= contentCalendar.length) {
    return res.status(400).json({ error: 'Invalid day index' });
  }
  const { theme, topic, category } = req.body;
  if (theme) contentCalendar[idx].theme = theme;
  if (topic) contentCalendar[idx].topic = topic;
  if (category) contentCalendar[idx].category = category;
  res.json(contentCalendar[idx]);
});

// Force reset calendar for next week
app.post('/api/calendar/reset', async (req, res) => {
  try {
    const result = await generateWeeklyCalendar();
    contentCalendar = result.days || [];
    calendarWeekStart = result.week_start;
    const notifyResult = await notifyCalendarReset(result);
    res.json({ calendar: contentCalendar, week_start: calendarWeekStart, notifications: notifyResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------- DAILY SCHEDULE -----------

async function runDailySchedule() {
  scheduleRunning = true;
  console.log('[Schedule] Running daily post generation —', new Date().toLocaleString('en-AE', { timeZone: 'Asia/Dubai' }), 'UAE');

  try {
    // Check today's calendar
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const todayEntry = contentCalendar.find(d => d.day_name === today);

    let trendTitle, trendSummary, trendAngle;

    if (todayEntry) {
      console.log('[Schedule] Using calendar theme:', todayEntry.theme);
      const trend = await fetchRelevantTrend(todayEntry.theme);
      trendTitle = trend.title;
      trendSummary = trend.summary;
      trendAngle = trend.angle;
    } else {
      console.log('[Schedule] No calendar for today, fetching top trend');
      const trends = await fetchTopTrends();
      const top = trends[0];
      trendTitle = top.title;
      trendSummary = top.summary;
      trendAngle = '';
    }

    const body = await generateTrendPost(trendTitle, trendSummary, trendAngle);

    const post = {
      id: newId(),
      type: 'trend',
      topic: trendTitle,
      body,
      status: 'pending',
      createdAt: new Date().toISOString(),
      source: 'auto-schedule'
    };

    posts.push(post);
    console.log('[Schedule] Post generated:', trendTitle);

    await notifyNewPost(post);
    console.log('[Schedule] Notification sent');
  } catch (err) {
    console.error('[Schedule] Failed:', err.message);
  } finally {
    scheduleRunning = false;
  }
}

// ----------- WEEKLY CALENDAR RESET (Sunday) -----------

async function runWeeklyCalendarReset() {
  console.log('[Calendar] Sunday reset triggered —', new Date().toLocaleString('en-AE', { timeZone: 'Asia/Dubai' }), 'UAE');

  try {
    const result = await generateWeeklyCalendar();
    contentCalendar = result.days || [];
    calendarWeekStart = result.week_start;
    console.log('[Calendar] New calendar generated for week of', calendarWeekStart);

    await notifyCalendarReset(result);
    console.log('[Calendar] Calendar reset notification sent');
  } catch (err) {
    console.error('[Calendar] Reset failed:', err.message);
  }
}

// ----------- CRON JOBS -----------

const scheduleExpr = process.env.POST_SCHEDULE || '0 5 * * *';
console.log('[Cron] Daily post schedule:', scheduleExpr);

// Daily post generation (default: 5AM UTC = 9AM UAE)
cron.schedule(scheduleExpr, () => {
  runDailySchedule().catch(err => console.error('[Cron] Schedule error:', err));
}, { timezone: 'UTC' });

// Weekly calendar reset — every Sunday at 8AM UAE (4AM UTC)
// This sends a notification and generates the next week's content plan
cron.schedule('0 4 * * 0', () => {
  runWeeklyCalendarReset().catch(err => console.error('[Cron] Calendar reset error:', err));
}, { timezone: 'UTC' });

console.log('[Cron] Weekly calendar reset: Sundays 8AM UAE (4AM UTC)');

// ----------- KEEP-ALIVE SELF-PING -----------

const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(async () => {
    try {
      const res = await fetch(RENDER_URL + '/');
      console.log('[KeepAlive] Ping OK —', res.status);
    } catch (err) {
      console.warn('[KeepAlive] Ping failed:', err.message);
    }
  }, 10 * 60 * 1000); // every 10 minutes
  console.log('[KeepAlive] Self-ping active:', RENDER_URL);
} else {
  console.log('[KeepAlive] RENDER_EXTERNAL_URL not set — self-ping disabled');
}

// ----------- STARTUP -----------

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n🚀 SCPro Co-Pilot backend running on port ${PORT}`);
  console.log(`   Time (UAE): ${new Date().toLocaleString('en-AE', { timeZone: 'Asia/Dubai' })}`);
  console.log(`   Groq:       ${process.env.GROQ_API_KEY ? '✅ Configured' : '❌ Missing GROQ_API_KEY'}`);
  console.log(`   WhatsApp:   ${process.env.WA_PHONE ? '✅ Configured' : '⚠️  Not configured'}`);
  console.log(`   Email:      ${process.env.EMAIL_FROM ? '✅ Configured' : '⚠️  Not configured'}`);
  console.log(`   Schedule:   ${scheduleExpr} UTC`);
  console.log(`   Calendar:   Sundays 4AM UTC reset\n`);

  // Generate initial calendar on startup if none exists
  if (contentCalendar.length === 0 && process.env.GROQ_API_KEY) {
    try {
      console.log('[Startup] Generating initial content calendar...');
      const result = await generateWeeklyCalendar();
      contentCalendar = result.days || [];
      calendarWeekStart = result.week_start;
      console.log('[Startup] Calendar ready for week of', calendarWeekStart);
    } catch (err) {
      console.warn('[Startup] Could not generate initial calendar:', err.message);
    }
  }
});
