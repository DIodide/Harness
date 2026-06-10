"""Tests for ACP form-elicitation parsing (AskUserQuestion support)."""

from app.services.agents.session_manager import parse_elicitation_fields


def ask_user_question_schema() -> dict:
    """The shape claude-agent-acp emits for a two-question AskUserQuestion."""
    return {
        "type": "object",
        "properties": {
            "question_0": {
                "type": "string",
                "title": "Approach",
                "description": "Which approach should we take?",
                "oneOf": [
                    {"const": "Fast", "title": "Fast — ship it quick"},
                    {"const": "Thorough", "title": "Thorough — full rewrite"},
                ],
            },
            "question_1": {
                "type": "array",
                "title": "Targets",
                "description": "Which platforms matter?",
                "items": {
                    "anyOf": [
                        {"const": "web", "title": "web"},
                        {"const": "mobile", "title": "mobile"},
                    ]
                },
            },
            "customAnswer": {
                "type": "string",
                "title": "Other",
                "description": "Type your own answer (optional).",
            },
        },
    }


class TestParseElicitationFields:
    def test_single_select_question(self):
        fields = parse_elicitation_fields(ask_user_question_schema())
        select = fields[0]
        assert select["key"] == "question_0"
        assert select["kind"] == "select"
        assert select["title"] == "Approach"
        assert select["description"] == "Which approach should we take?"
        assert select["options"] == [
            {"value": "Fast", "label": "Fast — ship it quick"},
            {"value": "Thorough", "label": "Thorough — full rewrite"},
        ]

    def test_multi_select_question(self):
        fields = parse_elicitation_fields(ask_user_question_schema())
        multi = fields[1]
        assert multi["kind"] == "multiselect"
        assert [o["value"] for o in multi["options"]] == ["web", "mobile"]

    def test_free_text_field(self):
        fields = parse_elicitation_fields(ask_user_question_schema())
        custom = fields[2]
        assert custom["key"] == "customAnswer"
        assert custom["kind"] == "text"

    def test_boolean_field(self):
        fields = parse_elicitation_fields(
            {"properties": {"confirm": {"type": "boolean", "title": "Confirm?"}}}
        )
        assert fields == [
            {
                "key": "confirm",
                "title": "Confirm?",
                "description": None,
                "kind": "boolean",
            }
        ]

    def test_option_label_falls_back_to_const(self):
        fields = parse_elicitation_fields(
            {
                "properties": {
                    "q": {"type": "string", "oneOf": [{"const": "A"}]},
                }
            }
        )
        assert fields[0]["options"] == [{"value": "A", "label": "A"}]

    def test_empty_and_malformed_schemas(self):
        assert parse_elicitation_fields({}) == []
        assert parse_elicitation_fields({"properties": {"x": "not-a-dict"}}) == []
