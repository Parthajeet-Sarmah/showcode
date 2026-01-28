"""
Commit history and diff service.
"""

import logging
from typing import Optional, List, Dict, Any
from datetime import datetime

from backend.database import (
    save_cached_commit,
    get_cached_commits,
    save_file_version,
    get_file_version,
)
from .client import GitHubClient
from .oauth import OAuthHandler


class CommitService:
    """Service for viewing commit history and diffs."""

    def __init__(self, oauth_handler: OAuthHandler):
        """
        Initialize commit service.

        Args:
            oauth_handler: OAuthHandler for getting access tokens.
        """
        self.oauth_handler = oauth_handler

    def _get_client(self, user_id: str) -> Optional[GitHubClient]:
        """Get GitHub client for a user."""
        access_token = self.oauth_handler.get_access_token(user_id)
        if not access_token:
            logging.error(f"No access token for user {user_id}")
            return None
        return GitHubClient(access_token)

    def get_commits(
        self,
        user_id: str,
        owner: str,
        repo: str,
        sha: Optional[str] = None,
        path: Optional[str] = None,
        per_page: int = 30,
        page: int = 1,
        use_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Get commit history for a repository.

        Args:
            user_id: User ID.
            owner: Repository owner.
            repo: Repository name.
            sha: SHA or branch to start from.
            path: Filter commits by file path.
            per_page: Items per page.
            page: Page number.
            use_cache: Whether to use cached commits.

        Returns:
            Dict with commits list and pagination info.
        """
        client = self._get_client(user_id)
        if not client:
            return {"error": "Not authenticated", "commits": []}

        try:
            commits = client.get_commits(
                owner=owner,
                repo=repo,
                sha=sha,
                path=path,
                per_page=per_page,
                page=page
            )

            # Cache commits for future use
            repo_info = client.get_repo(owner, repo)
            if repo_info:
                repo_id = repo_info["id"]
                for commit in commits:
                    try:
                        committed_at = datetime.fromisoformat(
                            commit["committer"]["date"].replace("Z", "+00:00")
                        ) if commit["committer"]["date"] else None

                        save_cached_commit(
                            repo_id=repo_id,
                            commit_sha=commit["sha"],
                            commit_message=commit["message"],
                            author_name=commit["author"]["name"],
                            author_email=commit["author"]["email"],
                            committed_at=committed_at,
                            parent_sha=commit["parents"][0]["sha"] if commit["parents"] else None
                        )
                    except Exception as e:
                        logging.debug(f"Failed to cache commit {commit['sha']}: {e}")

            return {
                "commits": commits,
                "owner": owner,
                "repo": repo,
                "path": path,
                "page": page,
                "per_page": per_page,
            }
        finally:
            client.close()

    def get_commit(
        self,
        user_id: str,
        owner: str,
        repo: str,
        sha: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get a single commit with full details.

        Args:
            user_id: User ID.
            owner: Repository owner.
            repo: Repository name.
            sha: Commit SHA.

        Returns:
            Commit details or None.
        """
        client = self._get_client(user_id)
        if not client:
            return None

        try:
            return client.get_commit(owner, repo, sha)
        finally:
            client.close()

    def compare_commits(
        self,
        user_id: str,
        owner: str,
        repo: str,
        base: str,
        head: str
    ) -> Optional[Dict[str, Any]]:
        """
        Compare two commits/branches.

        Args:
            user_id: User ID.
            owner: Repository owner.
            repo: Repository name.
            base: Base ref (SHA, branch, or tag).
            head: Head ref (SHA, branch, or tag).

        Returns:
            Comparison result with diff.
        """
        client = self._get_client(user_id)
        if not client:
            return None

        try:
            return client.compare_commits(owner, repo, base, head)
        finally:
            client.close()

    def get_file_at_commit(
        self,
        user_id: str,
        owner: str,
        repo: str,
        path: str,
        sha: str,
        use_cache: bool = True
    ) -> Optional[Dict[str, Any]]:
        """
        Get file content at a specific commit.

        Args:
            user_id: User ID.
            owner: Repository owner.
            repo: Repository name.
            path: File path.
            sha: Commit SHA.
            use_cache: Whether to use cached file versions.

        Returns:
            File content dict or None.
        """
        client = self._get_client(user_id)
        if not client:
            return None

        try:
            # Check cache first
            if use_cache:
                repo_info = client.get_repo(owner, repo)
                if repo_info:
                    cached = get_file_version(repo_info["id"], path, sha)
                    if cached:
                        return {
                            "path": path,
                            "sha": sha,
                            "content": cached["content"],
                            "cached": True,
                        }

            # Fetch from GitHub
            file_content = client.get_file_content(owner, repo, path, ref=sha)
            if not file_content:
                return None

            # Cache the file version
            repo_info = client.get_repo(owner, repo)
            if repo_info:
                save_file_version(
                    repo_id=repo_info["id"],
                    file_path=path,
                    commit_sha=sha,
                    content=file_content["content"],
                )

            return {
                "path": path,
                "sha": sha,
                "content": file_content["content"],
                "html_url": file_content.get("html_url"),
                "cached": False,
            }
        finally:
            client.close()

    def get_file_diff(
        self,
        user_id: str,
        owner: str,
        repo: str,
        path: str,
        base_sha: str,
        head_sha: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get diff for a specific file between two commits.

        Args:
            user_id: User ID.
            owner: Repository owner.
            repo: Repository name.
            path: File path.
            base_sha: Base commit SHA.
            head_sha: Head commit SHA.

        Returns:
            Dict with base content, head content, and computed diff.
        """
        # Get both file versions
        base_file = self.get_file_at_commit(user_id, owner, repo, path, base_sha)
        head_file = self.get_file_at_commit(user_id, owner, repo, path, head_sha)

        if not base_file and not head_file:
            return None

        # Handle new file (no base)
        base_content = base_file["content"] if base_file else ""
        # Handle deleted file (no head)
        head_content = head_file["content"] if head_file else ""

        # Compute line-by-line diff
        diff_lines = self._compute_diff(base_content, head_content)

        return {
            "path": path,
            "base_sha": base_sha,
            "head_sha": head_sha,
            "base_content": base_content,
            "head_content": head_content,
            "diff": diff_lines,
            "is_new": base_file is None,
            "is_deleted": head_file is None,
        }

    def _compute_diff(self, base: str, head: str) -> List[Dict[str, Any]]:
        """
        Compute a simple line-by-line diff.

        Returns list of {type, line_number, content} dicts.
        Type is 'added', 'removed', 'unchanged', or 'context'.
        """
        import difflib

        base_lines = base.splitlines(keepends=True)
        head_lines = head.splitlines(keepends=True)

        differ = difflib.unified_diff(
            base_lines,
            head_lines,
            lineterm=""
        )

        result = []
        base_line = 0
        head_line = 0

        for line in differ:
            if line.startswith("---") or line.startswith("+++"):
                continue
            elif line.startswith("@@"):
                # Parse hunk header
                import re
                match = re.match(r"@@ -(\d+),?\d* \+(\d+),?\d* @@", line)
                if match:
                    base_line = int(match.group(1)) - 1
                    head_line = int(match.group(2)) - 1
                result.append({
                    "type": "hunk",
                    "content": line.rstrip(),
                })
            elif line.startswith("-"):
                base_line += 1
                result.append({
                    "type": "removed",
                    "base_line": base_line,
                    "content": line[1:].rstrip(),
                })
            elif line.startswith("+"):
                head_line += 1
                result.append({
                    "type": "added",
                    "head_line": head_line,
                    "content": line[1:].rstrip(),
                })
            else:
                base_line += 1
                head_line += 1
                result.append({
                    "type": "context",
                    "base_line": base_line,
                    "head_line": head_line,
                    "content": line[1:].rstrip() if line.startswith(" ") else line.rstrip(),
                })

        return result
