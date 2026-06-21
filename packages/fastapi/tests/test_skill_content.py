"""The shared GitHub SKILL.md resolver (used by the default loop and the ACP
gateway). Mocks httpx so nothing hits the network."""

from app.services import skill_content


class FakeResp:
    def __init__(self, status_code: int, text: str = "", json_data=None):
        self.status_code = status_code
        self.text = text
        self._json = json_data or {}

    def json(self):
        return self._json


class FakeClient:
    """Routes each .get(url) through a handler(url) -> FakeResp."""

    def __init__(self, handler):
        self._handler = handler

    async def get(self, url, **_kw):
        return self._handler(url)


class TestFetchSkillMd:
    async def test_direct_path_hit(self):
        def handler(url):
            if url.endswith("/main/skills/foo/SKILL.md"):
                return FakeResp(200, text="# Foo skill")
            return FakeResp(404)

        md = await skill_content.fetch_skill_md(
            FakeClient(handler), "owner/repo/foo"
        )
        assert md == "# Foo skill"

    async def test_tree_search_fallback(self):
        def handler(url):
            if "git/trees" in url and "/main?" in url:
                return FakeResp(
                    200,
                    json_data={
                        "tree": [
                            {"type": "blob", "path": "nested/dir/foo/SKILL.md"},
                        ]
                    },
                )
            if url.endswith("/main/nested/dir/foo/SKILL.md"):
                return FakeResp(200, text="# Found via tree")
            return FakeResp(404)

        md = await skill_content.fetch_skill_md(
            FakeClient(handler), "owner/repo/foo"
        )
        assert md == "# Found via tree"

    async def test_unresolvable_returns_none(self):
        def handler(url):
            if "git/trees" in url:
                return FakeResp(200, json_data={"tree": []})
            if "skills.sh" in url:
                return FakeResp(200, json_data={"skills": []})
            return FakeResp(404)

        md = await skill_content.fetch_skill_md(
            FakeClient(handler), "owner/repo/nope"
        )
        assert md is None

    async def test_no_source_returns_none(self):
        md = await skill_content.fetch_skill_md(
            FakeClient(lambda _u: FakeResp(404)), "single-segment"
        )
        assert md is None


class TestGithubAuthHeaders:
    def test_token_present(self, monkeypatch):
        monkeypatch.setenv("GITHUB_TOKEN", "tok123")
        assert skill_content._api_headers()["Authorization"] == "token tok123"
        assert skill_content._raw_headers() == {"Authorization": "token tok123"}

    def test_token_absent(self, monkeypatch):
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        assert "Authorization" not in skill_content._api_headers()
        assert skill_content._raw_headers() is None
