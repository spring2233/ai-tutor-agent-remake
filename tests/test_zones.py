from app.ui import backend


def zone(index, is_signal=True):
    return {
        "title": f"Zone {index}",
        "summary": "A theme.",
        "calibration": {"statement": f"Claim {index}", "isSignal": is_signal, "why": "Doc says."},
        "circuit": {
            "q": f"Link {index}",
            "options": ["Alpha", "Beta", "Gamma", "Delta"],
            "answer": "Beta",
            "why": "Because.",
        },
        "feynmanBoss": {
            "guardianName": "GUARDIAN // Test",
            "challengePrompt": "Explain it.",
            "keyPoints": ["Point A", "Point B", "Point B"],
            "followUpHint": "What about B?",
            "referenceExplanation": "A then B.",
        },
    }


def test_normalize_gates_keeps_four_progressive_gates_with_notes():
    boss = {"followUpHint": "Hint?"}
    items = [
        {"truth": f"第{i}门核心论断成立", "trap": f"第{i}门常见误区成立", "probe": "", "note": "因为文档这样说"}
        for i in range(1, 6)
    ]

    gates = backend._normalize_gates(items, boss)

    assert len(gates) == 4
    assert gates[0] == {"truth": "第1门核心论断成立", "trap": "第1门常见误区成立", "probe": "Hint?", "note": "因为文档这样说"}


def test_first_stage_zone_and_outline():
    raw = {
        "outline": [{"title": "Plan 1", "summary": "x"}, {"title": "Zone 2", "summary": "Second."}, {"title": "Zone 3"}],
        "zones": [zone(1)],
    }

    zones = backend._normalize_zones(raw, min_count=1, max_count=1)
    outline = backend._normalize_outline(raw, zones[0])

    assert [z["id"] for z in zones] == ["zone-1"]
    assert outline == [
        {"title": "Zone 1", "summary": "A theme."},
        {"title": "Zone 2", "summary": "Second."},
        {"title": "Zone 3", "summary": ""},
    ]


def test_rest_stage_ids_continue_after_first_zone():
    zones = backend._normalize_zones({"zones": [zone(2), zone(3), zone(4)]}, min_count=1, max_count=3, id_offset=1)

    assert [z["id"] for z in zones] == ["zone-2", "zone-3", "zone-4"]


def test_normalize_zones_keeps_valid_map():
    raw = {"zones": [zone(1), zone(2, "噪声"), zone(3, "false"), zone(4)]}

    zones = backend._normalize_zones(raw)

    assert [item["id"] for item in zones] == ["zone-1", "zone-2", "zone-3", "zone-4"]
    assert zones[1]["calibration"]["isSignal"] is False
    assert zones[0]["status"] == "locked"
    assert zones[0]["feynmanBoss"]["keyPoints"] == ["Point A", "Point B"]


def test_normalize_zones_keeps_intel_and_capsule_terms():
    first = zone(1)
    first["intel"] = {"conclusions": ["One", "Two", "Two", "Three", "Four"], "analogy": "Like a relay."}
    first["feynmanBoss"]["terms"] = ["Residual", "Gradient", "Residual", "Dropout"]
    first["feynmanBoss"]["decoyTerm"] = "Dropout"

    zones = backend._normalize_zones({"zones": [first, zone(2), zone(3), zone(4)]})

    assert zones[0]["intel"] == {"conclusions": ["One", "Two", "Three"], "analogy": "Like a relay."}
    assert zones[0]["feynmanBoss"]["terms"] == ["Residual", "Gradient"]
    assert zones[0]["feynmanBoss"]["decoyTerm"] == "Dropout"


def test_normalize_zones_fills_missing_intel_from_key_points():
    zones = backend._normalize_zones({"zones": [zone(1), zone(2), zone(3), zone(4)]})

    assert zones[0]["intel"]["conclusions"] == ["A theme.", "Point A", "Point B"]
    assert zones[0]["intel"]["analogy"] == ""
    assert zones[0]["feynmanBoss"]["terms"] == []


def test_normalize_zones_keeps_symmetric_gates_only():
    first = zone(1)
    first["gates"] = [
        {"truth": "孤立系统总熵永不减少。", "trap": "任何系统的熵都不能减少", "probe": "冰箱是孤立系统吗？"},
        {"truth": "熵增", "trap": "熵减", "probe": "太短"},
        {"truth": "取对数使熵具有可加性", "trap": "错", "probe": "长度悬殊"},
        {"truth": "单一热源无法持续做功", "trap": "无摩擦即可单源全转功", "probe": ""},
    ]

    zones = backend._normalize_zones({"zones": [first, zone(2), zone(3), zone(4)]})

    assert zones[0]["gates"] == [
        {"truth": "孤立系统总熵永不减少", "trap": "任何系统的熵都不能减少", "probe": "冰箱是孤立系统吗？"},
        {"truth": "单一热源无法持续做功", "trap": "无摩擦即可单源全转功", "probe": "What about B?"},
    ]
    assert zones[1]["gates"] == []


def test_normalize_zones_rejects_short_map():
    broken = zone(3)
    broken["feynmanBoss"]["keyPoints"] = ["Only one"]

    assert backend._normalize_zones({"zones": [zone(1), zone(2), broken, zone(4)]}) is None


def test_feynman_eval_full_drops_follow_up_and_extra_scores():
    result = backend._normalize_feynman_eval(
        {"scores": [1, 1, 1, 1, 0], "reply": "Good.", "followUp": "More?"},
        4,
    )

    assert result["resonance"] == 100
    assert result["followUp"] == ""


def test_feynman_eval_partial_keeps_follow_up():
    result = backend._normalize_feynman_eval({"scores": [1, 1, 1, 0.5]}, 4)

    assert result["resonance"] == 88


def test_feynman_eval_pads_missing_scores():
    result = backend._normalize_feynman_eval({"scores": ["1"], "reply": "", "followUp": "Why B?"}, 2)

    assert result["resonance"] == 50
    assert result["scores"] == [1.0, 0.0]
    assert result["followUp"] == "Why B?"
