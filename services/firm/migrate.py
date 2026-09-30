"""Admin-only one-shot migration. Runtime never receives the admin URL."""
import os
from pathlib import Path
import psycopg

from .config import Config
from .store import Store


def main():
    admin = os.environ['WJP_DATABASE_ADMIN_URL']
    with psycopg.connect(admin) as conn:
        conn.execute(Path(__file__).with_name('schema.sql').read_text())
        root = Path(__file__).resolve().parents[1] / 'trading' / 'migrations'
        if root.exists():
            for sql in sorted(root.glob('*.sql')): conn.execute(sql.read_text())
    from .organization import Organization
    # Seed with runtime identity after migrations, exercising the restricted grants.
    Organization(Store(Config())).seed()
    print('Organization schema migrated and seeded; runtime journal immutability active.')


if __name__ == '__main__': main()
