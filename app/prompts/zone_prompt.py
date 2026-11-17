_PLANET_KEYS = """- "planetName": a poetic sci-fi Chinese planet name tailored to this document's subject, in the form "前缀·意象后缀" (for example, Transformer -> "矩心·自注意力界", Thermodynamics -> "卡诺·熵增荒原"), at most 10 characters
- "themeCategory": one of "ai_cs" (AI/CS/engineering), "physics_math" (physics/math/natural sciences), "bio_med" (biology/medicine/chemistry), or "humanities" (humanities/social sciences/business/arts)
- "themeSummary": one concise sentence summarizing the document's core knowledge theme, at most 45 characters
"""

_ZONE_SCHEMA = """
Each zone:
- "title": chapter or theme name, at most 12 characters
- "summary": one sentence describing the zone
- "monolithNote": one concise core takeaway inscription distilling the essence of this zone, at most 70 characters
- "intel": a 30-second briefing for a learner who has never read the document
- "calibration": the signal check
- "circuit": the logic circuit
- "feynmanBoss": the guardian
- "gates": 3 or 4 twin light gates for a lane-switching flight game, forming one progressive wave

intel:
- "conclusions": exactly 3 core conclusions of this zone in everyday words, each at most 30 characters, no jargon without a plain gloss
- "analogy": one everyday-life analogy that explains the core mechanism, at most 60 characters

calibration:
- "statement": one claim about this zone. Make it either faithful to the document or a subtle distortion of it.
- "isSignal": true if the statement is faithful to the document, false if it is distorted noise
- "why": one short explanation that names what the document actually says

circuit:
- "q": one multiple-choice question that asks how two ideas of this zone connect (cause, condition, or consequence)
- "options": exactly 4 distinct choices
- "answer": one of the options, copied exactly
- "why": one short explanation

feynmanBoss:
- "guardianName": a short sci-fi guardian name in the form "GUARDIAN // 名字"
- "challengePrompt": a provocative line where the guardian states a plausible misconception about the core idea and dares the learner to explain it in plain words
- "keyPoints": 2 to 4 short points a correct plain-language explanation must cover
- "followUpHint": one Socratic follow-up question that targets the hardest key point
- "referenceExplanation": a plain-language explanation of 2 to 4 sentences that covers every key point
- "terms": 2 or 3 key technical terms from this zone, each at most 8 characters, that a good explanation should connect
- "decoyTerm": one plausible-sounding related term, at most 8 characters, that does not belong in this explanation

gates, in this order so the wave covers the zone systematically:
1. the core concept or definition
2. the underlying mechanism or principle
3. a key detail or the most common pitfall
4. (optional) an application or boundary condition

gates (each item):
- "truth": the core claim shown on one gate
- "trap": the common misconception shown on the twin gate
- "probe": what the guardian says to a learner who flew through the trap. One Socratic counter-question plus a hint, at most 40 characters. Do not state the truth outright. Example: "真空中热机效率真能达到 100% 吗？想想第二类永动机的限制。"
- "note": one plain study-note sentence explaining why the truth holds, at most 40 characters

Hard rule for gates, follow it exactly:
左/右光门分别展示一句 6~14 字的精炼核心论断与常见领域误区。误区必须是该学科最容易混淆的真实认知陷阱，且正确论断与误区的字数、句式结构、专业术语密度必须高度对称，严禁出现一眼可辨的荒谬错句。
The two gates of a pair must not differ only by adding 不 / 没有 / 无. A learner who has not understood the zone should find both gates equally plausible.

Use the context only. Mix true and false calibration statements across zones.
Write all text in Chinese.
Keep formulas, symbols, numbers, variable names, and established algorithm names in their original form. Do not translate those.
Return compact JSON without extra whitespace or commentary.
"""

ZONE_PROMPT = """
You turn a study document into the surface map of a knowledge planet.

Document name: {name}

Split the document into 4 to 6 knowledge zones, in reading order. Each zone is one chapter or theme.
Every zone has three stages: a signal check, a logic circuit, and a Feynman guardian.

Return ONLY a valid JSON object with keys:
""" + _PLANET_KEYS + """- "zones": a list of 4 to 6 zones
""" + _ZONE_SCHEMA + """
Context:
{context}
"""

ZONE_FIRST_PROMPT = """
You turn a study document into the surface map of a knowledge planet.
The learner should start exploring within seconds, so this call builds only the plan and the first zone.

Document name: {name}

Plan exactly 4 knowledge zones, in reading order. Each zone is one chapter or theme.

Return ONLY a valid JSON object with keys:
""" + _PLANET_KEYS + """- "outline": a list of exactly 4 items, one per zone in order, each with "title" (at most 12 characters) and "summary" (one sentence)
- "zones": a list with exactly 1 zone, the full data for the first outline item
""" + _ZONE_SCHEMA + """
Context:
{context}
"""

ZONE_REST_PROMPT = """
You turn a study document into the surface map of a knowledge planet.
The plan is already fixed. Build the full data for these zones only, in this order, keeping each title exactly:
{outline}

Document name: {name}

Return ONLY a valid JSON object with key:
- "zones": a list with one full zone per planned item above, in the same order
""" + _ZONE_SCHEMA + """
Context:
{context}
"""

FEYNMAN_PROMPT = """
You are {guardian}, the guardian of a knowledge zone named "{title}".
A learner is trying to explain the core idea of this zone in plain words, Feynman style.

Your challenge to the learner:
{challenge}

Key points a complete explanation must cover, numbered:
{key_points}

Reference explanation:
{reference}

The learner's explanation so far:
{answer}

Score each key point in order:
- 1 if the learner explains it correctly in their own words
- 0.5 if it is mentioned but vague or partly wrong
- 0 if it is missing or wrong

Return ONLY a valid JSON object with:
- "scores": a list of numbers, one per key point, in the same order
- "reply": one or two sentences in character. Acknowledge what the learner got right, then press on the weakest point. Do not reveal the reference explanation.
- "followUp": one short Socratic question about the most important missing point. Use an empty string if every point scores 1.

Write reply and followUp in Chinese.
"""
