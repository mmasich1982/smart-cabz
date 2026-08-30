from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.exc import SQLAlchemyError, ProgrammingError
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Get database URL and schema from environment
DATABASE_URL = os.getenv("DATABASE_URL")
DB_SCHEMA = os.getenv("DB_SCHEMA", "smart_cabz")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is required but not set")

# Add schema parameter to connection if PostgreSQL
if "postgresql" in DATABASE_URL:
    DATABASE_URL = f"{DATABASE_URL}?options=-c%20search_path%3D{DB_SCHEMA}"

# Create engine with production settings
engine = create_engine(
    DATABASE_URL,
    pool_size=20,
    max_overflow=40,
    pool_recycle=3600,
    pool_pre_ping=True,
)

# Session management
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# FastAPI dependency for database access
def get_db():
    """Database session dependency for FastAPI."""
    db = SessionLocal()
    try:
        yield db
    except SQLAlchemyError as e:
        db.rollback()
        raise RuntimeError(f"Database error: {str(e)}") from e
    finally:
        db.close()


def init_db():
    """
    Initialize database (create all tables).
    ✅ FIXED: Handles existing tables/indexes gracefully
    ✅ Prevents "duplicate index" errors
    """
    try:
        logger.info("Starting database initialization...")
        
        # Get database inspector
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
        
        logger.info(f"Found {len(existing_tables)} existing tables")
        
        # For each table in metadata, create if not exists
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                logger.info(f"Creating table: {table.name}")
                table.create(engine, checkfirst=True)
            else:
                logger.info(f"Table already exists: {table.name}")
                # Create any missing indexes for existing tables
                _create_missing_indexes(table.name, inspector)
        
        logger.info("✓ Database initialization completed successfully!")
        return True
        
    except ProgrammingError as e:
        error_msg = str(e).lower()
        if "already exists" in error_msg or "duplicate" in error_msg:
            logger.warning(f"⚠ Index/table already exists (expected): {str(e)}")
            logger.info("Continuing with database operations...")
            return True
        else:
            logger.error(f"✗ Database initialization failed: {str(e)}")
            raise
            
    except SQLAlchemyError as e:
        logger.error(f"✗ SQLAlchemy error: {str(e)}")
        raise
    except Exception as e:
        logger.error(f"✗ Unexpected error: {str(e)}")
        raise


def _create_missing_indexes(table_name: str, inspector):
    """
    Create indexes for a table that don't already exist.
    Prevents "duplicate index" errors.
    """
    try:
        # Get existing indexes for this table
        existing_indexes = set(idx['name'] for idx in inspector.get_indexes(table_name))
        
        # Get the table metadata
        table = Base.metadata.tables.get(table_name)
        if not table:
            return
        
        # Create missing indexes
        with engine.connect() as conn:
            for index in table.indexes:
                if index.name not in existing_indexes:
                    try:
                        logger.info(f"Creating index: {index.name} on {table_name}")
                        conn.execute(text(str(index.compile(compile_kwargs={"literal_binds": True}))))
                        conn.commit()
                    except ProgrammingError as e:
                        if "already exists" in str(e).lower():
                            logger.info(f"Index already exists: {index.name}")
                        else:
                            raise
                else:
                    logger.info(f"Index already exists: {index.name}")
    except Exception as e:
        logger.warning(f"Could not create indexes for {table_name}: {str(e)}")


def drop_all_tables():
    """⚠️ DANGER: Drop all tables - USE ONLY IN DEVELOPMENT/TESTING"""
    logger.warning("⚠️ DROPPING ALL TABLES - THIS SHOULD ONLY BE USED IN DEVELOPMENT!")
    Base.metadata.drop_all(bind=engine)
    logger.info("All tables dropped successfully")


def reset_database():
    """⚠️ DANGER: Drop and recreate all tables - USE ONLY IN DEVELOPMENT/TESTING"""
    logger.warning("⚠️ RESETTING DATABASE - THIS SHOULD ONLY BE USED IN DEVELOPMENT!")
    drop_all_tables()
    init_db()
    logger.info("Database reset completed")