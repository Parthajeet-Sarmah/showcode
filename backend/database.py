import sqlite3
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any

DB_NAME = ".alignments.db"


def get_connection():
    """Get a database connection with row factory for dict-like access."""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()

        # Original alignments table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS alignments (
                signature TEXT PRIMARY KEY,
                alignment_text TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Encrypted GitHub tokens
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS github_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT UNIQUE NOT NULL,
                encrypted_access_token TEXT NOT NULL,
                encrypted_refresh_token TEXT,
                token_type TEXT DEFAULT 'bearer',
                scope TEXT,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Tracked repositories
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tracked_repos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                repo_full_name TEXT NOT NULL,
                repo_id INTEGER,
                default_branch TEXT,
                webhook_id INTEGER,
                webhook_secret TEXT,
                last_synced_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, repo_full_name)
            )
        """)

        # Cached commit history
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS cached_commits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repo_id INTEGER NOT NULL,
                commit_sha TEXT NOT NULL,
                commit_message TEXT,
                author_name TEXT,
                author_email TEXT,
                committed_at DATETIME,
                parent_sha TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(repo_id, commit_sha)
            )
        """)

        # File version cache for diffs
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS file_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repo_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                commit_sha TEXT NOT NULL,
                content_hash TEXT,
                content TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(repo_id, file_path, commit_sha)
            )
        """)

        # Webhook event log
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS webhook_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repo_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT,
                processed INTEGER DEFAULT 0,
                processed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # OAuth state for CSRF protection
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS oauth_states (
                state TEXT PRIMARY KEY,
                redirect_uri TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL
            )
        """)

        # Create indexes for common queries
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tracked_repos_user ON tracked_repos(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cached_commits_repo ON cached_commits(repo_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_versions_repo ON file_versions(repo_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_webhook_events_repo ON webhook_events(repo_id)")

        conn.commit()
        conn.close()
    except Exception as e:
        logging.error(f"Failed to initialize database: {e}")

def save_alignment(signature: str, text: str):
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO alignments (signature, alignment_text, timestamp)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        """, (signature, text))
        conn.commit()
        conn.close()
    except Exception as e:
        logging.error(f"Failed to save alignment for {signature}: {e}")

def get_all_alignments():
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("SELECT signature, alignment_text FROM alignments")
        rows = cursor.fetchall()
        conn.close()
        return {row[0]: row[1] for row in rows}
    except Exception as e:
        logging.error(f"Failed to fetch alignments: {e}")
        return {}


# ============ GitHub Token Functions ============

def save_github_token(
    user_id: str,
    encrypted_access_token: str,
    encrypted_refresh_token: Optional[str] = None,
    token_type: str = "bearer",
    scope: Optional[str] = None,
    expires_at: Optional[datetime] = None
) -> bool:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO github_tokens
                (user_id, encrypted_access_token, encrypted_refresh_token, token_type, scope, expires_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
                encrypted_access_token = excluded.encrypted_access_token,
                encrypted_refresh_token = excluded.encrypted_refresh_token,
                token_type = excluded.token_type,
                scope = excluded.scope,
                expires_at = excluded.expires_at,
                updated_at = CURRENT_TIMESTAMP
        """, (user_id, encrypted_access_token, encrypted_refresh_token, token_type, scope, expires_at))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logging.error(f"Failed to save GitHub token for {user_id}: {e}")
        return False


def get_github_token(user_id: str) -> Optional[Dict[str, Any]]:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM github_tokens WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None
    except Exception as e:
        logging.error(f"Failed to get GitHub token for {user_id}: {e}")
        return None


def delete_github_token(user_id: str) -> bool:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM github_tokens WHERE user_id = ?", (user_id,))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logging.error(f"Failed to delete GitHub token for {user_id}: {e}")
        return False


# ============ OAuth State Functions ============

def save_oauth_state(state: str, redirect_uri: str, expires_at: datetime) -> bool:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO oauth_states (state, redirect_uri, expires_at)
            VALUES (?, ?, ?)
        """, (state, redirect_uri, expires_at))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logging.error(f"Failed to save OAuth state: {e}")
        return False


def get_oauth_state(state: str) -> Optional[Dict[str, Any]]:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM oauth_states WHERE state = ?", (state,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None
    except Exception as e:
        logging.error(f"Failed to get OAuth state: {e}")
        return None


def delete_oauth_state(state: str) -> bool:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM oauth_states WHERE state = ?", (state,))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logging.error(f"Failed to delete OAuth state: {e}")
        return False


def cleanup_expired_oauth_states() -> int:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM oauth_states WHERE expires_at < CURRENT_TIMESTAMP")
        deleted = cursor.rowcount
        conn.commit()
        conn.close()
        return deleted
    except Exception as e:
        logging.error(f"Failed to cleanup expired OAuth states: {e}")
        return 0


# ============ Tracked Repos Functions ============

def save_tracked_repo(
    user_id: str,
    repo_full_name: str,
    repo_id: Optional[int] = None,
    default_branch: Optional[str] = None,
    webhook_id: Optional[int] = None,
    webhook_secret: Optional[str] = None
) -> bool:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO tracked_repos
                (user_id, repo_full_name, repo_id, default_branch, webhook_id, webhook_secret)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
                repo_id = excluded.repo_id,
                default_branch = excluded.default_branch,
                webhook_id = excluded.webhook_id,
                webhook_secret = excluded.webhook_secret
        """, (user_id, repo_full_name, repo_id, default_branch, webhook_id, webhook_secret))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logging.error(f"Failed to save tracked repo {repo_full_name}: {e}")
        return False


def get_tracked_repos(user_id: str) -> List[Dict[str, Any]]:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tracked_repos WHERE user_id = ?", (user_id,))
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except Exception as e:
        logging.error(f"Failed to get tracked repos for {user_id}: {e}")
        return []


def get_tracked_repo(user_id: str, repo_full_name: str) -> Optional[Dict[str, Any]]:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM tracked_repos WHERE user_id = ? AND repo_full_name = ?",
            (user_id, repo_full_name)
        )
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None
    except Exception as e:
        logging.error(f"Failed to get tracked repo {repo_full_name}: {e}")
        return None


def delete_tracked_repo(user_id: str, repo_full_name: str) -> bool:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM tracked_repos WHERE user_id = ? AND repo_full_name = ?",
            (user_id, repo_full_name)
        )
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logging.error(f"Failed to delete tracked repo {repo_full_name}: {e}")
        return False


def update_tracked_repo_sync(repo_full_name: str) -> bool:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE tracked_repos SET last_synced_at = CURRENT_TIMESTAMP WHERE repo_full_name = ?",
            (repo_full_name,)
        )
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logging.error(f"Failed to update sync time for {repo_full_name}: {e}")
        return False


# ============ Cached Commits Functions ============

def save_cached_commit(
    repo_id: int,
    commit_sha: str,
    commit_message: str,
    author_name: str,
    author_email: str,
    committed_at: datetime,
    parent_sha: Optional[str] = None
) -> bool:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO cached_commits
                (repo_id, commit_sha, commit_message, author_name, author_email, committed_at, parent_sha)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(repo_id, commit_sha) DO NOTHING
        """, (repo_id, commit_sha, commit_message, author_name, author_email, committed_at, parent_sha))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logging.error(f"Failed to save cached commit {commit_sha}: {e}")
        return False


def get_cached_commits(repo_id: int, limit: int = 50) -> List[Dict[str, Any]]:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM cached_commits WHERE repo_id = ? ORDER BY committed_at DESC LIMIT ?",
            (repo_id, limit)
        )
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except Exception as e:
        logging.error(f"Failed to get cached commits for repo {repo_id}: {e}")
        return []


# ============ File Versions Functions ============

def save_file_version(
    repo_id: int,
    file_path: str,
    commit_sha: str,
    content: str,
    content_hash: Optional[str] = None
) -> bool:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO file_versions (repo_id, file_path, commit_sha, content, content_hash)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(repo_id, file_path, commit_sha) DO NOTHING
        """, (repo_id, file_path, commit_sha, content, content_hash))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logging.error(f"Failed to save file version {file_path}@{commit_sha}: {e}")
        return False


def get_file_version(repo_id: int, file_path: str, commit_sha: str) -> Optional[Dict[str, Any]]:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM file_versions WHERE repo_id = ? AND file_path = ? AND commit_sha = ?",
            (repo_id, file_path, commit_sha)
        )
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None
    except Exception as e:
        logging.error(f"Failed to get file version {file_path}@{commit_sha}: {e}")
        return None


# ============ Webhook Events Functions ============

def save_webhook_event(repo_id: int, event_type: str, payload: str) -> int:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO webhook_events (repo_id, event_type, payload)
            VALUES (?, ?, ?)
        """, (repo_id, event_type, payload))
        event_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return event_id
    except Exception as e:
        logging.error(f"Failed to save webhook event: {e}")
        return 0


def mark_webhook_event_processed(event_id: int) -> bool:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE webhook_events SET processed = 1, processed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (event_id,)
        )
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logging.error(f"Failed to mark webhook event {event_id} as processed: {e}")
        return False


def get_unprocessed_webhook_events(repo_id: int) -> List[Dict[str, Any]]:
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM webhook_events WHERE repo_id = ? AND processed = 0 ORDER BY created_at",
            (repo_id,)
        )
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except Exception as e:
        logging.error(f"Failed to get unprocessed webhook events for repo {repo_id}: {e}")
        return []
