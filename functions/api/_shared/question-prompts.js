// Versioned prompt templates for AI question generation (CCHT Prep question bank).
// Bump PROMPT_VERSION whenever a template changes: it is stored on every
// generation_batch row so question quality can be traced back to a prompt.
//
// These live in a module (not a prompts/ folder at the project root) because
// anything at the root of a Pages project is served publicly as a static asset.

export const PROMPT_VERSION = 'v2';

export const EXAM_TYPES = ['BONENT_CHT', 'NNCC_CCHT'];

export const COGNITIVE_LEVELS = ['knowledge', 'comprehension', 'application'];

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

// Official content-outline weights, used to size proportional batches.
export const DOMAINS = {
  BONENT_CHT: {
    patient_care: 45,
    machine_technology: 12,
    water_treatment: 15,
    infection_control: 18,
    education_professional_dev: 10,
  },
  NNCC_CCHT: {
    clinical: 50,
    technical: 23,
    environment: 15,
    role_responsibilities: 12,
  },
};

const BASE_INSTRUCTIONS = `You are an expert nephrology nurse educator writing exam-style multiple-choice
questions for hemodialysis technician certification exam preparation.

Rules:
- Each question must have exactly 4 options (A-D), only one correct.
- Distractors (wrong options) must be plausible and clinically relevant —
  never absurd or obviously wrong, so the student has to reason it out.
- Prioritize SCENARIO-BASED / APPLIED questions: present a patient situation,
  a set of vital signs, a machine alarm, a lab value, etc., and ask what the
  technician should recognize or do. Avoid pure definition/recall questions
  ("What does X stand for?") unless explicitly asked for a 'knowledge' level item.
- Write a clear rationale (2-4 sentences) explaining why the correct answer
  is correct AND briefly why the main distractor(s) are wrong.
- Do not invent statistics, drug dosages, or lab reference ranges — use
  only well-established, standard clinical values.
- Match the tone and difficulty of a real certification exam, not a
  classroom quiz.
- Output ONLY valid JSON, no preamble, no markdown fences.`;

const BONENT_ADDENDUM = `You are generating questions for the BONENT Certified Hemodialysis
Technologist/Technician (CHT) exam, which covers these 5 domains
(official BONENT weighting):

1. Patient Care (45%) — pre/post treatment evaluation, fluid management,
   cannulation, intradialytic monitoring and complications, treatment
   termination, documentation.
2. Machine Technology (12%) — machine setup/maintenance, disinfection,
   AAMI quality control standards, alarm testing, equipment logs.
3. Water Treatment (15%) — water treatment system components, disinfection,
   chloramine/chlorine monitoring, AAMI reprocessing standards.
4. Infection Control (18%) — aseptic technique, PPE, isolation procedures,
   bloodborne pathogen precautions, biohazard disposal.
5. Education & Professional Development (10%) — patient education, ESRD
   basics, medications used in the clinic, QAPI, professional ethics,
   communication with staff.

Generate questions for domain: {DOMAIN}
Number of questions requested: {COUNT}
Difficulty mix: {DIFFICULTY_MIX}
Subtopics to cover in this batch: {SUBDOMAIN_FOCUS}
Spread the batch across those subtopics instead of asking the same idea
repeatedly, and vary the clinical scenario (patient, access type, alarm,
lab value, stage of treatment) in every item.

Return a JSON array where each item has:
{
  "domain": "{DOMAIN}",
  "subdomain": "...",
  "question_text": "...",
  "option_a": "...", "option_b": "...", "option_c": "...", "option_d": "...",
  "correct_option": "A" | "B" | "C" | "D",
  "rationale": "...",
  "difficulty": "easy" | "medium" | "hard"
}`;

const NNCC_ADDENDUM = `You are generating questions for the NNCC Certified Clinical Hemodialysis
Technician (CCHT) exam, which covers these 4 domains (official NNCC
Test Blueprint weighting):

1. Clinical (48-52%) — cannulation, machine setup per prescription, vital
   signs, intradialytic monitoring, aseptic technique, access evaluation,
   hypotension/cramping protocols, recognizing complications, emergency
   response.
2. Technical (21-25%) — machine testing (pressure/alarms), dialysate
   conductivity/pH checks, water treatment monitoring, mixing concentrates,
   troubleshooting equipment malfunctions.
3. Environment (13-17%) — standard precautions, disinfecting equipment,
   infection control, safe environment, fall-risk reduction, emergency
   evacuation procedures.
4. Role Responsibilities (10-14%) — patient privacy/confidentiality/dignity,
   documentation, communication, hand-off reporting, cultural diversity,
   patient education reinforcement, precepting.

Also target this cognitive-level distribution across the questions you
generate for this batch:
- Knowledge (recall facts/terms): ~10% of items
- Comprehension (interpret/compare/explain): ~25% of items
- Application (apply concepts to a new clinical situation, solve a problem): ~65% of items
Default to "application" level unless explicitly asked for another level.

Generate questions for domain: {DOMAIN}
Number of questions requested: {COUNT}
Cognitive level target: {COGNITIVE_LEVEL}
Difficulty mix: {DIFFICULTY_MIX}
Subtopics to cover in this batch: {SUBDOMAIN_FOCUS}
Spread the batch across those subtopics instead of asking the same idea
repeatedly, and vary the clinical scenario (patient, access type, alarm,
lab value, stage of treatment) in every item.

Return a JSON array where each item has:
{
  "domain": "{DOMAIN}",
  "subdomain": "...",
  "cognitive_level": "knowledge" | "comprehension" | "application",
  "question_text": "...",
  "option_a": "...", "option_b": "...", "option_c": "...", "option_d": "...",
  "correct_option": "A" | "B" | "C" | "D",
  "rationale": "...",
  "difficulty": "easy" | "medium" | "hard"
}`;

const ADDENDA = {
  BONENT_CHT: BONENT_ADDENDUM,
  NNCC_CCHT: NNCC_ADDENDUM,
};

// Builds the system prompt for one batch: shared base + exam-specific addendum
// with the batch parameters substituted in.
export function buildSystemPrompt({
  examType,
  domain,
  count,
  cognitiveLevel,
  difficultyMix,
  subdomainFocus,
}) {
  const addendum = ADDENDA[examType]
    .replaceAll('{DOMAIN}', domain)
    .replaceAll('{COUNT}', String(count))
    .replaceAll('{COGNITIVE_LEVEL}', cognitiveLevel || 'application')
    .replaceAll('{DIFFICULTY_MIX}', difficultyMix || 'mostly medium, some easy and hard')
    .replaceAll('{SUBDOMAIN_FOCUS}', subdomainFocus || 'any subtopic of this domain');

  return `${BASE_INSTRUCTIONS}\n\n${addendum}`;
}
