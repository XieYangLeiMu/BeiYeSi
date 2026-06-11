"""审计日志工具模块"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from db_models import AuditLogModel


def create_audit_log(
    db: Session,
    *,
    user_id: Optional[int],
    username: str,
    action: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    detail: Optional[dict] = None,
) -> AuditLogModel:
    """创建一条审计日志记录"""
    log = AuditLogModel(
        user_id=user_id,
        username=username,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=ip_address,
        user_agent=user_agent,
        detail=detail or {},
        created_at=datetime.now(timezone.utc),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def get_audit_logs(
    db: Session,
    limit: int = 50,
    offset: int = 0,
    user_id: Optional[int] = None,
    action: Optional[str] = None,
) -> list[AuditLogModel]:
    """分页查询审计日志，按时间倒序"""
    q = db.query(AuditLogModel)
    if user_id is not None:
        q = q.filter(AuditLogModel.user_id == user_id)
    if action is not None:
        q = q.filter(AuditLogModel.action == action)
    return q.order_by(AuditLogModel.created_at.desc()).offset(offset).limit(limit).all()
