import json

from app.llm_factory import make_llm


def validate_input(
    goal: str,
    current_level: str,
    topics: list[str],
    daily_hours: float,
    duration_days: int,
    plan_type: str = "learning",
    exam_date: str | None = None,
):
    """
    Validate the information required to create
    a flexible personalized study plan.

    duration_days represents the number of study sessions,
    not calendar days.
    """

    if not goal or not goal.strip():
        raise ValueError("Goal cannot be empty.")

    if not current_level or not current_level.strip():
        raise ValueError("Current level cannot be empty.")

    if not topics:
        raise ValueError("At least one topic is required.")

    cleaned_topics = [topic.strip() for topic in topics if topic.strip()]

    if not cleaned_topics:
        raise ValueError("At least one valid topic is required.")

    if daily_hours <= 0:
        raise ValueError("Available study time must be greater than 0.")

    if duration_days <= 0:
        raise ValueError("Number of study sessions must be greater than 0.")
    if plan_type not in {"learning", "exam_preparation"}:
        raise ValueError("plan_type must be either 'learning' or 'exam_preparation'.")

    if plan_type == "exam_preparation" and not exam_date:
        raise ValueError("exam_date is required for exam preparation mode.")

    return {
        "goal": goal.strip(),
        "current_level": current_level.strip(),
        "topics": cleaned_topics,
        "daily_hours": daily_hours,
        "duration_days": duration_days,
        "plan_type": plan_type,
        "exam_date": exam_date,
    }


STUDY_PLAN_PROMPT = """
You are an expert personalized study-plan generator.

Create a realistic and flexible study plan for a student based on the information below.

Goal:
{goal}

Plan type:
{plan_type}

Current level:
{current_level}

Topics:
{topics}

Exam date:
{exam_date}

Available study time per study session:
{daily_hours} hours

Number of study sessions:
{duration_days}

IMPORTANT SCHEDULING RULES:

1. The number of study sessions MUST be exactly {duration_days}.
2. A study session does NOT mean a calendar day.
3. The student can complete sessions whenever they want.
4. The student does NOT have to study on consecutive calendar days.
5. Never assign calendar dates, weekdays, or specific dates to sessions.
6. If the student skips a calendar day, no study session is lost.
7. The plan represents independent learning sessions, not a fixed calendar schedule.
8. Every study session MUST fit within the available study time.
9. The total duration of ALL tasks in one session MUST NOT exceed
   {daily_hours} × 60 minutes.
10. Distribute the provided topics in a logical learning order.
11. Start from the student's current level.
12. Keep each study session concise and realistic.
13. Prefer 2 or 3 tasks per study session, but use fewer tasks when necessary
    to stay within the time limit.
14. Include learning, practice, and revision where appropriate.
15. Make the plan practical and achievable.
16. Do not introduce completely unrelated topics.
17. Return ONLY valid JSON.
18. Do not include reasoning, explanations, Markdown, or code fences.
19. Start the response directly with {{ and end it with }}.


IMPORTANT PLAN TYPE RULES:

If plan type is "learning":

- Focus on building understanding from the student's current level.
- Progress from fundamentals to practice and revision.
- Give reasonable coverage to the provided topics.
- Do not prioritize topics based on an exam deadline.
- Balance learning, practice, and revision across the sessions.


If plan type is "exam_preparation":

- The student has a specific exam and limited preparation time.
- Use the exam date to determine urgency.
- Prioritize the most important, fundamental, high-value, or difficult topics.
- Do NOT give equal time to every topic when preparation time is limited.
- If there are more topics than can realistically be covered, prioritize
  the most important topics and reduce or omit lower-priority topics.
- Focus on exam-relevant understanding and problem-solving rather than
  lengthy explanations.
- Include practice problems for important topics.
- Include revision of previously learned material.
- Include a final revision or mock-test session when the number of sessions
  allows it.
- As the exam becomes closer, increase emphasis on practice, revision,
  and weak areas rather than introducing many new topics.
- The exam date is used only to determine urgency and priority.
- NEVER assign sessions to specific calendar dates.
- The student can complete the generated sessions whenever they have time.


If exam date is "Not applicable":

- Do not mention or use an exam date.


IMPORTANT HARD TIME CONSTRAINT:

This is a STRICT mathematical constraint, NOT a recommendation.

The maximum duration for EVERY study session is:

{daily_hours} × 60 minutes.

For example:

- If daily_hours = 1 → maximum 60 minutes
- If daily_hours = 2 → maximum 120 minutes
- If daily_hours = 3 → maximum 180 minutes
- If daily_hours = 4 → maximum 240 minutes

The duration of a session means the SUM of duration_minutes
of ALL tasks inside that session.

For example, when daily_hours = 3:

60 + 60 + 60 = 180 → VALID

90 + 60 + 30 = 180 → VALID

60 + 90 + 60 = 210 → INVALID

90 + 90 + 90 = 270 → INVALID


BEFORE RETURNING THE JSON:

Calculate the total duration of EVERY session individually.

If a session exceeds the maximum:

- Reduce task durations.
- Remove a lower-priority task if necessary.
- Combine related tasks if appropriate.
- Redistribute content across other sessions if appropriate.
- NEVER return a session above the maximum.

The final JSON MUST NOT contain any session whose total duration
exceeds {daily_hours} × 60 minutes.


IMPORTANT:

Do NOT assume that having 2 or 3 tasks means each task can use
a large amount of time.

For example, with daily_hours = 3:

Three tasks of 60 minutes = 180 minutes → VALID.

Three tasks of 90 minutes = 270 minutes → INVALID.


LIMITED-TIME EXAM PREPARATION:

For exam_preparation:

- Limited time means PRIORITIZE, not overload.
- Do not try to fit every topic into every session.
- Prefer fewer high-value tasks over many tasks.
- Prioritize fundamentals and frequently useful concepts.
- Allocate sufficient time for problem-solving.
- Reserve time for revision and mock testing when possible.


FINAL VALIDATION CHECK:

Before returning the JSON, verify ALL of the following:

1. Exactly {duration_days} study sessions exist.
2. Every session contains at least one task.
3. Every task has a topic.
4. Every task has a description.
5. Every task has a positive duration_minutes value.
6. Every session's total duration is <= {daily_hours} × 60 minutes.
7. No session exceeds the available study time.
8. No calendar dates are assigned.
9. Only the provided topics are used, unless combining them into a
   clearly related mixed-topic revision task.
10. Exam preparation prioritizes important topics when time is limited.
11. The response contains ONLY valid JSON.


Each study session should have:

- A session number
- One or more tasks
- A topic for each task
- A description
- Duration in minutes


Return exactly this structure:

{{
    "study_sessions": [
        {{
            "session": 1,
            "tasks": [
                {{
                    "topic": "topic name",
                    "description": "what the student should do",
                    "duration_minutes": 60
                }}
            ]
        }}
    ]
}}
"""
llm = make_llm(temperature=0.7)


def generate_study_plan(
    goal: str,
    current_level: str,
    topics: list[str],
    daily_hours: float,
    duration_days: int,
    plan_type: str = "learning",
    exam_date: str | None = None,
):
    """
    Generate a personalized study plan.
    """

    validated = validate_input(
        goal=goal,
        current_level=current_level,
        topics=topics,
        daily_hours=daily_hours,
        duration_days=duration_days,
        plan_type=plan_type,
        exam_date=exam_date,
    )

    prompt = STUDY_PLAN_PROMPT.format(
        goal=validated["goal"],
        current_level=validated["current_level"],
        topics=", ".join(validated["topics"]),
        daily_hours=validated["daily_hours"],
        duration_days=validated["duration_days"],
        plan_type=validated["plan_type"],
        exam_date=validated["exam_date"] or "Not applicable",
    )

    response = llm.invoke(prompt)

    print("\n========== RAW LLM RESPONSE ==========")
    print(repr(response.content))
    print("======================================\n")

    response_text = response.content

    # Remove accidental Markdown code fences
    if response_text.startswith("```"):
        response_text = response_text.replace("```json", "")
        response_text = response_text.replace("```", "")
        response_text = response_text.strip()

    try:
        plan = json.loads(response_text)
    except json.JSONDecodeError as error:
        raise ValueError("The LLM returned invalid JSON.") from error

    # Initialize every generated study session as pending.
    # Validate and initialize generated study sessions.
    # Validate and initialize generated study sessions.
    max_minutes = int(validated["daily_hours"] * 60)

    for session in plan.get("study_sessions", []):
        session["status"] = "pending"

        total_minutes = sum(
            task.get("duration_minutes", 0) for task in session.get("tasks", [])
        )

        if total_minutes > max_minutes:
            raise ValueError(
                f"Study session {session.get('session')} exceeds "
                f"the available study time of {max_minutes} minutes. "
                f"Generated duration: {total_minutes} minutes."
            )

    return plan


def complete_session(plan: dict, session_number: int) -> dict:
    """
    Mark a study session as completed.

    Sessions are independent of calendar dates.
    Skipping a day does not affect the plan.
    """

    sessions = plan.get("study_sessions", [])

    for session in sessions:
        if session.get("session") == session_number:
            session["status"] = "completed"
            return plan

    raise ValueError(f"Study session {session_number} does not exist.")


def start_session(plan: dict, session_number: int) -> dict:
    """
    Mark a study session as in progress.
    """

    sessions = plan.get("study_sessions", [])

    for session in sessions:
        if session.get("session") == session_number:
            if session.get("status", "pending") == "completed":
                raise ValueError(
                    f"Study session {session_number} is already completed."
                )

            session["status"] = "in_progress"
            return plan

    raise ValueError(f"Study session {session_number} does not exist.")


def get_next_pending_session(plan: dict):
    """
    Return the first study session whose status is pending.
    """

    sessions = plan.get("study_sessions", [])

    for session in sessions:
        if session.get("status", "pending") == "pending":
            return session

    return None


def get_study_plan_progress(plan: dict) -> dict:
    """
    Return the current progress of a flexible study plan.
    """

    sessions = plan.get("study_sessions", [])

    total_sessions = len(sessions)

    completed_sessions = sum(
        1 for session in sessions if session.get("status", "pending") == "completed"
    )

    in_progress_sessions = [
        session["session"]
        for session in sessions
        if session.get("status", "pending") == "in_progress"
    ]

    next_pending = get_next_pending_session(plan)

    return {
        "total_sessions": total_sessions,
        "completed_sessions": completed_sessions,
        "remaining_sessions": total_sessions - completed_sessions,
        "in_progress_session": (
            in_progress_sessions[0] if in_progress_sessions else None
        ),
        "next_pending_session": (next_pending["session"] if next_pending else None),
    }
