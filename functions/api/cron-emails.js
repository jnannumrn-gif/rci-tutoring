// Cron Email Worker — dispatches automated email sequences
// This file defines the logic for the 5-step email sequence.
// In production, this is triggered by a Cloudflare Cron Trigger (hourly).
// For Phase 1, the email sending is a placeholder until the Resend API key is provided.

// Email sequence steps:
// Step 1 (Day 1): Welcome + platform navigation
// Step 2 (Day 3): Progress check-in
// Step 3 (Day 5): Value + social proof
// Step 4 (Day 6): Urgency — last day warning
// Step 5 (Day 7): Blocked + final offer

import { jsonResponse, corsHeaders } from './_shared/auth.js';

const EMAIL_STEPS = [
  { step: 1, dayOffset: 0 },  // Day 1: Welcome (sent on registration day)
  { step: 2, dayOffset: 2 },  // Day 3
  { step: 3, dayOffset: 4 },  // Day 5
  { step: 4, dayOffset: 5 },  // Day 6
  { step: 5, dayOffset: 6 },  // Day 7
];

function getEmailTemplate(step, user) {
  const lang = user.idioma || 'es';
  const rawName = user.nombre ? user.nombre.split(' ')[0] : '';
  const name = rawName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const templates = {
    1: {
      es: {
        subject: `¡Bienvenido a RCI Tutoring, ${rawName}!`,
        html: `
          <h2>¡Hola ${name}!</h2>
          <p>Tu cuenta de RCI Tutoring está activa. Tienes <strong>7 días de acceso gratuito</strong> a toda la plataforma.</p>
          <h3>¿Qué puedes hacer?</h3>
          <ul>
            <li><strong>Tutor IA 24/7</strong> — Pregunta lo que quieras sobre hemodiálisis</li>
            <li><strong>Tutor Humano</strong> — Agenda sesiones con enfermeras certificadas</li>
            <li><strong>CCHT Prep</strong> — Practica con exámenes de simulación</li>
          </ul>
          <p><a href="{{APP_URL}}/dashboard.html" style="background-color:#1e40af;color:#ffffff;padding:12px 24px;border-radius:12px;display:inline-block;font-weight:700;text-decoration:none;">Ir al Dashboard</a></p>
          <p style="color:#64748b;font-size:0.85rem;">Tu prueba termina el {{TRIAL_END}}.</p>
        `
      },
      en: {
        subject: `Welcome to RCI Tutoring, ${rawName}!`,
        html: `
          <h2>Hi ${name}!</h2>
          <p>Your RCI Tutoring account is active. You have <strong>7 days of free access</strong> to the entire platform.</p>
          <h3>What can you do?</h3>
          <ul>
            <li><strong>24/7 AI Tutor</strong> — Ask anything about hemodialysis</li>
            <li><strong>Human Tutor</strong> — Schedule sessions with certified nurses</li>
            <li><strong>CCHT Prep</strong> — Practice with mock exams</li>
          </ul>
          <p><a href="{{APP_URL}}/dashboard.html" style="background-color:#1e40af;color:#ffffff;padding:12px 24px;border-radius:12px;display:inline-block;font-weight:700;text-decoration:none;">Go to Dashboard</a></p>
          <p style="color:#64748b;font-size:0.85rem;">Your trial ends on {{TRIAL_END}}.</p>
        `
      }
    },
    2: {
      es: {
        subject: `${rawName}, ¿cómo va tu aprendizaje?`,
        html: `
          <h2>¡Hola ${name}!</h2>
          <p>Llevas 3 días en RCI Tutoring. ¿Has tenido la oportunidad de explorar la plataforma?</p>
          <p>Aquí van algunas sugerencias para aprovechar tu prueba gratuita:</p>
          <ul>
            <li>Haz al menos 3 preguntas al <strong>Tutor IA</strong></li>
            <li>Intenta un examen de práctica en <strong>CCHT Prep</strong></li>
            <li>Explora los recursos disponibles</li>
          </ul>
          <p>Te quedan <strong>4 días de acceso gratuito</strong>.</p>
          <p><a href="{{APP_URL}}/dashboard.html" style="background-color:#1e40af;color:#ffffff;padding:12px 24px;border-radius:12px;display:inline-block;font-weight:700;text-decoration:none;">Continuar aprendiendo</a></p>
        `
      },
      en: {
        subject: `${rawName}, how's your learning going?`,
        html: `
          <h2>Hi ${name}!</h2>
          <p>You've been on RCI Tutoring for 3 days. Have you had a chance to explore the platform?</p>
          <p>Here are some suggestions to make the most of your free trial:</p>
          <ul>
            <li>Ask at least 3 questions to the <strong>AI Tutor</strong></li>
            <li>Try a practice exam on <strong>CCHT Prep</strong></li>
            <li>Explore available resources</li>
          </ul>
          <p>You have <strong>4 days of free access</strong> remaining.</p>
          <p><a href="{{APP_URL}}/dashboard.html" style="background-color:#1e40af;color:#ffffff;padding:12px 24px;border-radius:12px;display:inline-block;font-weight:700;text-decoration:none;">Continue learning</a></p>
        `
      }
    },
    3: {
      es: {
        subject: `${rawName}, el valor de invertir en tu carrera`,
        html: `
          <h2>¡Hola ${name}!</h2>
          <p>En 5 días has tenido acceso a herramientas que normalmente cuestan cientos de dólares en programas formales.</p>
          <p><strong>Lo que obtienes con RCI Tutoring:</strong></p>
          <ul>
            <li>Tutor IA disponible 24/7 (valor: $50+/mes en otras plataformas)</li>
            <li>Sesiones con enfermeras certificadas en hemodiálisis</li>
            <li>Exámenes de práctica actualizados tipo BONENT</li>
          </ul>
          <p>Profesionales como tú ya están mejorando sus conocimientos con nuestra plataforma.</p>
          <p>Te quedan <strong>2 días de prueba gratuita</strong>.</p>
          <p><a href="{{APP_URL}}/upgrade.html" style="background-color:#1e40af;color:#ffffff;padding:12px 24px;border-radius:12px;display:inline-block;font-weight:700;text-decoration:none;">Ver planes</a></p>
        `
      },
      en: {
        subject: `${rawName}, the value of investing in your career`,
        html: `
          <h2>Hi ${name}!</h2>
          <p>In 5 days you've had access to tools that typically cost hundreds of dollars in formal programs.</p>
          <p><strong>What you get with RCI Tutoring:</strong></p>
          <ul>
            <li>24/7 AI Tutor (value: $50+/month on other platforms)</li>
            <li>Sessions with certified hemodialysis nurses</li>
            <li>Updated BONENT-style practice exams</li>
          </ul>
          <p>Professionals like you are already improving their knowledge with our platform.</p>
          <p>You have <strong>2 days of free trial</strong> remaining.</p>
          <p><a href="{{APP_URL}}/upgrade.html" style="background-color:#1e40af;color:#ffffff;padding:12px 24px;border-radius:12px;display:inline-block;font-weight:700;text-decoration:none;">View plans</a></p>
        `
      }
    },
    4: {
      es: {
        subject: `⚠️ ${rawName}, tu acceso termina mañana`,
        html: `
          <h2>${name}, tu prueba termina mañana</h2>
          <p>Este es un recordatorio de que tu acceso gratuito a RCI Tutoring <strong>termina mañana</strong>.</p>
          <p>Después de mañana, perderás acceso a:</p>
          <ul>
            <li>Tutor IA 24/7</li>
            <li>Sesiones con tutor humano</li>
            <li>CCHT Prep App</li>
            <li>Todo el contenido de la plataforma</li>
          </ul>
          <p><strong>No pierdas tu progreso.</strong> Elige un plan y continúa aprendiendo sin interrupciones.</p>
          <p><a href="{{APP_URL}}/upgrade.html" style="background-color:#dc2626;color:#ffffff;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:800;text-decoration:none;">Actualizar ahora</a></p>
        `
      },
      en: {
        subject: `⚠️ ${rawName}, your access ends tomorrow`,
        html: `
          <h2>${name}, your trial ends tomorrow</h2>
          <p>This is a reminder that your free access to RCI Tutoring <strong>ends tomorrow</strong>.</p>
          <p>After tomorrow, you'll lose access to:</p>
          <ul>
            <li>24/7 AI Tutor</li>
            <li>Human tutor sessions</li>
            <li>CCHT Prep App</li>
            <li>All platform content</li>
          </ul>
          <p><strong>Don't lose your progress.</strong> Choose a plan and continue learning without interruptions.</p>
          <p><a href="{{APP_URL}}/upgrade.html" style="background-color:#dc2626;color:#ffffff;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:800;text-decoration:none;">Upgrade now</a></p>
        `
      }
    },
    5: {
      es: {
        subject: `🚨 ${rawName}, tu acceso ha sido bloqueado`,
        html: `
          <h2>${name}, tu periodo de prueba ha terminado</h2>
          <p>Tu acceso gratuito de 7 días a RCI Tutoring ha finalizado. Tu cuenta ha sido bloqueada.</p>
          <p>Pero no te preocupes — puedes recuperar tu acceso inmediatamente eligiendo un plan:</p>
          <ul>
            <li><strong>Plan Mensual</strong> — $19/mes, flexibilidad total</li>
            <li><strong>Plan Trimestral</strong> — $45 cada 3 meses, ahorras $12</li>
          </ul>
          <p><a href="{{APP_URL}}/upgrade.html" style="background-color:#1e40af;color:#ffffff;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:800;text-decoration:none;">Recuperar mi acceso</a></p>
          <p style="color:#64748b;font-size:0.85rem;">¿Preguntas? Escríbenos a info@rcitutoring.com</p>
        `
      },
      en: {
        subject: `🚨 ${rawName}, your access has been blocked`,
        html: `
          <h2>${name}, your trial has ended</h2>
          <p>Your 7-day free access to RCI Tutoring has ended. Your account has been blocked.</p>
          <p>But don't worry — you can recover access immediately by choosing a plan:</p>
          <ul>
            <li><strong>Monthly Plan</strong> — $19/mo, total flexibility</li>
            <li><strong>Quarterly Plan</strong> — $45 every 3 months, save $12</li>
          </ul>
          <p><a href="{{APP_URL}}/upgrade.html" style="background-color:#1e40af;color:#ffffff;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:800;text-decoration:none;">Recover my access</a></p>
          <p style="color:#64748b;font-size:0.85rem;">Questions? Contact us at info@rcitutoring.com</p>
        `
      }
    }
  };

  const template = templates[step]?.[lang] || templates[step]?.['es'];
  return template || null;
}

async function sendEmail(env, to, subject, html) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[EMAIL] Resend API key not set — skipping email send to:', to, 'Subject:', subject);
    return { skipped: true, reason: 'no_api_key' };
  }

  const appUrl = env.APP_URL || 'https://rcitutoring.com';
  const fromEmail = env.EMAIL_FROM || 'RCI Tutoring <noreply@rcitutoring.com>';
  const processedHtml = html.replace(/\{\{APP_URL\}\}/g, appUrl);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject: subject,
      html: processedHtml
    })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[EMAIL] Resend error:', res.status, err);
    return { error: true, status: res.status, body: err };
  }

  return await res.json();
}

export async function processEmailSequences(env) {
  const now = new Date();
  const results = { processed: 0, sent: 0, skipped: 0, errors: 0 };

  // Get all trial users who haven't completed the email sequence (only verified users)
  const users = await env.DB.prepare(`
    SELECT u.id, u.nombre, u.email, u.idioma, u.trial_start_date, u.trial_end_date, u.status
    FROM users u
    WHERE u.status IN ('trial', 'expired')
      AND u.email_verified = 1
  `).all();

  for (const user of users.results) {
    results.processed++;

    // Get emails already sent to this user
    const sentEmails = await env.DB.prepare(
      'SELECT step FROM email_sequences WHERE user_id = ?'
    ).bind(user.id).all();
    const sentSteps = new Set(sentEmails.results.map(e => e.step));

    const trialStart = new Date(user.trial_start_date);
    const daysSinceStart = Math.floor((now.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24));

    for (const stepConfig of EMAIL_STEPS) {
      // Skip if already sent
      if (sentSteps.has(stepConfig.step)) continue;

      // Check if it's time for this step
      if (daysSinceStart >= stepConfig.dayOffset) {
        const template = getEmailTemplate(stepConfig.step, user);
        if (!template) continue;

        // Replace template variables
        const trialEndFormatted = new Date(user.trial_end_date).toLocaleDateString(
          user.idioma === 'en' ? 'en-US' : 'es-ES',
          { year: 'numeric', month: 'long', day: 'numeric' }
        );
        const html = template.html.replace(/\{\{TRIAL_END\}\}/g, trialEndFormatted);

        const result = await sendEmail(env, user.email, template.subject, html);

        if (result.skipped) {
          results.skipped++;
        } else if (result.error) {
          results.errors++;
        } else {
          results.sent++;
        }

        // Only record as sent if not an actual send error (allows retry on failure)
        if (!result.error && !result.skipped) {
          await env.DB.prepare(
            'INSERT INTO email_sequences (user_id, step, sent_at) VALUES (?, ?, ?)'
          ).bind(user.id, stepConfig.step, now.toISOString()).run();
        }

        // Only send one email per user per cron run to avoid batch-sending
        break;
      }
    }
  }

  return results;
}

// API endpoint for manual trigger (admin/testing) — requires CRON_SECRET
export async function onRequestPost(context) {
  const { env } = context;

  // Verify cron secret to prevent unauthorized access
  const authHeader = context.request.headers.get('Authorization') || '';
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const results = await processEmailSequences(env);
    return jsonResponse({ success: true, results });
  } catch (err) {
    console.error('Cron email error:', err);
    return jsonResponse({ error: 'Error processing email sequences' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}
