from sqlalchemy import create_engine
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base


engine = create_engine("sqlite:///:memory:", echo=True)
Session = sessionmaker(bind=engine)
Base = declarative_base()


class Toaster(Base):
    __tablename__ = "toasters"

    id = Column(Integer, primary_key=True)
    name = Column(String)
    color = Column(String)


def toaster_exists_bad(toaster_id):
    session = Session()
    return bool(session.query(Toaster).filter_by(id=toaster_id).first())


def toaster_exists_good(toaster_id):
    session = Session()
    query = session.query(Toaster).filter_by(id=toaster_id)
    return session.query(query.exists()).scalar()


def main():
    Base.metadata.create_all(engine)

    toaster_exists_bad(1)
    toaster_exists_good(2)


if __name__ == "__main__":
    main()
