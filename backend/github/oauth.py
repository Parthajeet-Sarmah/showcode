"""
GitHub OAuth 2.0 authentication flow.
"""

import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from urllib.parse import urlencode
import httpx

from backend.database import (
    save_oauth_state,
    get_oauth_state,
    delete_oauth_state,
    cleanup_expired_oauth_states,
    save_github_token,
    get_github_token,
    delete_github_token,
)
from .tokens import TokenManager


class OAuthHandler:
    """Handles GitHub OAuth 2.0 authentication flow."""

    AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
    TOKEN_URL = "https://github.com/login/oauth/access_token"
    USER_API_URL = "https://api.github.com/user"

    # OAuth scopes for the application
    DEFAULT_SCOPES = [
        "read:user",       # Read user profile
        "user:email",      # Read user email
        "repo",            # Full repo access (for private repos)
        "admin:repo_hook", # Create/delete webhooks
    ]

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        token_manager: TokenManager,
    ):
        """
        Initialize OAuth handler.

        Args:
            client_id: GitHub OAuth App client ID.
            client_secret: GitHub OAuth App client secret.
            redirect_uri: Callback URL for OAuth redirect.
            token_manager: TokenManager instance for encrypting tokens.
        """
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.token_manager = token_manager

    def get_authorization_url(self, redirect_after: str = "/") -> str:
        """
        Generate GitHub OAuth authorization URL.

        Args:
            redirect_after: URL to redirect to after successful auth.

        Returns:
            GitHub authorization URL with state parameter.
        """
        # Clean up expired states
        cleanup_expired_oauth_states()

        # Generate cryptographically secure state
        state = secrets.token_urlsafe(32)
        expires_at = datetime.utcnow() + timedelta(minutes=10)

        # Save state for CSRF verification
        save_oauth_state(state, redirect_after, expires_at)

        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(self.DEFAULT_SCOPES),
            "state": state,
            "allow_signup": "true",
        }

        return f"{self.AUTHORIZE_URL}?{urlencode(params)}"

    async def handle_callback(
        self,
        code: str,
        state: str
    ) -> Optional[Dict[str, Any]]:
        """
        Handle OAuth callback and exchange code for token.

        Args:
            code: Authorization code from GitHub.
            state: State parameter for CSRF verification.

        Returns:
            Dict with user info and redirect_uri, or None if failed.
        """
        # Verify state (CSRF protection)
        state_data = get_oauth_state(state)
        if not state_data:
            logging.error("Invalid or expired OAuth state")
            return None

        # Check expiration
        expires_at = datetime.fromisoformat(state_data["expires_at"])
        if datetime.utcnow() > expires_at:
            logging.error("OAuth state has expired")
            delete_oauth_state(state)
            return None

        redirect_after = state_data.get("redirect_uri", "/")

        # Clean up used state
        delete_oauth_state(state)

        # Exchange code for token
        token_data = await self._exchange_code(code)
        if not token_data:
            return None

        access_token = token_data.get("access_token")
        if not access_token:
            logging.error("No access token in response")
            return None

        # Get user info
        user_info = await self._get_user_info(access_token)
        if not user_info:
            return None

        user_id = str(user_info["id"])

        # Encrypt and save token
        encrypted_token = self.token_manager.encrypt(access_token)
        if not encrypted_token:
            logging.error("Failed to encrypt access token")
            return None

        # Handle refresh token if present (GitHub doesn't always provide one)
        encrypted_refresh = None
        if token_data.get("refresh_token"):
            encrypted_refresh = self.token_manager.encrypt(token_data["refresh_token"])

        # Calculate expiration if provided
        expires_at = None
        if token_data.get("expires_in"):
            expires_at = datetime.utcnow() + timedelta(seconds=token_data["expires_in"])

        save_github_token(
            user_id=user_id,
            encrypted_access_token=encrypted_token,
            encrypted_refresh_token=encrypted_refresh,
            token_type=token_data.get("token_type", "bearer"),
            scope=token_data.get("scope"),
            expires_at=expires_at,
        )

        return {
            "user": user_info,
            "redirect_uri": redirect_after,
        }

    async def _exchange_code(self, code: str) -> Optional[Dict[str, Any]]:
        """Exchange authorization code for access token."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.TOKEN_URL,
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "code": code,
                        "redirect_uri": self.redirect_uri,
                    },
                    headers={"Accept": "application/json"},
                )
                response.raise_for_status()
                data = response.json()

                if "error" in data:
                    logging.error(f"OAuth token error: {data.get('error_description', data['error'])}")
                    return None

                return data
        except httpx.HTTPError as e:
            logging.error(f"Failed to exchange code for token: {e}")
            return None

    async def _get_user_info(self, access_token: str) -> Optional[Dict[str, Any]]:
        """Fetch user info from GitHub API."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    self.USER_API_URL,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/vnd.github+json",
                    },
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as e:
            logging.error(f"Failed to get user info: {e}")
            return None

    async def refresh_token(self, user_id: str) -> bool:
        """
        Refresh an expired access token.

        Note: GitHub OAuth tokens don't typically expire unless you're using
        GitHub Apps with user-to-server tokens. This is here for future compatibility.

        Args:
            user_id: User ID to refresh token for.

        Returns:
            True if refresh successful, False otherwise.
        """
        token_data = get_github_token(user_id)
        if not token_data or not token_data.get("encrypted_refresh_token"):
            logging.error(f"No refresh token available for user {user_id}")
            return False

        refresh_token = self.token_manager.decrypt(token_data["encrypted_refresh_token"])
        if not refresh_token:
            return False

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.TOKEN_URL,
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "grant_type": "refresh_token",
                        "refresh_token": refresh_token,
                    },
                    headers={"Accept": "application/json"},
                )
                response.raise_for_status()
                data = response.json()

                if "error" in data:
                    logging.error(f"Token refresh error: {data.get('error_description')}")
                    return False

                # Encrypt and save new tokens
                encrypted_access = self.token_manager.encrypt(data["access_token"])
                encrypted_refresh = None
                if data.get("refresh_token"):
                    encrypted_refresh = self.token_manager.encrypt(data["refresh_token"])

                expires_at = None
                if data.get("expires_in"):
                    expires_at = datetime.utcnow() + timedelta(seconds=data["expires_in"])

                save_github_token(
                    user_id=user_id,
                    encrypted_access_token=encrypted_access,
                    encrypted_refresh_token=encrypted_refresh or token_data["encrypted_refresh_token"],
                    token_type=data.get("token_type", "bearer"),
                    scope=data.get("scope"),
                    expires_at=expires_at,
                )

                return True
        except httpx.HTTPError as e:
            logging.error(f"Failed to refresh token: {e}")
            return False

    def revoke_token(self, user_id: str) -> bool:
        """
        Revoke a user's GitHub token and remove from database.

        Args:
            user_id: User ID to revoke token for.

        Returns:
            True if revocation successful, False otherwise.
        """
        # Note: GitHub doesn't have a standard token revocation endpoint
        # for OAuth apps. Users must manually revoke via GitHub settings.
        # We just delete from our database.
        return delete_github_token(user_id)

    def get_access_token(self, user_id: str) -> Optional[str]:
        """
        Get decrypted access token for a user.

        Args:
            user_id: User ID to get token for.

        Returns:
            Decrypted access token, or None if not found.
        """
        token_data = get_github_token(user_id)
        if not token_data:
            return None

        return self.token_manager.decrypt(token_data["encrypted_access_token"])

    def check_auth_status(self, user_id: str) -> Dict[str, Any]:
        """
        Check authentication status for a user.

        Args:
            user_id: User ID to check.

        Returns:
            Dict with authenticated status and optional user info.
        """
        token_data = get_github_token(user_id)
        if not token_data:
            return {"authenticated": False}

        # Check expiration if set
        if token_data.get("expires_at"):
            expires_at = datetime.fromisoformat(token_data["expires_at"])
            if datetime.utcnow() > expires_at:
                return {"authenticated": False, "expired": True}

        return {
            "authenticated": True,
            "scope": token_data.get("scope"),
            "created_at": token_data.get("created_at"),
        }
