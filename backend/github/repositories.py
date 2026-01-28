"""
Repository browsing service.
"""

import logging
from typing import Optional, List, Dict, Any

from .client import GitHubClient
from .oauth import OAuthHandler


class RepositoryService:
    """Service for browsing and managing GitHub repositories."""

    def __init__(self, oauth_handler: OAuthHandler):
        """
        Initialize repository service.

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

    def list_repos(
        self,
        user_id: str,
        visibility: str = "all",
        sort: str = "updated",
        per_page: int = 30,
        page: int = 1
    ) -> Dict[str, Any]:
        """
        List repositories for a user.

        Args:
            user_id: User ID.
            visibility: 'all', 'public', or 'private'.
            sort: Sort order.
            per_page: Items per page.
            page: Page number.

        Returns:
            Dict with repos list and pagination info.
        """
        client = self._get_client(user_id)
        if not client:
            return {"error": "Not authenticated", "repos": []}

        try:
            repos = client.list_repos(
                visibility=visibility,
                sort=sort,
                per_page=per_page,
                page=page
            )
            return {
                "repos": repos,
                "page": page,
                "per_page": per_page,
            }
        finally:
            client.close()

    def search_repos(
        self,
        user_id: str,
        query: str,
        per_page: int = 30,
        page: int = 1
    ) -> Dict[str, Any]:
        """
        Search repositories.

        Args:
            user_id: User ID.
            query: Search query.
            per_page: Items per page.
            page: Page number.

        Returns:
            Dict with search results.
        """
        client = self._get_client(user_id)
        if not client:
            return {"error": "Not authenticated", "repos": []}

        try:
            repos = client.search_repos(query=query, per_page=per_page, page=page)
            return {
                "repos": repos,
                "query": query,
                "page": page,
                "per_page": per_page,
            }
        finally:
            client.close()

    def get_repo(self, user_id: str, owner: str, repo: str) -> Optional[Dict[str, Any]]:
        """
        Get repository details.

        Args:
            user_id: User ID.
            owner: Repository owner.
            repo: Repository name.

        Returns:
            Repository details or None.
        """
        client = self._get_client(user_id)
        if not client:
            return None

        try:
            return client.get_repo(owner, repo)
        finally:
            client.close()

    def get_contents(
        self,
        user_id: str,
        owner: str,
        repo: str,
        path: str = "",
        ref: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get repository contents (file tree).

        Args:
            user_id: User ID.
            owner: Repository owner.
            repo: Repository name.
            path: Path within repo.
            ref: Git ref (branch/tag/commit).

        Returns:
            Dict with contents and path info.
        """
        client = self._get_client(user_id)
        if not client:
            return {"error": "Not authenticated", "contents": []}

        try:
            contents = client.get_repo_contents(owner, repo, path, ref)

            # Sort: directories first, then files, alphabetically
            dirs = sorted([c for c in contents if c["type"] == "dir"], key=lambda x: x["name"].lower())
            files = sorted([c for c in contents if c["type"] != "dir"], key=lambda x: x["name"].lower())

            return {
                "contents": dirs + files,
                "path": path,
                "ref": ref,
                "owner": owner,
                "repo": repo,
            }
        finally:
            client.close()

    def get_file(
        self,
        user_id: str,
        owner: str,
        repo: str,
        path: str,
        ref: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Get file content.

        Args:
            user_id: User ID.
            owner: Repository owner.
            repo: Repository name.
            path: File path.
            ref: Git ref (branch/tag/commit).

        Returns:
            File content dict or None.
        """
        client = self._get_client(user_id)
        if not client:
            return None

        try:
            return client.get_file_content(owner, repo, path, ref)
        finally:
            client.close()

    def get_branches(
        self,
        user_id: str,
        owner: str,
        repo: str
    ) -> List[Dict[str, Any]]:
        """
        Get repository branches.

        Args:
            user_id: User ID.
            owner: Repository owner.
            repo: Repository name.

        Returns:
            List of branches.
        """
        client = self._get_client(user_id)
        if not client:
            return []

        try:
            return client.get_branches(owner, repo)
        finally:
            client.close()

    def get_user_info(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Get authenticated user info.

        Args:
            user_id: User ID.

        Returns:
            User info dict or None.
        """
        client = self._get_client(user_id)
        if not client:
            return None

        try:
            return client.get_user()
        finally:
            client.close()
