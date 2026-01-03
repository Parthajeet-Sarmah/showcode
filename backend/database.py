import sqlite3
import logging

DB_NAME = ".alignments.db"

def init_db():
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS alignments (
                signature TEXT PRIMARY KEY,
                alignment_text TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
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
