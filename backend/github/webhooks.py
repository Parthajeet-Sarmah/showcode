"""
GitHub webhook handler with HMAC signature verification.
"""

import hmac
import hashlib
import json
import logging
import secrets
from typing import Optional, Dict, Any, Callable

from backend.database import (
    save_webhook_event,
    mark_webhook_event_processed,
    get_tracked_repo,
    update_tracked_repo_sync,
    save_tracked_repo,
    delete_tracked_repo,
)
from .client import GitHubClient
from .oauth import OAuthHandler


class WebhookHandler:
    """Handles GitHub webhook events with signature verification."""

    def __init__(self, webhook_secret: str, oauth_handler: OAuthHandler):
        """
        Initialize webhook handler.

        Args:
            webhook_secret: Secret for HMAC signature verification.
            oauth_handler: OAuthHandler for getting access tokens.
        """
        self.webhook_secret = webhook_secret
        self.oauth_handler = oauth_handler
        self._event_handlers: Dict[str, Callable] = {
            "push": self._handle_push,
            "ping": self._handle_ping,
            "repository": self._handle_repository,
        }

    def verify_signature(self, payload: bytes, signature: str) -> bool:
        """
        Verify GitHub webhook HMAC-SHA256 signature.

        Args:
            payload: Raw request body bytes.
            signature: X-Hub-Signature-256 header value.

        Returns:
            True if signature is valid, False otherwise.
        """
        if not signature or not signature.startswith("sha256="):
            logging.error("Invalid signature format")
            return False

        expected_signature = signature[7:]  # Remove "sha256=" prefix

        computed = hmac.new(
            self.webhook_secret.encode(),
            payload,
            hashlib.sha256
        ).hexdigest()

        return hmac.compare_digest(computed, expected_signature)

    async def handle_event(
        self,
        event_type: str,
        payload: Dict[str, Any],
        repo_full_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process a webhook event.

        Args:
            event_type: GitHub event type (e.g., 'push', 'ping').
            payload: Parsed JSON payload.
            repo_full_name: Repository full name (owner/repo).

        Returns:
            Processing result dict.
        """
        # Get repo info from payload if not provided
        if not repo_full_name and "repository" in payload:
            repo_full_name = payload["repository"].get("full_name")

        if not repo_full_name:
            return {"error": "Could not determine repository"}

        # Find tracked repo to get repo_id
        # Note: We need to find which user tracked this repo
        # For now, we'll just log the event
        repo_id = payload.get("repository", {}).get("id", 0)

        # Save event to database
        event_id = save_webhook_event(
            repo_id=repo_id,
            event_type=event_type,
            payload=json.dumps(payload)
        )

        # Process event
        handler = self._event_handlers.get(event_type, self._handle_unknown)
        result = await handler(payload, repo_full_name)

        # Mark as processed
        if event_id:
            mark_webhook_event_processed(event_id)

        return {
            "event_type": event_type,
            "repo": repo_full_name,
            "event_id": event_id,
            "result": result,
        }

    async def _handle_push(
        self,
        payload: Dict[str, Any],
        repo_full_name: str
    ) -> Dict[str, Any]:
        """Handle push event - update sync time and optionally refresh cache."""
        ref = payload.get("ref", "")
        commits = payload.get("commits", [])

        # Update last synced time
        update_tracked_repo_sync(repo_full_name)

        logging.info(f"Push event for {repo_full_name}: {len(commits)} commits to {ref}")

        return {
            "action": "push_received",
            "ref": ref,
            "commits_count": len(commits),
            "head_commit": payload.get("head_commit", {}).get("id"),
        }

    async def _handle_ping(
        self,
        payload: Dict[str, Any],
        repo_full_name: str
    ) -> Dict[str, Any]:
        """Handle ping event - webhook verification."""
        zen = payload.get("zen", "")
        hook_id = payload.get("hook_id")

        logging.info(f"Ping received for {repo_full_name}: {zen}")

        return {
            "action": "pong",
            "zen": zen,
            "hook_id": hook_id,
        }

    async def _handle_repository(
        self,
        payload: Dict[str, Any],
        repo_full_name: str
    ) -> Dict[str, Any]:
        """Handle repository event - track renames, deletions, etc."""
        action = payload.get("action")

        if action == "deleted":
            logging.info(f"Repository {repo_full_name} was deleted")
            # Could notify users or clean up data here

        elif action == "renamed":
            old_name = payload.get("changes", {}).get("repository", {}).get("name", {}).get("from")
            logging.info(f"Repository renamed from {old_name} to {repo_full_name}")

        return {
            "action": action,
            "repo": repo_full_name,
        }

    async def _handle_unknown(
        self,
        payload: Dict[str, Any],
        repo_full_name: str
    ) -> Dict[str, Any]:
        """Handle unknown event types."""
        return {"action": "ignored"}


class TrackingService:
    """Service for managing repository tracking and webhooks."""

    def __init__(
        self,
        oauth_handler: OAuthHandler,
        webhook_url: str
    ):
        """
        Initialize tracking service.

        Args:
            oauth_handler: OAuthHandler for getting access tokens.
            webhook_url: URL where webhooks will be received.
        """
        self.oauth_handler = oauth_handler
        self.webhook_url = webhook_url

    def _get_client(self, user_id: str) -> Optional[GitHubClient]:
        """Get GitHub client for a user."""
        access_token = self.oauth_handler.get_access_token(user_id)
        if not access_token:
            return None
        return GitHubClient(access_token)

    def start_tracking(
        self,
        user_id: str,
        owner: str,
        repo: str,
        events: list = None
    ) -> Dict[str, Any]:
        """
        Start tracking a repository by creating a webhook.

        Args:
            user_id: User ID.
            owner: Repository owner.
            repo: Repository name.
            events: List of events to track (default: ["push"]).

        Returns:
            Result dict with tracking info.
        """
        if events is None:
            events = ["push"]

        repo_full_name = f"{owner}/{repo}"

        # Check if already tracking
        existing = get_tracked_repo(user_id, repo_full_name)
        if existing:
            return {
                "success": True,
                "message": "Already tracking this repository",
                "tracked": True,
                "webhook_id": existing.get("webhook_id"),
            }

        client = self._get_client(user_id)
        if not client:
            return {"success": False, "error": "Not authenticated"}

        try:
            # Get repo info
            repo_info = client.get_repo(owner, repo)
            if not repo_info:
                return {"success": False, "error": "Repository not found"}

            # Generate webhook secret
            webhook_secret = secrets.token_hex(32)

            # Create webhook
            webhook = client.create_webhook(
                owner=owner,
                repo=repo,
                webhook_url=self.webhook_url,
                secret=webhook_secret,
                events=events
            )

            if not webhook:
                return {"success": False, "error": "Failed to create webhook"}

            # Save tracking info
            save_tracked_repo(
                user_id=user_id,
                repo_full_name=repo_full_name,
                repo_id=repo_info["id"],
                default_branch=repo_info.get("default_branch"),
                webhook_id=webhook["id"],
                webhook_secret=webhook_secret,
            )

            return {
                "success": True,
                "message": f"Now tracking {repo_full_name}",
                "webhook_id": webhook["id"],
                "events": events,
            }
        finally:
            client.close()

    def stop_tracking(
        self,
        user_id: str,
        owner: str,
        repo: str
    ) -> Dict[str, Any]:
        """
        Stop tracking a repository by removing the webhook.

        Args:
            user_id: User ID.
            owner: Repository owner.
            repo: Repository name.

        Returns:
            Result dict.
        """
        repo_full_name = f"{owner}/{repo}"

        # Get tracking info
        tracked = get_tracked_repo(user_id, repo_full_name)
        if not tracked:
            return {
                "success": True,
                "message": "Not tracking this repository",
            }

        client = self._get_client(user_id)
        if not client:
            return {"success": False, "error": "Not authenticated"}

        try:
            # Delete webhook if exists
            if tracked.get("webhook_id"):
                client.delete_webhook(owner, repo, tracked["webhook_id"])

            # Remove from database
            delete_tracked_repo(user_id, repo_full_name)

            return {
                "success": True,
                "message": f"Stopped tracking {repo_full_name}",
            }
        finally:
            client.close()

    def list_tracked(self, user_id: str) -> list:
        """
        List all tracked repositories for a user.

        Args:
            user_id: User ID.

        Returns:
            List of tracked repository dicts.
        """
        from backend.database import get_tracked_repos
        return get_tracked_repos(user_id)
