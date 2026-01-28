"""
GitHub REST API client wrapper.
"""

import logging
from typing import Optional, List, Dict, Any
import httpx
from github import Github, Auth
from github.GithubException import GithubException


class GitHubClient:
    """Wrapper around GitHub REST API using PyGithub and httpx."""

    API_BASE = "https://api.github.com"

    def __init__(self, access_token: str):
        """
        Initialize GitHub client with an access token.

        Args:
            access_token: GitHub OAuth access token.
        """
        self._token = access_token
        self._auth = Auth.Token(access_token)
        self._github = Github(auth=self._auth)
        self._headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }

    def get_user(self) -> Optional[Dict[str, Any]]:
        """Get authenticated user info."""
        try:
            user = self._github.get_user()
            return {
                "id": user.id,
                "login": user.login,
                "name": user.name,
                "email": user.email,
                "avatar_url": user.avatar_url,
                "html_url": user.html_url,
            }
        except GithubException as e:
            logging.error(f"Failed to get user: {e}")
            return None

    def list_repos(
        self,
        visibility: str = "all",
        sort: str = "updated",
        per_page: int = 30,
        page: int = 1
    ) -> List[Dict[str, Any]]:
        """
        List repositories for the authenticated user.

        Args:
            visibility: 'all', 'public', or 'private'
            sort: 'created', 'updated', 'pushed', or 'full_name'
            per_page: Number of results per page (max 100)
            page: Page number

        Returns:
            List of repository dictionaries.
        """
        try:
            user = self._github.get_user()
            repos = user.get_repos(visibility=visibility, sort=sort)

            # Manual pagination
            start = (page - 1) * per_page
            result = []
            for i, repo in enumerate(repos):
                if i < start:
                    continue
                if i >= start + per_page:
                    break
                result.append(self._repo_to_dict(repo))
            return result
        except GithubException as e:
            logging.error(f"Failed to list repos: {e}")
            return []

    def search_repos(
        self,
        query: str,
        per_page: int = 30,
        page: int = 1
    ) -> List[Dict[str, Any]]:
        """
        Search repositories accessible to the user.

        Args:
            query: Search query string.
            per_page: Number of results per page.
            page: Page number.

        Returns:
            List of repository dictionaries.
        """
        try:
            # Search user's repos that match the query
            user = self._github.get_user()
            query_with_user = f"{query} user:{user.login}"
            repos = self._github.search_repositories(query_with_user)

            start = (page - 1) * per_page
            result = []
            for i, repo in enumerate(repos):
                if i < start:
                    continue
                if i >= start + per_page:
                    break
                result.append(self._repo_to_dict(repo))
            return result
        except GithubException as e:
            logging.error(f"Failed to search repos: {e}")
            return []

    def get_repo(self, owner: str, repo: str) -> Optional[Dict[str, Any]]:
        """Get repository details."""
        try:
            repository = self._github.get_repo(f"{owner}/{repo}")
            return self._repo_to_dict(repository)
        except GithubException as e:
            logging.error(f"Failed to get repo {owner}/{repo}: {e}")
            return None

    def get_repo_contents(
        self,
        owner: str,
        repo: str,
        path: str = "",
        ref: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Get repository contents at a path.

        Args:
            owner: Repository owner.
            repo: Repository name.
            path: Path within the repository (default: root).
            ref: Git ref (branch, tag, or commit SHA).

        Returns:
            List of content items (files and directories).
        """
        try:
            repository = self._github.get_repo(f"{owner}/{repo}")
            contents = repository.get_contents(path, ref=ref)

            if not isinstance(contents, list):
                contents = [contents]

            return [self._content_to_dict(c) for c in contents]
        except GithubException as e:
            logging.error(f"Failed to get contents for {owner}/{repo}/{path}: {e}")
            return []

    def get_file_content(
        self,
        owner: str,
        repo: str,
        path: str,
        ref: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Get file content with decoded content.

        Args:
            owner: Repository owner.
            repo: Repository name.
            path: File path.
            ref: Git ref (branch, tag, or commit SHA).

        Returns:
            File content dictionary with decoded content.
        """
        try:
            repository = self._github.get_repo(f"{owner}/{repo}")
            content = repository.get_contents(path, ref=ref)

            if isinstance(content, list):
                return None  # Path is a directory

            return {
                "name": content.name,
                "path": content.path,
                "sha": content.sha,
                "size": content.size,
                "type": "file",
                "encoding": content.encoding,
                "content": content.decoded_content.decode("utf-8") if content.content else "",
                "download_url": content.download_url,
                "html_url": content.html_url,
            }
        except GithubException as e:
            logging.error(f"Failed to get file content for {owner}/{repo}/{path}: {e}")
            return None

    def get_branches(self, owner: str, repo: str) -> List[Dict[str, Any]]:
        """Get repository branches."""
        try:
            repository = self._github.get_repo(f"{owner}/{repo}")
            branches = repository.get_branches()
            return [
                {
                    "name": b.name,
                    "sha": b.commit.sha,
                    "protected": b.protected,
                }
                for b in branches
            ]
        except GithubException as e:
            logging.error(f"Failed to get branches for {owner}/{repo}: {e}")
            return []

    def get_commits(
        self,
        owner: str,
        repo: str,
        sha: Optional[str] = None,
        path: Optional[str] = None,
        per_page: int = 30,
        page: int = 1
    ) -> List[Dict[str, Any]]:
        """
        Get commit history.

        Args:
            owner: Repository owner.
            repo: Repository name.
            sha: SHA or branch to start listing from.
            path: Only commits containing this file path.
            per_page: Number of results per page.
            page: Page number.

        Returns:
            List of commit dictionaries.
        """
        try:
            repository = self._github.get_repo(f"{owner}/{repo}")
            kwargs = {}
            if sha:
                kwargs["sha"] = sha
            if path:
                kwargs["path"] = path

            commits = repository.get_commits(**kwargs)

            start = (page - 1) * per_page
            result = []
            for i, commit in enumerate(commits):
                if i < start:
                    continue
                if i >= start + per_page:
                    break
                result.append(self._commit_to_dict(commit))
            return result
        except GithubException as e:
            logging.error(f"Failed to get commits for {owner}/{repo}: {e}")
            return []

    def get_commit(self, owner: str, repo: str, sha: str) -> Optional[Dict[str, Any]]:
        """Get a single commit with full details."""
        try:
            repository = self._github.get_repo(f"{owner}/{repo}")
            commit = repository.get_commit(sha)
            return self._commit_to_dict(commit, include_files=True)
        except GithubException as e:
            logging.error(f"Failed to get commit {sha} for {owner}/{repo}: {e}")
            return None

    def compare_commits(
        self,
        owner: str,
        repo: str,
        base: str,
        head: str
    ) -> Optional[Dict[str, Any]]:
        """
        Compare two commits.

        Args:
            owner: Repository owner.
            repo: Repository name.
            base: Base commit SHA or branch.
            head: Head commit SHA or branch.

        Returns:
            Comparison result with files changed and diff.
        """
        try:
            repository = self._github.get_repo(f"{owner}/{repo}")
            comparison = repository.compare(base, head)
            return {
                "status": comparison.status,
                "ahead_by": comparison.ahead_by,
                "behind_by": comparison.behind_by,
                "total_commits": comparison.total_commits,
                "commits": [self._commit_to_dict(c) for c in comparison.commits],
                "files": [
                    {
                        "filename": f.filename,
                        "status": f.status,
                        "additions": f.additions,
                        "deletions": f.deletions,
                        "changes": f.changes,
                        "patch": f.patch,
                    }
                    for f in comparison.files
                ] if comparison.files else [],
                "html_url": comparison.html_url,
                "diff_url": comparison.diff_url,
            }
        except GithubException as e:
            logging.error(f"Failed to compare {base}...{head} for {owner}/{repo}: {e}")
            return None

    def create_webhook(
        self,
        owner: str,
        repo: str,
        webhook_url: str,
        secret: str,
        events: List[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Create a webhook for a repository.

        Args:
            owner: Repository owner.
            repo: Repository name.
            webhook_url: URL to receive webhook payloads.
            secret: Secret for HMAC signature verification.
            events: List of events to subscribe to (default: ["push"]).

        Returns:
            Created webhook details.
        """
        if events is None:
            events = ["push"]

        try:
            repository = self._github.get_repo(f"{owner}/{repo}")
            hook = repository.create_hook(
                name="web",
                config={
                    "url": webhook_url,
                    "content_type": "json",
                    "secret": secret,
                    "insecure_ssl": "0",
                },
                events=events,
                active=True,
            )
            return {
                "id": hook.id,
                "url": hook.url,
                "events": hook.events,
                "active": hook.active,
            }
        except GithubException as e:
            logging.error(f"Failed to create webhook for {owner}/{repo}: {e}")
            return None

    def delete_webhook(self, owner: str, repo: str, hook_id: int) -> bool:
        """Delete a webhook from a repository."""
        try:
            repository = self._github.get_repo(f"{owner}/{repo}")
            hook = repository.get_hook(hook_id)
            hook.delete()
            return True
        except GithubException as e:
            logging.error(f"Failed to delete webhook {hook_id} for {owner}/{repo}: {e}")
            return False

    def _repo_to_dict(self, repo) -> Dict[str, Any]:
        """Convert PyGithub Repository object to dictionary."""
        return {
            "id": repo.id,
            "name": repo.name,
            "full_name": repo.full_name,
            "description": repo.description,
            "private": repo.private,
            "fork": repo.fork,
            "html_url": repo.html_url,
            "clone_url": repo.clone_url,
            "default_branch": repo.default_branch,
            "language": repo.language,
            "stargazers_count": repo.stargazers_count,
            "forks_count": repo.forks_count,
            "updated_at": repo.updated_at.isoformat() if repo.updated_at else None,
            "pushed_at": repo.pushed_at.isoformat() if repo.pushed_at else None,
        }

    def _content_to_dict(self, content) -> Dict[str, Any]:
        """Convert PyGithub ContentFile object to dictionary."""
        return {
            "name": content.name,
            "path": content.path,
            "sha": content.sha,
            "size": content.size,
            "type": content.type,  # 'file', 'dir', 'symlink', 'submodule'
            "download_url": content.download_url,
            "html_url": content.html_url,
        }

    def _commit_to_dict(self, commit, include_files: bool = False) -> Dict[str, Any]:
        """Convert PyGithub Commit object to dictionary."""
        result = {
            "sha": commit.sha,
            "message": commit.commit.message,
            "author": {
                "name": commit.commit.author.name,
                "email": commit.commit.author.email,
                "date": commit.commit.author.date.isoformat() if commit.commit.author.date else None,
            },
            "committer": {
                "name": commit.commit.committer.name,
                "email": commit.commit.committer.email,
                "date": commit.commit.committer.date.isoformat() if commit.commit.committer.date else None,
            },
            "html_url": commit.html_url,
            "parents": [{"sha": p.sha} for p in commit.parents] if commit.parents else [],
        }

        if include_files and commit.files:
            result["files"] = [
                {
                    "filename": f.filename,
                    "status": f.status,
                    "additions": f.additions,
                    "deletions": f.deletions,
                    "changes": f.changes,
                    "patch": f.patch,
                }
                for f in commit.files
            ]
            result["stats"] = {
                "additions": commit.stats.additions,
                "deletions": commit.stats.deletions,
                "total": commit.stats.total,
            }

        return result

    def close(self):
        """Close the GitHub client connection."""
        self._github.close()
