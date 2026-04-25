'use strict';

const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

// Send WhatsApp message via CallMeBot
async function sendWhatsApp(message) {
  const phone = process.env.WA_PHONE;
  const apikey = process.env.WA_APIKEY;

  if (!phone || !apikey) {
    console.log('[WhatsApp] Not configured, skipping');
    return { success: false, reason: 'not_configured' };
  }

  try {
    const encodedMsg = encodeURIComponent(message);
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMsg}&apikey=${apikey}`;
    const res = await fetch(url);
    const text = await res.text();
    console.log('[WhatsApp] Sent:', text.substring(0, 100));
    return { success: true };
  } catch (err) {
    console.error('[WhatsApp] Error:', err.message);
    return { success: false, reason: err.message };
  }
}

// Send email via Nodemailer + Gmail
async function sendEmail(subject, body) {
  const from = process.env.EMAIL_FROM;
  const pass = process.env.EMAIL_APP_PASSWORD;
  const to = process.env.EMAIL_TO;

  if (!from || !pass || !to) {
    console.log('[Email] Not configured, skipping');
    return { success: false, reason: 'not_configured' };
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: from, pass }
    });

    await transporter.sendMail({
      from,
      to,
      subject,
      text: body,
      html: `<pre style="font-family: sans-serif; white-space: pre-wrap;">${body}</pre>`
    });

    console.log('[Email] Sent to:', to);
    return { success: true };
  } catch (err) {
    console.error('[Email] Error:', err.message);
    return { success: false, reason: err.message };
  }
}

// Notify about a new generated post
async function notifyNewPost(post) {
  const preview = post.body ? post.body.substring(0, 300) + (post.body.length > 300 ? '...' : '') : 'No preview';
  const message = `🔔 SCPro Co-Pilot: New post ready for review!\n\n📌 Type: ${post.type}\n\n${preview}\n\n✅ Review it in your dashboard.`;

  const [wa, email] = await Promise.all([
    sendWhatsApp(message),
    sendEmail('📝 SCPro: New LinkedIn Post Ready', `New post generated and waiting for your review.\n\nType: ${post.type}\nGenerated: ${new Date().toLocaleString('en-AE', { timeZone: 'Asia/Dubai' })} UAE\n\n--- POST PREVIEW ---\n\n${preview}\n\n--- \n\nOpen your dashboard to review, edit, and approve.`)
  ]);

  return { whatsapp: wa, email };
}

// Notify about weekly calendar reset reminder
async function notifyCalendarReset(calendarData) {
  const weekStart = calendarData.week_start || 'Next Monday';
  const weekEnd = calendarData.week_end || 'Next Sunday';

  let daysList = '';
  if (calendarData.days && Array.isArray(calendarData.days)) {
    daysList = calendarData.days.map(d => `  • ${d.day_name}: ${d.theme}`).join('\n');
  }

  const waMessage = `📅 SCPro Weekly Calendar Reset!\n\nYour content calendar for ${weekStart} – ${weekEnd} is ready.\n\n${daysList}\n\n🔧 Open your dashboard to review or adjust topics.`;

  const emailBody = `Your LinkedIn content calendar has been automatically generated for next week.\n\nWeek: ${weekStart} – ${weekEnd}\n\n${daysList ? 'SCHEDULED TOPICS:\n\n' + daysList : ''}\n\nOpen your dashboard to:\n✅ Review and adjust topics\n✅ Override any day with a different trend\n✅ Add pillar posts for specific days\n\nThe system will follow this calendar automatically.`;

  const [wa, email] = await Promise.all([
    sendWhatsApp(waMessage),
    sendEmail(`📅 SCPro: Content Calendar Ready (${weekStart} – ${weekEnd})`, emailBody)
  ]);

  return { whatsapp: wa, email };
}

// Send test notification
async function sendTestNotification() {
  const msg = '✅ SCPro Co-Pilot test notification — your WhatsApp is connected!';
  const [wa, email] = await Promise.all([
    sendWhatsApp(msg),
    sendEmail('✅ SCPro Co-Pilot: Test Notification', 'This is a test notification from your SCPro LinkedIn Co-Pilot.\n\nIf you received this, your email notifications are working correctly.')
  ]);
  return { whatsapp: wa, email };
}

module.exports = { sendWhatsApp, sendEmail, notifyNewPost, notifyCalendarReset, sendTestNotification };
