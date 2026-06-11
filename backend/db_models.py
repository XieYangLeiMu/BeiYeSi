"""SQLAlchemy 2.0 ORM 模型"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, Integer, JSON, TIMESTAMP, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base
from models import Experiment, User


class UserModel(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    def to_pydantic(self) -> User:
        return User(
            id=self.id,
            username=self.username,
            hashed_password=self.hashed_password,
            created_at=self.created_at.isoformat() if self.created_at else "",
        )


class ExperimentModel(Base):
    __tablename__ = "experiments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    variables: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    objectives: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="LHS")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    timestamp: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    created_by: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    creator: Mapped[Optional[UserModel]] = relationship("UserModel")

    def to_pydantic(self) -> Experiment:
        return Experiment(
            id=self.id,
            batch=self.batch,
            variables=self.variables or {},
            objectives=self.objectives or {},
            source=self.source,
            status=self.status,
            timestamp=self.timestamp.isoformat() if self.timestamp else "",
        )

    @classmethod
    def from_pydantic(cls, exp: Experiment) -> "ExperimentModel":
        return cls(
            id=exp.id,
            batch=exp.batch,
            variables=exp.variables,
            objectives=exp.objectives,
            source=exp.source,
            status=exp.status,
            timestamp=datetime.fromisoformat(exp.timestamp.replace("Z", "+00:00"))
            if exp.timestamp else datetime.now(timezone.utc),
        )


class AuditLogModel(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("idx_audit_logs_created_at", "created_at"),
        Index("idx_audit_logs_user_id", "user_id"),
        Index("idx_audit_logs_action", "action"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    username: Mapped[str] = mapped_column(String(100), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    resource_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    user: Mapped[Optional[UserModel]] = relationship("UserModel")


class ProjectModel(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    state: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )

    creator: Mapped[UserModel] = relationship("UserModel")

    def to_response(self, state_model) -> "ProjectResponse":
        from models import ProjectResponse as PR
        return PR(
            id=self.id,
            name=self.name,
            description=self.description,
            created_at=self.created_at.isoformat() if self.created_at else "",
            updated_at=self.updated_at.isoformat() if self.updated_at else "",
            state=state_model,
        )
