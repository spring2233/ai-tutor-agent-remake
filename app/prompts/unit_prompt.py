UNIT_PROMPT = """
You extract study units from one section of a document.

Return ONLY a valid JSON object with key "units", a list.
Each unit:
- "name": the concept name (short)
- "statement": the full claim, definition, or result. Copy formulas and symbols completely. Do not cut a formula in half.
- "prerequisites": a list of concept names this unit depends on. Use [] if none are stated.
- "plain": one everyday-language sentence explaining the idea.

Rules:
- Use only this section. If the section has several distinct ideas, output several units.
- If the section is references, acknowledgements, or has no learnable idea, return {{"units": []}}.
- Keep formulas, symbols, numbers, variable names, and algorithm names in their original form.
- Write "name", "statement", and "plain" in the same language as the section, preferring Chinese for "plain" when the learner-facing text can be Chinese.

Section:
{context}
"""
