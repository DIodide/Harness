"""
Sandbox tool definitions and executor for the chat agentic loop.

These tools are injected into the LLM's tool list when a harness has
sandboxEnabled=true. They are handled internally by the backend (not
routed through MCP).
"""

import json
import logging
import traceback

from app.services.daytona_service import DaytonaService

logger = logging.getLogger(__name__)

# Tool definitions in OpenAI function-calling format
SANDBOX_TOOL_DEFINITIONS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "sandbox__execute_code",
            "description": "Execute code in the sandbox. Returns stdout, stderr, and exit code. Use this to run Python, JavaScript, TypeScript, or Bash scripts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "The code to execute"},
                    "language": {
                        "type": "string",
                        "enum": ["python", "javascript", "typescript", "bash"],
                        "description": "Programming language of the code",
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in seconds (default 30)",
                        "default": 30,
                    },
                },
                "required": ["code", "language"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__run_command",
            "description": "Run a shell command in the sandbox terminal. Returns stdout, stderr, and exit code.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The shell command to run"},
                    "working_directory": {
                        "type": "string",
                        "description": "Working directory (default /home/daytona)",
                        "default": "/home/daytona",
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in seconds (default 60)",
                        "default": 60,
                    },
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__read_file",
            "description": "Read the contents of a file in the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path to the file"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__write_file",
            "description": "Write content to a file in the sandbox. Creates the file if it doesn't exist.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path to the file"},
                    "content": {"type": "string", "description": "Content to write"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__list_files",
            "description": "List files and directories at the given path in the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to list (default /home/daytona)",
                        "default": "/home/daytona",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__create_directory",
            "description": "Create a directory in the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path for the new directory"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__delete_file",
            "description": "Delete a file or directory in the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path to delete"},
                    "recursive": {
                        "type": "boolean",
                        "description": "Recursively delete directories (default false)",
                        "default": False,
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__move_file",
            "description": "Move or rename a file/directory in the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "source": {"type": "string", "description": "Source path"},
                    "destination": {"type": "string", "description": "Destination path"},
                },
                "required": ["source", "destination"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__search_file_contents",
            "description": "Search file contents in the sandbox using a regex pattern (grep-like).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory to search in"},
                    "pattern": {"type": "string", "description": "Regex pattern to search for"},
                },
                "required": ["path", "pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__search_file_names",
            "description": "Search for files by name pattern in the sandbox (glob-like).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory to search in"},
                    "pattern": {"type": "string", "description": "Glob pattern to match file names"},
                },
                "required": ["path", "pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__find_and_replace",
            "description": "Find and replace text across multiple files in the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "files": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of file paths to process",
                    },
                    "pattern": {"type": "string", "description": "Pattern to find"},
                    "replacement": {"type": "string", "description": "Replacement text"},
                },
                "required": ["files", "pattern", "replacement"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__git_clone",
            "description": "Clone a git repository into the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Repository URL"},
                    "path": {"type": "string", "description": "Target path (auto-detected from URL if omitted)"},
                    "branch": {"type": "string", "description": "Branch to checkout after cloning"},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__git_status",
            "description": "Get git status for a repository in the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the git repository"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__git_add",
            "description": "Stage files for commit in the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Repository path"},
                    "files": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": 'Files to stage (use ["."] for all)',
                    },
                },
                "required": ["path", "files"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__git_commit",
            "description": "Commit staged changes in the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Repository path"},
                    "message": {"type": "string", "description": "Commit message"},
                },
                "required": ["path", "message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__git_push",
            "description": "Push commits to the remote repository.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Repository path"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__git_pull",
            "description": "Pull from the remote repository.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Repository path"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__git_branches",
            "description": "List branches in a git repository in the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Repository path"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__git_checkout",
            "description": "Checkout a branch in the sandbox. Optionally create a new branch.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Repository path"},
                    "branch": {"type": "string", "description": "Branch name"},
                    "create": {
                        "type": "boolean",
                        "description": "Create the branch if it doesn't exist",
                        "default": False,
                    },
                },
                "required": ["path", "branch"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__git_log",
            "description": "Show recent git commits.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Repository path"},
                    "count": {
                        "type": "integer",
                        "description": "Number of commits to show (default 10)",
                        "default": 10,
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox__git_diff",
            "description": "Show git diff for a repository in the sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Repository path"},
                    "staged": {
                        "type": "boolean",
                        "description": "Show staged changes only",
                        "default": False,
                    },
                },
                "required": ["path"],
            },
        },
    },
]

# Set of all sandbox tool names for fast lookup
SANDBOX_TOOL_NAMES: set[str] = {
    t["function"]["name"] for t in SANDBOX_TOOL_DEFINITIONS
}


def execute_sandbox_tool(
    service: DaytonaService,
    sandbox_id: str,
    tool_name: str,
    arguments: dict,
    git_credentials: dict | None = None,
) -> str:
    """
    Execute a sandbox tool and return the result as a JSON string.

    This is called from the chat agentic loop when the LLM invokes a
    sandbox tool (prefixed with 'sandbox__').

    git_credentials: optional dict with 'username' and 'password' keys,
        resolved from the user's GitHub MCP OAuth token.
    """
    try:
        # Strip the sandbox__ prefix for dispatch
        action = tool_name.replace("sandbox__", "")

        if action == "execute_code":
            result = service.execute_code(
                sandbox_id,
                arguments["code"],
                arguments.get("language", "python"),
                arguments.get("timeout", 30),
            )
            payload: dict = {
                "type": "code_execution",
                "exit_code": result.exit_code,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "execution_time": result.execution_time,
                "language": arguments.get("language", "python"),
            }
            if result.charts:
                payload["charts"] = result.charts
            return json.dumps(payload)

        elif action == "run_command":
            result = service.run_command(
                sandbox_id,
                arguments["command"],
                arguments.get("working_directory", "/home/daytona"),
                arguments.get("timeout", 60),
            )
            return json.dumps({
                "type": "command_result",
                "exit_code": result.exit_code,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "command": arguments["command"],
            })

        elif action == "read_file":
            file_path = arguments["path"]
            ext = file_path.rsplit(".", 1)[-1].lower() if "." in file_path else ""
            image_exts = {"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"}
            if ext in image_exts:
                # Return image as base64 for inline display
                import base64
                sandbox = service._ensure_running(sandbox_id)
                raw = sandbox.fs.download_file(file_path)
                if raw is None:
                    return json.dumps({"type": "error", "message": f"File not found: {file_path}"})
                b64 = base64.b64encode(raw if isinstance(raw, bytes) else raw.encode()).decode()
                mime = {
                    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                    "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml",
                    "bmp": "image/bmp", "ico": "image/x-icon",
                }.get(ext, "application/octet-stream")
                return json.dumps({
                    "type": "image",
                    "path": file_path,
                    "mime": mime,
                    "data": b64,
                })
            content = service.read_file(sandbox_id, file_path)
            return json.dumps({
                "type": "file_content",
                "path": file_path,
                "content": content,
            })

        elif action == "write_file":
            service.write_file(sandbox_id, arguments["path"], arguments["content"])
            return json.dumps({
                "type": "success",
                "message": f"Written to {arguments['path']}",
                "path": arguments["path"],
            })

        elif action == "list_files":
            files = service.list_files(sandbox_id, arguments.get("path", "/home/daytona"))
            return json.dumps({
                "type": "file_list",
                "path": arguments.get("path", "/home/daytona"),
                "files": [
                    {"name": f.name, "path": f.path, "is_dir": f.is_dir, "size": f.size}
                    for f in files
                ],
            })

        elif action == "create_directory":
            service.create_directory(sandbox_id, arguments["path"])
            return json.dumps({
                "type": "success",
                "message": f"Created directory {arguments['path']}",
            })

        elif action == "delete_file":
            service.delete_file(
                sandbox_id, arguments["path"], arguments.get("recursive", False)
            )
            return json.dumps({
                "type": "success",
                "message": f"Deleted {arguments['path']}",
            })

        elif action == "move_file":
            service.move_file(sandbox_id, arguments["source"], arguments["destination"])
            return json.dumps({
                "type": "success",
                "message": f"Moved {arguments['source']} to {arguments['destination']}",
            })

        elif action == "search_file_contents":
            matches = service.search_file_contents(
                sandbox_id, arguments["path"], arguments["pattern"]
            )
            return json.dumps({
                "type": "search_results",
                "matches": matches,
            })

        elif action == "search_file_names":
            files = service.search_file_names(
                sandbox_id, arguments["path"], arguments["pattern"]
            )
            return json.dumps({
                "type": "search_results",
                "files": files,
            })

        elif action == "find_and_replace":
            results = service.find_and_replace(
                sandbox_id,
                arguments["files"],
                arguments["pattern"],
                arguments["replacement"],
            )
            return json.dumps({
                "type": "replace_results",
                "results": results,
            })

        elif action == "git_clone":
            creds = git_credentials or {}
            url = arguments["url"]
            needs_auth = "github.com" in url and not creds
            if needs_auth:
                return json.dumps({
                    "type": "error",
                    "error_code": "github_auth_required",
                    "message": "GitHub authentication required to clone private repositories. "
                               "Connect your GitHub account in the harness sandbox settings.",
                })
            path = service.git_clone(
                sandbox_id,
                url,
                arguments.get("path"),
                arguments.get("branch"),
                username=creds.get("username"),
                password=creds.get("password"),
            )
            return json.dumps({
                "type": "success",
                "message": f"Cloned {arguments['url']} to {path}",
                "path": path,
            })

        elif action == "git_status":
            status = service.git_status(sandbox_id, arguments["path"])
            return json.dumps({
                "type": "git_status",
                "branch": status.branch,
                "ahead": status.ahead,
                "behind": status.behind,
                "files": status.files,
            })

        elif action == "git_add":
            service.git_add(sandbox_id, arguments["path"], arguments["files"])
            return json.dumps({
                "type": "success",
                "message": f"Staged {len(arguments['files'])} file(s)",
            })

        elif action == "git_commit":
            sha = service.git_commit(
                sandbox_id, arguments["path"], arguments["message"]
            )
            return json.dumps({
                "type": "git_commit",
                "sha": sha,
                "message": arguments["message"],
            })

        elif action == "git_push":
            if not git_credentials:
                return json.dumps({
                    "type": "error",
                    "error_code": "github_auth_required",
                    "message": "GitHub authentication required to push. "
                               "Connect your GitHub account in the harness sandbox settings.",
                })
            service.git_push(
                sandbox_id, arguments["path"],
                username=git_credentials["username"],
                password=git_credentials["password"],
            )
            return json.dumps({"type": "success", "message": "Pushed to remote"})

        elif action == "git_pull":
            if not git_credentials:
                return json.dumps({
                    "type": "error",
                    "error_code": "github_auth_required",
                    "message": "GitHub authentication required to pull from private repos. "
                               "Connect your GitHub account in the harness sandbox settings.",
                })
            service.git_pull(
                sandbox_id, arguments["path"],
                username=git_credentials["username"],
                password=git_credentials["password"],
            )
            return json.dumps({"type": "success", "message": "Pulled from remote"})

        elif action == "git_branches":
            result = service.git_branches(sandbox_id, arguments["path"])
            return json.dumps({
                "type": "git_branches",
                "branches": result["branches"],
            })

        elif action == "git_checkout":
            service.git_checkout(
                sandbox_id,
                arguments["path"],
                arguments["branch"],
                arguments.get("create", False),
            )
            return json.dumps({
                "type": "success",
                "message": f"Checked out branch '{arguments['branch']}'",
            })

        elif action == "git_log":
            commits = service.git_log(
                sandbox_id, arguments["path"], arguments.get("count", 10)
            )
            return json.dumps({"type": "git_log", "commits": commits})

        elif action == "git_diff":
            diff = service.git_diff(
                sandbox_id, arguments["path"], arguments.get("staged", False)
            )
            return json.dumps({"type": "git_diff", "diff": diff})

        else:
            return json.dumps({"type": "error", "message": f"Unknown sandbox tool: {tool_name}"})

    except Exception as e:
        logger.error("Sandbox tool '%s' failed: %s", tool_name, e)
        return json.dumps({
            "type": "error",
            "message": str(e),
            "traceback": traceback.format_exc(),
        })
