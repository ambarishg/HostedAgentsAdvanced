"""Create the generic agent interactions table.

Revision ID: 0001_agent_interactions
Revises:
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_agent_interactions"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_interactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("agent_name", sa.Text(), nullable=False),
        sa.Column("agent_version", sa.Text(), nullable=True),
        sa.Column("prompt_version", sa.Text(), nullable=True),
        sa.Column("prompt_hash", sa.String(length=64), nullable=False),
        sa.Column("schema_version", sa.Text(), nullable=False),
        sa.Column("user_input", sa.Text(), nullable=False),
        sa.Column("result_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("agent_response", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("input_tokens", sa.BigInteger(), nullable=True),
        sa.Column("output_tokens", sa.BigInteger(), nullable=True),
        sa.Column("provider_response_id", sa.Text(), nullable=True),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_agent_interactions"),
        sa.UniqueConstraint("request_id", name="uq_agent_interactions_request_id"),
    )
    op.create_index(
        "ix_agent_interactions_created_at", "agent_interactions", ["created_at"], unique=False
    )
    op.create_index("ix_agent_interactions_status", "agent_interactions", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_agent_interactions_status", table_name="agent_interactions")
    op.drop_index("ix_agent_interactions_created_at", table_name="agent_interactions")
    op.drop_table("agent_interactions")
