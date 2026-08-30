# backend/app/models/one_time_link.py
"""
OneTimeLink SQLAlchemy ORM Model
CRITICAL: Do NOT use 'metadata' as attribute - it's reserved in SQLAlchemy!
"""

from sqlalchemy import Column, String, DateTime, Integer, Boolean, Text, Enum as SQLEnum, Index, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB
from datetime import datetime
from enum import Enum
import uuid

from app.database import Base


class LinkStatus(str, Enum):
    """Status of a one-time link"""
    ACTIVE = "active"
    USED = "used"
    EXPIRED = "expired"
    REVOKED = "revoked"


class OneTimeLink(Base):
    """
    OneTimeLink Model - One-time use links for secure sharing
    
    ⚠️ CRITICAL: 'metadata' is RESERVED in SQLAlchemy declarative base
    Use 'link_metadata' instead to avoid:
    "Attribute name 'metadata' is reserved for the MetaData instance"
    """
    __tablename__ = "one_time_links"
    
    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Link token and rider reference
    token = Column(String(256), unique=True, nullable=False, index=True)
    rider_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    
    # Status tracking
    status = Column(SQLEnum(LinkStatus), default=LinkStatus.ACTIVE, nullable=False, index=True)
    purpose = Column(String(50), nullable=False, default="app_share")
    
    # Expiration and access tracking
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    accessed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Access control
    access_count = Column(Integer, default=0, nullable=False)
    failed_attempts = Column(Integer, default=0, nullable=False)
    max_failed_attempts = Column(Integer, default=3, nullable=False)
    
    # Device and network binding
    device_fingerprint = Column(String(512), nullable=True)
    created_from_ip = Column(String(45), nullable=True)
    accessed_from_ip = Column(String(45), nullable=True)
    created_from_user_agent = Column(Text, nullable=True)
    
    # ✅ Use 'link_metadata' NOT 'metadata' - metadata is RESERVED!
    link_metadata = Column(JSONB, default=dict, nullable=False)
    
    # Access log as JSON
    access_log = Column(JSONB, default=list, nullable=False)
    
    # Revocation
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revocation_reason = Column(String(255), nullable=True)
    
    # Security flags
    is_suspicious = Column(Boolean, default=False, nullable=False)
    device_change_count = Column(Integer, default=0, nullable=False)
    ip_change_count = Column(Integer, default=0, nullable=False)
    
    __table_args__ = (
        Index('ix_one_time_links_token', 'token', unique=True),
        Index('ix_one_time_links_rider_id', 'rider_id'),
        Index('ix_one_time_links_status', 'status'),
        Index('ix_one_time_links_expires_at', 'expires_at'),
        Index('ix_one_time_links_created_at', 'created_at'),
    )
    
    def __repr__(self):
        return f"<OneTimeLink(id={self.id}, token={self.token[:10]}..., status={self.status})>"
    
    @property
    def is_expired(self) -> bool:
        """Check if link has expired"""
        return datetime.utcnow() > self.expires_at
    
    @property
    def is_valid(self) -> bool:
        """Check if link is still valid"""
        return (
            self.status == LinkStatus.ACTIVE and
            not self.is_expired and
            self.failed_attempts < self.max_failed_attempts
        )
    
    def mark_accessed(self, ip_address: str = None, user_agent: str = None):
        """Mark link as accessed"""
        self.access_count += 1
        self.accessed_at = datetime.utcnow()
        if ip_address:
            self.accessed_from_ip = ip_address
        
        if not self.access_log:
            self.access_log = []
        
        self.access_log.append({
            "timestamp": datetime.utcnow().isoformat(),
            "ip": ip_address,
            "user_agent": user_agent
        })
    
    def mark_as_used(self):
        """Mark link as used (consumed)"""
        self.status = LinkStatus.USED
        self.accessed_at = datetime.utcnow()
    
    def revoke(self, reason: str = None):
        """Revoke the link"""
        self.status = LinkStatus.REVOKED
        self.revoked_at = datetime.utcnow()
        self.revocation_reason = reason
    
    def record_failed_attempt(self):
        """Record a failed access attempt"""
        self.failed_attempts += 1
        if self.failed_attempts >= self.max_failed_attempts:
            self.status = LinkStatus.REVOKED